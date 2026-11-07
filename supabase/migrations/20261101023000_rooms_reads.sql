-- B5: narrow public metadata and viewer-filtered authenticated snapshots.
CREATE FUNCTION public.list_public_rooms(p_query text DEFAULT NULL,p_language text DEFAULT NULL,p_offering text DEFAULT NULL,p_topic text DEFAULT NULL,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE at_time timestamptz=date_trunc('milliseconds',statement_timestamp()); result jsonb; next_cursor text;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 50 OR char_length(coalesce(p_query,''))>80 OR char_length(coalesce(p_topic,''))>80 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 WITH candidates AS MATERIALIZED (
  SELECT r.* FROM public.rooms r WHERE r.status='open' AND public.rooms_effective_status(r,at_time)='open'
   AND (p_language IS NULL OR r.language=p_language) AND (p_offering IS NULL OR r.offering_id=p_offering)
   AND (p_topic IS NULL OR position(lower(p_topic) IN lower(coalesce(r.topic,'')))>0)
   AND (p_query IS NULL OR position(lower(p_query) IN lower(r.title||' '||r.description||' '||coalesce(r.topic,'')))>0)
   AND (p_before IS NULL OR (r.created_at,r.id)<(p_before,p_before_id))
  ORDER BY r.created_at DESC,r.id DESC LIMIT p_limit+1
 ), page AS (SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT coalesce((SELECT jsonb_agg(public.rooms_public_json(id,at_time) ORDER BY created_at DESC,id DESC) FROM page),'[]'),
  CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT created_at::text||'|'||id::text FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END INTO result,next_cursor;
 RETURN jsonb_build_object('rooms',result,'nextCursor',next_cursor,'serverTime',at_time);
END $$;
CREATE FUNCTION public.read_public_room(p_room uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.rooms_public_json(p_room,date_trunc('milliseconds',statement_timestamp()))
$$;
CREATE FUNCTION public.read_room_options() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('offerings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'provider',provider) ORDER BY title) FROM public.room_public_offerings WHERE approved),'[]'),
 'visibilityVersion',1,'capacity',20,'maxOpenOwned',3,'maxCreatedPerUtcDay',1)
$$;
CREATE FUNCTION public.read_room_me(p_room uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); at_time timestamptz;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_lock_for_actor(actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF p_room IS NOT NULL THEN PERFORM public.rooms_settle_locked(p_room,at_time); END IF;
 PERFORM public.time_settle_locked(actor,at_time);
 RETURN public.rooms_me_json(actor,p_room,at_time);
END $$;
CREATE FUNCTION public.read_room_snapshot(p_room uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); at_time timestamptz; m public.room_memberships%ROWTYPE; r public.rooms%ROWTYPE;
 rr public.room_runs%ROWTYPE; phase jsonb; access jsonb; participants jsonb; capabilities jsonb; host_offer jsonb;
 can_join boolean; join_reason text; claim_at timestamptz; active_session uuid;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_lock_for_actor(actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.rooms_settle_locked(p_room,at_time);
 PERFORM public.time_settle_locked(actor,at_time);
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
 FROM public.room_memberships other JOIN public.account_profiles p ON p.user_id=other.user_id
 WHERE other.room_id=p_room AND public.rooms_member_live(other,at_time) AND NOT public.rooms_is_blocked(actor,other.user_id);
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
 RETURN jsonb_build_object('accountId',actor,'serverTime',at_time,'room',public.rooms_public_json(p_room,at_time),
  'me',public.rooms_me_json(actor,p_room,at_time),'access',jsonb_build_object('membershipId',m.id,'generation',m.control_version,'seatExpiresAt',m.last_seen_at+interval '180 seconds','checkedAt',at_time),
  'participants',participants,'capabilities',capabilities,'transferOffer',host_offer,
  'reactions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',rx.id,'membershipId',rx.membership_id,'kind',rx.kind,'createdAt',rx.created_at) ORDER BY rx.created_at)
    FROM public.room_reactions rx JOIN public.room_memberships sender ON sender.id=rx.membership_id
    WHERE rx.room_id=p_room AND rx.run_id=rr.id AND rx.created_at>=at_time-interval '30 seconds'
    AND phase->>'kind' IN ('shortBreak','longBreak') AND public.rooms_member_live(sender,at_time) AND NOT public.rooms_is_blocked(actor,sender.user_id)),'[]'),
  'ownBlocks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'targetMembershipId',target.id)) FROM public.user_blocks b
    JOIN public.room_memberships target ON target.user_id=b.blocked_id AND target.room_id=p_room WHERE b.blocker_id=actor AND b.revoked_at IS NULL),'[]'),
  'bans',CASE WHEN r.owner_id=actor THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'membershipId',b.membership_id,'reason',b.reason,'createdAt',b.created_at)) FROM public.room_bans b WHERE b.room_id=p_room AND b.revoked_at IS NULL),'[]') ELSE '[]'::jsonb END);
END $$;
CREATE FUNCTION public.read_room_reports(p_status text DEFAULT 'open',p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); reports jsonb;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 IF NOT public.rooms_is_moderator(actor) OR public.rooms_is_suspended(actor) THEN PERFORM public.rooms_raise('MODERATOR_REQUIRED',403); END IF;
 IF p_status NOT IN ('open','reviewed') OR p_limit NOT BETWEEN 1 AND 50 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'roomId',room_id,'targetMembershipId',target_membership_id,'reason',reason,'details',details,'status',status,'createdAt',created_at) ORDER BY created_at,id),'[]') INTO reports
 FROM (SELECT * FROM public.room_reports WHERE status=p_status ORDER BY created_at,id LIMIT p_limit) report_page;
 RETURN jsonb_build_object('reports',reports);
END $$;
CREATE FUNCTION public.read_room_realtime_grant(p_actor uuid,p_room uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.room_memberships%ROWTYPE; at_time timestamptz;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM public.rooms_lock_for_actor(p_actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.rooms_settle_locked(p_room,at_time);
 SELECT * INTO m FROM public.room_memberships WHERE room_id=p_room AND user_id=p_actor;
 IF NOT public.rooms_member_live(m,at_time) THEN PERFORM public.rooms_raise('REJOIN_REQUIRED',403); END IF;
 RETURN jsonb_build_object('membershipId',m.id,'roomId',p_room,'generation',m.control_version,'seatExpiresAt',m.last_seen_at+interval '180 seconds','topic','room:'||p_room::text);
END $$;
