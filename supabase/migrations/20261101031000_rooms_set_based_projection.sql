-- B5: set-based seat projection; no auth/lock/settlement/clock contract changes.
-- The scalar rooms_member_live remains authoritative for actor authorization.
-- This relation mirrors its predicate for collections; room context is read once.
-- Public counts deliberately do not apply viewer-specific Block filtering.
CREATE FUNCTION public.rooms_live_members(p_room uuid,p_now timestamptz)
RETURNS SETOF public.room_memberships
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH room_context AS MATERIALIZED (
  SELECT r.id FROM public.rooms r LEFT JOIN public.room_runs rr ON rr.id=r.current_run_id
  WHERE r.id=p_room AND (r.status='open' OR (r.status='closed' AND rr.status='active' AND rr.planned_end_at>p_now))
 )
 SELECT m.* FROM public.room_memberships m JOIN room_context r ON r.id=m.room_id
 WHERE m.status='active' AND m.visibility_version=1 AND m.last_seen_at>p_now-interval '180 seconds'
 AND NOT EXISTS(SELECT 1 FROM public.account_suspensions a WHERE a.user_id=m.user_id AND a.revoked_at IS NULL)
 -- The membership/room FK makes this room predicate equivalent to the scalar test.
 AND NOT EXISTS(SELECT 1 FROM public.room_bans b WHERE b.room_id=p_room AND b.membership_id=m.id AND b.revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.rooms_live_members(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rooms_live_members(uuid,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.rooms_public_json(p_room uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; rr public.room_runs%ROWTYPE; reserved_count integer; connected_count integer; phase jsonb; effective_status text;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
 effective_status=public.rooms_effective_status(r,p_now);
 SELECT count(*),count(*) FILTER(WHERE last_seen_at>p_now-interval '90 seconds') INTO reserved_count,connected_count
 FROM public.rooms_live_members(p_room,p_now) m;
 phase=public.rooms_phase(rr,p_now);
 IF effective_status='open' AND phase->>'kind'='completed' THEN phase=public.rooms_phase(NULL::public.room_runs,p_now); rr=NULL; END IF;
 RETURN jsonb_build_object('id',r.id,'title',CASE WHEN effective_status='suspended' THEN 'Room unavailable' ELSE r.title END,
 'description',CASE WHEN effective_status='suspended' THEN '' ELSE r.description END,'language',r.language,
 'topic',CASE WHEN effective_status='suspended' THEN NULL ELSE r.topic END,
 'offering',(SELECT jsonb_build_object('id',o.id,'title',o.title,'provider',o.provider) FROM public.room_public_offerings o WHERE o.id=r.offering_id),
 'status',effective_status,'configuredPreset',r.configured_preset,'version',r.version,'hintVersion',r.hint_version,
 'capacity',20,'reservedCount',reserved_count,'connectedCount',connected_count,'run',public.rooms_run_json(rr,p_now),
 'phase',phase,'createdAt',r.created_at);
END $$;

CREATE OR REPLACE FUNCTION public.read_room_snapshot(p_room uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); at_time timestamptz; m public.room_memberships%ROWTYPE; r public.rooms%ROWTYPE;
 rr public.room_runs%ROWTYPE; phase jsonb; access jsonb; participants jsonb; capabilities jsonb; host_offer jsonb;
 can_join boolean; join_reason text; claim_at timestamptz; active_session uuid; me_data jsonb; room_data jsonb;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_require_onboarded(actor);
 PERFORM public.rooms_lock_for_actor(actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.time_settle_locked(actor,at_time,ARRAY[p_room]);
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 IF NOT FOUND THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
 SELECT * INTO m FROM public.room_memberships WHERE room_id=p_room AND user_id=actor;
 access=public.rooms_access_json(actor,p_room,at_time);
 IF NOT public.rooms_member_live(m,at_time) THEN PERFORM public.rooms_raise(coalesce(access->>'reason','REJOIN_REQUIRED'),403); END IF;
 SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
 phase=public.rooms_phase(rr,at_time);
 SELECT id INTO active_session FROM public.time_sessions WHERE user_id=actor AND status IN ('running','paused','needsReview');
 can_join=phase->>'kind'='focus' AND active_session IS NULL;
 join_reason=CASE WHEN active_session IS NOT NULL THEN 'ACTIVE_SESSION' WHEN phase->>'kind'<>'focus' THEN 'NOT_FOCUS_PHASE' ELSE NULL END;
 claim_at=CASE WHEN r.current_host_membership_id IS NULL THEN at_time ELSE r.host_last_seen_at+interval '120 seconds' END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('membershipId',other.id,'displayName',p.display_name,
  'isOwner',coalesce(r.owner_id=other.user_id,false),'isHost',coalesce(r.current_host_membership_id=other.id,false),
  'presence',CASE WHEN other.last_seen_at>at_time-interval '90 seconds' THEN 'connected' ELSE 'reconnecting' END,
  'focus',coalesce((SELECT CASE WHEN ts.status='running' THEN 'focusing' ELSE 'paused' END FROM public.time_sessions ts
    WHERE ts.user_id=other.user_id AND ts.room_id=p_room AND ts.status IN ('running','paused')
    AND public.rooms_time_cutoff(ts,at_time)>at_time LIMIT 1),'watching'),'intent',other.intent)
  ORDER BY (other.id=m.id) DESC,other.joined_at,other.id),'[]') INTO participants
 FROM public.rooms_live_members(p_room,at_time) other JOIN public.account_profiles p ON p.user_id=other.user_id
 WHERE NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.revoked_at IS NULL
  AND ((b.blocker_id=actor AND b.blocked_id=other.user_id) OR (b.blocker_id=other.user_id AND b.blocked_id=actor)));
 capabilities=jsonb_build_object('canStartRun',coalesce(r.current_host_membership_id=m.id AND r.status='open' AND rr.id IS NULL,false),
  'canJoinRound',can_join,'joinRoundReason',join_reason,
  'canClaimHost',coalesce(r.current_host_membership_id IS DISTINCT FROM m.id AND claim_at<=at_time AND m.last_seen_at>at_time-interval '90 seconds',false),
  'claimHostAt',CASE WHEN r.current_host_membership_id=m.id THEN NULL ELSE claim_at END,
  'canEdit',coalesce(r.owner_id=actor AND r.status='open',false),'canClose',coalesce(r.owner_id=actor AND r.status='open',false),
  'canTransferHost',coalesce(r.current_host_membership_id=m.id,false),'canRemove',coalesce(r.current_host_membership_id=m.id,false),
  'canBan',coalesce(r.owner_id=actor,false),'canModerate',public.rooms_is_moderator(actor));
 SELECT jsonb_build_object('id',o.id,'fromMembershipId',o.from_membership_id,'targetMembershipId',o.target_membership_id,'expiresAt',o.expires_at)
 INTO host_offer FROM public.room_transfer_offers o
 JOIN public.room_memberships sender ON sender.id=o.from_membership_id JOIN public.room_memberships target ON target.id=o.target_membership_id
 WHERE o.room_id=p_room AND o.status='offered' AND o.expires_at>at_time AND (o.from_membership_id=m.id OR o.target_membership_id=m.id)
 AND NOT public.rooms_is_blocked(sender.user_id,target.user_id);
 me_data=public.rooms_me_json(actor,p_room,at_time);
 room_data=CASE WHEN me_data#>>'{room,id}'=p_room::text THEN me_data->'room' ELSE public.rooms_public_json(p_room,at_time) END;
 RETURN jsonb_build_object('accountId',actor,'serverTime',at_time,'room',room_data,
  'me',me_data,'access',jsonb_build_object('membershipId',m.id,'generation',m.control_version,'seatExpiresAt',m.last_seen_at+interval '180 seconds','checkedAt',at_time),
  'participants',participants,'capabilities',capabilities,'transferOffer',host_offer,
  'reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',rx.id,'membershipId',rx.membership_id,'kind',rx.kind,'createdAt',rx.created_at) ORDER BY rx.created_at)
    FROM public.room_reactions rx JOIN public.room_memberships sender ON sender.id=rx.membership_id
    WHERE rx.room_id=p_room AND rx.run_id=rr.id AND rx.created_at>=at_time-interval '30 seconds'
    AND phase->>'kind' IN ('shortBreak','longBreak') AND public.rooms_member_live(sender,at_time) AND NOT public.rooms_is_blocked(actor,sender.user_id)),'[]'),
  'ownBlocks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'targetMembershipId',target.id)) FROM public.user_blocks b
    JOIN public.room_memberships target ON target.user_id=b.blocked_id AND target.room_id=p_room WHERE b.blocker_id=actor AND b.revoked_at IS NULL),'[]'),
  'bans',CASE WHEN r.owner_id=actor THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'membershipId',b.membership_id,'reason',b.reason,'createdAt',b.created_at)) FROM public.room_bans b WHERE b.room_id=p_room AND b.revoked_at IS NULL),'[]') ELSE '[]'::jsonb END);
END $$;

CREATE OR REPLACE FUNCTION public.rooms_emit_locked(p_room uuid,p_now timestamptz,p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE phase_key text; r public.rooms%ROWTYPE;
 reserved_count integer; connected_count integer; new_version bigint;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 -- Match the old STABLE DTO's single statement snapshot for phase and counts,
 -- even if another account's suspension changes while Room/Run remain locked.
 -- Preserve open/completed -> lobby normalization, including effective archive.
 WITH context AS MATERIALIZED (
  SELECT public.rooms_phase(rr,p_now) AS phase,rr.id AS run_id,
   public.rooms_effective_status(room,p_now) AS effective_status
  FROM public.rooms room LEFT JOIN public.room_runs rr ON rr.id=room.current_run_id WHERE room.id=p_room
 ), counts AS MATERIALIZED (
  SELECT count(*)::integer AS reserved,count(*) FILTER(WHERE last_seen_at>p_now-interval '90 seconds')::integer AS connected
  FROM public.rooms_live_members(p_room,p_now)
 )
 SELECT CASE WHEN c.effective_status='open' AND c.phase->>'kind'='completed' THEN 'lobby::'
  ELSE concat(c.phase->>'kind',':',c.phase->>'roundIndex',':',c.run_id) END,n.reserved,n.connected
 INTO phase_key,reserved_count,connected_count FROM context c CROSS JOIN counts n;
 -- Missing-room calls retain their old invalid-write behavior rather than
 -- silently succeeding; normal callers already hold an existing Room lock.
 phase_key=coalesce(phase_key,'::');
 IF NOT p_force AND r.hint_phase=phase_key AND r.hint_reserved=reserved_count AND r.hint_connected=connected_count THEN RETURN; END IF;
 UPDATE public.rooms SET hint_version=hint_version+1,hint_phase=phase_key,
 hint_reserved=reserved_count,hint_connected=connected_count
 WHERE id=p_room RETURNING hint_version INTO new_version;
 INSERT INTO public.room_outbox(room_id,version,next_run_at) VALUES(p_room,new_version,p_now)
 ON CONFLICT(room_id) DO UPDATE SET version=excluded.version,pending=true,next_run_at=excluded.next_run_at,attempts=0;
END $$;

-- CREATE OR REPLACE preserves the three existing function owners and ACLs.
-- Callers build any public DTO after hint emission, never reuse a pre-bump DTO.
