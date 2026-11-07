-- B5 measured latency repair: enforce onboarding inside the same authoritative RPC transaction.
-- No roster, settlement, receipt, lock-order or control policy changes.
CREATE FUNCTION public.rooms_require_onboarded(p_actor uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN
  PERFORM public.rooms_raise('AUTH_REQUIRED',401);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account_profiles WHERE user_id=p_actor AND onboarded) THEN
  PERFORM public.rooms_raise('ONBOARDING_REQUIRED',409);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.rooms_require_onboarded(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_room_me(p_room uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); at_time timestamptz;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_require_onboarded(actor);
 PERFORM public.rooms_lock_for_actor(actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF p_room IS NOT NULL THEN PERFORM public.rooms_settle_locked(p_room,at_time); END IF;
 PERFORM public.time_settle_locked(actor,at_time);
 RETURN public.rooms_me_json(actor,p_room,at_time);
END $$;

CREATE OR REPLACE FUNCTION public.read_room_snapshot(p_room uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); at_time timestamptz; m public.room_memberships%ROWTYPE; r public.rooms%ROWTYPE;
 rr public.room_runs%ROWTYPE; phase jsonb; access jsonb; participants jsonb; capabilities jsonb; host_offer jsonb;
 can_join boolean; join_reason text; claim_at timestamptz; active_session uuid;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_require_onboarded(actor);
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

CREATE OR REPLACE FUNCTION public.read_room_reports(p_status text DEFAULT 'open',p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid(); reports jsonb;
BEGIN
 IF actor IS NULL THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM public.rooms_require_onboarded(actor);
 IF NOT public.rooms_is_moderator(actor) OR public.rooms_is_suspended(actor) THEN PERFORM public.rooms_raise('MODERATOR_REQUIRED',403); END IF;
 IF p_status NOT IN ('open','reviewed') OR p_limit NOT BETWEEN 1 AND 50 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'roomId',room_id,'targetMembershipId',target_membership_id,'reason',reason,'details',details,'status',status,'createdAt',created_at) ORDER BY created_at,id),'[]') INTO reports
 FROM (SELECT * FROM public.room_reports WHERE status=p_status ORDER BY created_at,id LIMIT p_limit) report_page;
 RETURN jsonb_build_object('reports',reports);
END $$;

CREATE OR REPLACE FUNCTION public.read_room_realtime_grant(p_actor uuid,p_room uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.room_memberships%ROWTYPE; at_time timestamptz;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM public.rooms_require_onboarded(p_actor);
 PERFORM public.rooms_lock_for_actor(p_actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.rooms_settle_locked(p_room,at_time);
 SELECT * INTO m FROM public.room_memberships WHERE room_id=p_room AND user_id=p_actor;
 IF NOT public.rooms_member_live(m,at_time) THEN PERFORM public.rooms_raise('REJOIN_REQUIRED',403); END IF;
 RETURN jsonb_build_object('membershipId',m.id,'roomId',p_room,'generation',m.control_version,'seatExpiresAt',m.last_seen_at+interval '180 seconds','topic','room:'||p_room::text);
END $$;

CREATE OR REPLACE FUNCTION public.execute_room_command(p_actor uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 op uuid=(p_command->>'operationId')::uuid; kind text=p_command->>'type'; rid uuid=(p_command->>'roomId')::uuid;
 device uuid=(p_command->>'deviceId')::uuid; at_time timestamptz; targets uuid[]; locked_room uuid;
 rev bigint; next_control integer; affected_session uuid; member_id uuid; new_run_id uuid; interval_id uuid;
 r public.rooms%ROWTYPE; rr public.room_runs%ROWTYPE; m public.room_memberships%ROWTYPE;
 own_member public.room_memberships%ROWTYPE; target_member public.room_memberships%ROWTYPE;
 s public.time_sessions%ROWTYPE; participation public.round_participations%ROWTYPE;
 offer public.room_transfer_offers%ROWTYPE; prior public.room_operations%ROWTYPE;
 phase jsonb; receipt jsonb; response jsonb; boundary timestamptz; focus_seconds integer; run_seconds integer;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 PERFORM public.rooms_require_onboarded(p_actor);
 SELECT * INTO prior FROM public.room_operations WHERE user_id=p_actor AND operation_id=op;
 targets=ARRAY[rid];
 IF kind='create' THEN SELECT array_agg(id) INTO targets FROM public.rooms WHERE owner_id=p_actor AND status='open'; END IF;
 IF kind='reviewReport' THEN SELECT ARRAY[room_id] INTO targets FROM public.room_reports WHERE id=(p_command->>'reportId')::uuid; END IF;
 PERFORM public.rooms_lock_for_actor(p_actor,coalesce(targets,ARRAY[]::uuid[]));
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF prior.operation_id IS NOT NULL THEN
  IF prior.command<>p_command THEN PERFORM public.rooms_raise('IDEMPOTENCY_MISMATCH',409); END IF;
  PERFORM public.time_settle_locked(p_actor,at_time);
  RETURN jsonb_build_object('data',public.rooms_me_json(p_actor,(prior.receipt->>'roomId')::uuid,at_time),
   'receipt',prior.receipt,'time',public.time_snapshot_locked(p_actor,(prior.receipt->>'sessionId')::uuid),'replayed',true);
 END IF;
 FOR locked_room IN SELECT unnest(targets) LOOP IF locked_room IS NOT NULL THEN PERFORM public.rooms_settle_locked(locked_room,at_time); END IF; END LOOP;
 PERFORM public.time_settle_locked(p_actor,at_time);
 IF public.rooms_is_suspended(p_actor) THEN PERFORM public.rooms_raise('ACCOUNT_SUSPENDED',403); END IF;
 SELECT * INTO own_member FROM public.room_memberships WHERE user_id=p_actor AND status='active';
 SELECT * INTO s FROM public.time_sessions WHERE user_id=p_actor AND status IN ('running','paused','needsReview');
 SELECT * INTO r FROM public.rooms WHERE id=rid;
 IF rid IS NOT NULL AND r.id IS NULL THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
 IF kind='renewPresence' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time,false,false);
  IF m.last_renew_command->>'operationId'=op::text THEN
   IF m.last_renew_command<>p_command THEN PERFORM public.rooms_raise('IDEMPOTENCY_MISMATCH',409); END IF;
   RETURN jsonb_build_object('data',public.rooms_me_json(p_actor,rid,at_time),'receipt',m.last_renew_receipt,
    'time',public.time_snapshot_locked(p_actor,s.id),'replayed',true);
  END IF;
  IF s.id IS NOT NULL AND s.room_id=rid AND (s.device_id<>device OR s.control_version<>m.control_version) THEN PERFORM public.rooms_raise('CONTROL_LOST',409); END IF;
  receipt=jsonb_build_object('operationId',op,'type',kind,'roomId',rid,'membershipId',m.id,'runId',r.current_run_id,'sessionId',s.id,
   'revision',coalesce((SELECT revision FROM public.room_accounts WHERE user_id=p_actor),0),'acceptedAt',at_time);
  UPDATE public.room_memberships SET last_seen_at=at_time,last_renew_command=p_command,last_renew_receipt=receipt WHERE id=m.id;
  UPDATE public.rooms SET last_activity_at=greatest(last_activity_at,at_time),host_last_seen_at=CASE WHEN current_host_membership_id=m.id THEN at_time ELSE host_last_seen_at END WHERE id=rid;
  UPDATE public.time_sessions SET lease_until=at_time+interval '90 seconds' WHERE id=s.id AND room_id=rid;
  PERFORM public.rooms_emit_locked(rid,at_time);
  PERFORM public.rooms_schedule_locked(rid,at_time);
  RETURN jsonb_build_object('data',public.rooms_me_json(p_actor,rid,at_time),'receipt',receipt,'time',public.time_snapshot_locked(p_actor,s.id),'replayed',false);
 END IF;
 rev=coalesce((SELECT revision FROM public.room_accounts WHERE user_id=p_actor),0);
 IF rev<>(p_command->>'expectedRevision')::bigint THEN PERFORM public.rooms_raise('REVISION_CONFLICT',409); END IF;
 PERFORM public.rooms_rate(p_actor,'commands',at_time,40);
 IF kind IN ('create','join','switchToRoom') AND (p_command->>'acknowledgeVisibility' IS DISTINCT FROM 'true' OR p_command->>'visibilityVersion' IS DISTINCT FROM '1') THEN PERFORM public.rooms_raise('VISIBILITY_CONSENT_REQUIRED',422); END IF;

 IF kind='create' THEN
  PERFORM public.rooms_assert_metadata(p_command);
  IF own_member.id IS NOT NULL THEN PERFORM public.rooms_raise('ACTIVE_MEMBERSHIP',409); END IF;
  IF s.id IS NOT NULL THEN PERFORM public.rooms_raise('ACTIVE_SESSION',409); END IF;
  IF (SELECT count(*) FROM public.rooms WHERE owner_id=p_actor AND status='open')>=3 THEN PERFORM public.rooms_raise('OWNED_ROOM_LIMIT',409); END IF;
  IF EXISTS(SELECT 1 FROM public.rooms WHERE owner_id=p_actor AND created_at>=(date_trunc('day',at_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) THEN PERFORM public.rooms_raise('DAILY_ROOM_LIMIT',429); END IF;
  INSERT INTO public.rooms(owner_id,title,description,language,topic,offering_id,configured_preset,host_last_seen_at,last_activity_at,created_at)
  VALUES(p_actor,p_command->>'title',p_command->>'description',p_command->>'language',p_command->>'topic',p_command->>'offeringId',p_command->>'presetId',at_time,at_time,at_time) RETURNING id INTO rid;
  member_id=public.rooms_join_locked(p_actor,rid,device,at_time,op);
  UPDATE public.rooms SET current_host_membership_id=member_id WHERE id=rid;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind IN ('join','switchToRoom') THEN
  PERFORM public.rooms_check_destination(p_actor,rid,at_time);
  IF own_member.id IS NOT NULL AND own_member.room_id=rid THEN PERFORM public.rooms_raise('ALREADY_JOINED',409); END IF;
  IF kind='join' THEN
   IF own_member.id IS NOT NULL THEN PERFORM public.rooms_raise('ACTIVE_MEMBERSHIP',409); END IF;
   IF s.id IS NOT NULL AND (s.mode<>'room' OR s.room_id<>rid) THEN PERFORM public.rooms_raise('ACTIVE_SESSION',409); END IF;
  ELSE
   IF own_member.id IS NOT NULL AND (own_member.room_id IS DISTINCT FROM (p_command->>'fromRoomId')::uuid OR own_member.control_version IS DISTINCT FROM (p_command->>'presenceControlVersion')::integer OR own_member.device_id<>device) THEN PERFORM public.rooms_raise('CONTROL_LOST',409); END IF;
   affected_session=public.rooms_finish_for_move(p_actor,p_command,at_time);
   IF own_member.id IS NOT NULL THEN
    UPDATE public.room_memberships SET status='left',ended_at=at_time,version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE id=own_member.id;
    PERFORM public.rooms_emit_locked(own_member.room_id,at_time,true);
   END IF;
  END IF;
  member_id=public.rooms_join_locked(p_actor,rid,device,at_time,op);
  IF kind='join' THEN affected_session=s.id; END IF;

 ELSIF kind IN ('leave','switchToSolo') THEN
  IF s.id IS NOT NULL AND s.room_id IS DISTINCT FROM rid THEN PERFORM public.rooms_raise('TIME_SESSION_CHANGED',409); END IF;
  SELECT * INTO m FROM public.room_memberships WHERE room_id=rid AND user_id=p_actor;
  IF m.id IS NULL THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
  IF public.rooms_member_live(m,at_time) THEN
   m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  ELSIF own_member.id IS NOT NULL OR m.control_version IS DISTINCT FROM (p_command->>'controlVersion')::integer THEN
   PERFORM public.rooms_raise('CONTROL_LOST',409);
  END IF;
  IF kind='switchToSolo' THEN
   PERFORM public.rooms_assert_link(p_actor,p_command->'solo');
   IF (p_command->'solo'->>'mode'='solo')<>(jsonb_typeof(p_command->'solo'->'settings')='object') THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
  END IF;
  affected_session=public.rooms_finish_for_move(p_actor,p_command,at_time);
  UPDATE public.room_memberships SET status='left',ended_at=at_time,version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE id=m.id AND status='active';
  member_id=m.id;
  IF kind='switchToSolo' THEN
   focus_seconds=CASE WHEN p_command->'solo'->>'mode'='solo' THEN (p_command->'solo'->'settings'->>'focusMinutes')::integer*60 ELSE NULL END;
   boundary=at_time+make_interval(secs=>coalesce(focus_seconds,14400));
   INSERT INTO public.time_sessions(user_id,mode,category,status,title,enrollment_id,task_id,created_at,device_id,lease_until,remaining_seconds,settings)
   VALUES(p_actor,p_command->'solo'->>'mode',p_command->'solo'->>'category','running',p_command->'solo'->>'title',
    (p_command->'solo'->>'enrollmentId')::uuid,p_command->'solo'->>'taskId',at_time,device,at_time+interval '90 seconds',focus_seconds,nullif(p_command->'solo'->'settings','null')) RETURNING id INTO affected_session;
   PERFORM public.time_open_interval(p_actor,affected_session,at_time,boundary,device,1);
   PERFORM public.time_bump(p_actor,'room-solo:'||p_actor::text||':'||op::text,'start');
  END IF;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='takeControl' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time,true);
  next_control=greatest(m.control_version,CASE WHEN s.room_id=rid THEN s.control_version ELSE 0 END)+1;
  PERFORM public.rooms_sync_control(p_actor,m.id,device,next_control,at_time,op);
  member_id=m.id; affected_session=s.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='setIntent' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  UPDATE public.room_memberships SET intent=p_command->>'intent',version=version+1 WHERE id=m.id;
  member_id=m.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='startRun' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  IF r.current_host_membership_id IS DISTINCT FROM m.id THEN PERFORM public.rooms_raise('HOST_REQUIRED',403); END IF;
  IF r.version<>(p_command->>'roomVersion')::bigint THEN PERFORM public.rooms_raise('ROOM_VERSION_CONFLICT',409); END IF;
  IF r.status<>'open' THEN PERFORM public.rooms_raise('ROOM_CLOSED',403); END IF;
  IF EXISTS(SELECT 1 FROM public.room_runs WHERE room_id=rid AND status='active') THEN PERFORM public.rooms_raise('RUN_ALREADY_ACTIVE',409); END IF;
  run_seconds=CASE WHEN r.configured_preset='classic' THEN 7800 ELSE 15000 END;
  INSERT INTO public.room_runs(room_id,preset_id,started_at,planned_end_at,current_host_membership_id)
  VALUES(rid,r.configured_preset,at_time,at_time+make_interval(secs=>run_seconds),m.id) RETURNING id INTO new_run_id;
  UPDATE public.rooms SET current_run_id=new_run_id,version=version+1,access_epoch=access_epoch+1,last_activity_at=at_time WHERE id=rid;
  member_id=m.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='joinRound' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  IF s.id IS NOT NULL THEN PERFORM public.rooms_raise('ACTIVE_SESSION',409); END IF;
  IF coalesce((SELECT revision FROM public.time_accounts WHERE user_id=p_actor),0)<>(p_command->>'expectedTimeRevision')::bigint THEN PERFORM public.rooms_raise('TIME_REVISION_CONFLICT',409); END IF;
  SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
  phase=public.rooms_phase(rr,at_time);
  IF rr.id IS DISTINCT FROM (p_command->>'runId')::uuid OR phase->>'kind'<>'focus' OR (phase->>'roundIndex')::integer<>(p_command->>'roundIndex')::integer THEN PERFORM public.rooms_raise('ROUND_CHANGED',409); END IF;
  PERFORM public.rooms_assert_link(p_actor,p_command);
  boundary=(phase->>'endsAt')::timestamptz;
  INSERT INTO public.round_participations(user_id,room_id,run_id,round_index,accepted_at,boundary_at)
  VALUES(p_actor,rid,rr.id,(phase->>'roundIndex')::integer,at_time,boundary)
  ON CONFLICT(user_id,run_id,round_index) DO NOTHING;
  SELECT * INTO participation FROM public.round_participations rp WHERE rp.user_id=p_actor AND rp.run_id=rr.id AND rp.round_index=(phase->>'roundIndex')::integer;
  INSERT INTO public.time_sessions(user_id,mode,category,status,title,enrollment_id,task_id,created_at,device_id,control_version,lease_until,remaining_seconds,round_index,room_id,participation_id,room_deadline_at)
  VALUES(p_actor,'room',p_command->>'category','running',r.title,(p_command->>'enrollmentId')::uuid,p_command->>'taskId',at_time,device,m.control_version,at_time+interval '90 seconds',extract(epoch FROM boundary-at_time),(phase->>'roundIndex')::integer,rid,participation.id,boundary)
  RETURNING id INTO affected_session;
  interval_id=public.time_open_interval(p_actor,affected_session,at_time,boundary,device,m.control_version);
  PERFORM public.time_bump(p_actor,'room-round:'||p_actor::text||':'||op::text,'start');
  member_id=m.id; new_run_id=rr.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind IN ('edit','close') THEN
  IF r.owner_id IS DISTINCT FROM p_actor THEN PERFORM public.rooms_raise('OWNER_REQUIRED',403); END IF;
  IF r.version<>(p_command->>'roomVersion')::bigint THEN PERFORM public.rooms_raise('ROOM_VERSION_CONFLICT',409); END IF;
  IF r.status<>'open' THEN PERFORM public.rooms_raise('ROOM_CLOSED',409); END IF;
  IF kind='edit' THEN
   PERFORM public.rooms_assert_metadata(p_command);
   UPDATE public.rooms SET title=p_command->>'title',description=p_command->>'description',language=p_command->>'language',
    topic=p_command->>'topic',offering_id=p_command->>'offeringId',configured_preset=p_command->>'presetId',version=version+1 WHERE id=rid;
  ELSE
   UPDATE public.rooms SET status='closed',closed_at=at_time,version=version+1 WHERE id=rid;
   PERFORM public.rooms_settle_locked(rid,at_time);
  END IF;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind IN ('offerHost','acceptHost','claimHost') THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  IF kind='offerHost' THEN
   IF r.current_host_membership_id IS DISTINCT FROM m.id THEN PERFORM public.rooms_raise('HOST_REQUIRED',403); END IF;
   IF r.version<>(p_command->>'roomVersion')::bigint THEN PERFORM public.rooms_raise('ROOM_VERSION_CONFLICT',409); END IF;
   SELECT * INTO target_member FROM public.room_memberships WHERE id=(p_command->>'targetMembershipId')::uuid AND room_id=rid;
   IF target_member.id=m.id OR public.rooms_is_blocked(p_actor,target_member.user_id) OR NOT public.rooms_member_live(target_member,at_time) OR target_member.last_seen_at<=at_time-interval '90 seconds' THEN PERFORM public.rooms_raise('TARGET_NOT_CONNECTED',409); END IF;
   UPDATE public.room_transfer_offers SET status='cancelled' WHERE room_id=rid AND status='offered';
   INSERT INTO public.room_transfer_offers(room_id,from_membership_id,target_membership_id,run_id,status,expires_at,created_at)
   VALUES(rid,m.id,target_member.id,r.current_run_id,'offered',at_time+interval '60 seconds',at_time);
  ELSIF kind='acceptHost' THEN
   SELECT * INTO offer FROM public.room_transfer_offers WHERE id=(p_command->>'offerId')::uuid AND room_id=rid;
   IF offer.status IS DISTINCT FROM 'offered' OR offer.target_membership_id<>m.id OR offer.expires_at<=at_time OR offer.from_membership_id IS DISTINCT FROM r.current_host_membership_id OR offer.run_id IS DISTINCT FROM r.current_run_id THEN PERFORM public.rooms_raise('HOST_OFFER_EXPIRED',409); END IF;
   SELECT * INTO target_member FROM public.room_memberships WHERE id=offer.from_membership_id;
   IF public.rooms_is_blocked(p_actor,target_member.user_id) THEN PERFORM public.rooms_raise('TARGET_NOT_AVAILABLE',409); END IF;
   UPDATE public.room_transfer_offers SET status='accepted' WHERE id=offer.id;
  ELSE
   IF r.current_host_membership_id=m.id THEN PERFORM public.rooms_raise('ALREADY_HOST',409); END IF;
   IF m.last_seen_at<=at_time-interval '90 seconds' OR (r.current_host_membership_id IS NOT NULL AND r.host_last_seen_at>at_time-interval '120 seconds') THEN PERFORM public.rooms_raise('HOST_CLAIM_NOT_READY',409); END IF;
   UPDATE public.room_transfer_offers SET status='cancelled' WHERE room_id=rid AND status='offered';
  END IF;
  IF kind<>'offerHost' THEN
   UPDATE public.rooms SET current_host_membership_id=m.id,host_last_seen_at=at_time,version=version+1 WHERE id=rid;
   UPDATE public.room_runs SET current_host_membership_id=m.id,version=version+1 WHERE id=r.current_run_id AND status='active';
  END IF;
  member_id=m.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind IN ('remove','ban','suspendAccount') THEN
  SELECT * INTO target_member FROM public.room_memberships WHERE id=(p_command->>'targetMembershipId')::uuid AND room_id=rid;
  IF target_member.id IS NULL OR target_member.user_id=p_actor THEN PERFORM public.rooms_raise('INVALID_TARGET',422); END IF;
  IF kind='remove' THEN
   m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
   IF r.current_host_membership_id IS DISTINCT FROM m.id THEN PERFORM public.rooms_raise('HOST_REQUIRED',403); END IF;
   IF NOT public.rooms_member_live(target_member,at_time) THEN PERFORM public.rooms_raise('TARGET_NOT_PRESENT',409); END IF;
  ELSIF kind='ban' THEN
   IF r.owner_id IS DISTINCT FROM p_actor THEN PERFORM public.rooms_raise('OWNER_REQUIRED',403); END IF;
   IF EXISTS(SELECT 1 FROM public.room_bans WHERE membership_id=target_member.id AND revoked_at IS NULL) THEN PERFORM public.rooms_raise('ALREADY_BANNED',409); END IF;
   INSERT INTO public.room_bans(room_id,membership_id,actor_id,reason,created_at) VALUES(rid,target_member.id,p_actor,p_command->>'reason',at_time);
  ELSE
   IF NOT public.rooms_is_moderator(p_actor) THEN PERFORM public.rooms_raise('MODERATOR_REQUIRED',403); END IF;
   IF public.rooms_is_suspended(target_member.user_id) THEN PERFORM public.rooms_raise('ALREADY_SUSPENDED',409); END IF;
   INSERT INTO public.account_suspensions(user_id,actor_id,reason,effective_at) VALUES(target_member.user_id,p_actor,p_command->>'reason',at_time);
  END IF;
  INSERT INTO public.room_access_cutoffs(room_id,membership_id,run_id,effective_at,reason,access_epoch) VALUES(rid,target_member.id,r.current_run_id,at_time,kind,r.access_epoch);
  UPDATE public.room_memberships SET status='removed',ended_at=at_time,removed_run_id=r.current_run_id,removed_epoch=r.access_epoch,
   version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE id=target_member.id;
  PERFORM public.rooms_queue_account(target_member.user_id,at_time);
  INSERT INTO public.room_audit(room_id,actor_id,target_membership_id,action,reason,created_at) VALUES(rid,p_actor,target_member.id,kind,p_command->>'reason',at_time);
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='unban' THEN
  IF r.owner_id IS DISTINCT FROM p_actor THEN PERFORM public.rooms_raise('OWNER_REQUIRED',403); END IF;
  UPDATE public.room_bans SET revoked_at=at_time WHERE id=(p_command->>'banId')::uuid AND room_id=rid AND revoked_at IS NULL;
  IF NOT FOUND THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;

 ELSIF kind='suspendRoom' THEN
  IF NOT public.rooms_is_moderator(p_actor) THEN PERFORM public.rooms_raise('MODERATOR_REQUIRED',403); END IF;
  IF r.status='suspended' THEN PERFORM public.rooms_raise('ALREADY_SUSPENDED',409); END IF;
  UPDATE public.rooms SET status='suspended',suspended_at=at_time,version=version+1 WHERE id=rid;
  UPDATE public.room_runs SET status='cancelled',cancelled_at=at_time,version=version+1 WHERE id=r.current_run_id AND status='active';
  UPDATE public.room_memberships SET status='removed',ended_at=at_time,version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE room_id=rid AND status='active';
  FOR target_member IN SELECT DISTINCT affected_member.* FROM public.room_memberships affected_member JOIN public.time_sessions ts ON ts.user_id=affected_member.user_id AND ts.room_id=rid
   WHERE affected_member.room_id=rid AND ts.status IN ('running','paused') LOOP
   PERFORM public.rooms_queue_account(target_member.user_id,at_time);
  END LOOP;
  INSERT INTO public.room_audit(room_id,actor_id,action,reason,created_at) VALUES(rid,p_actor,kind,p_command->>'reason',at_time);
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='report' THEN
  PERFORM public.rooms_rate(p_actor,'reports',at_time,10,true);
  IF p_command->>'targetMembershipId' IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.room_memberships WHERE user_id=p_actor AND room_id=rid) OR NOT EXISTS(SELECT 1 FROM public.room_memberships WHERE id=(p_command->>'targetMembershipId')::uuid AND room_id=rid) THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
  END IF;
  INSERT INTO public.room_reports(reporter_id,room_id,target_membership_id,reason,details,created_at)
  VALUES(p_actor,rid,(p_command->>'targetMembershipId')::uuid,p_command->>'reason',p_command->>'details',at_time);

 ELSIF kind IN ('block','unblock') THEN
  IF kind='block' THEN
   SELECT * INTO m FROM public.room_memberships WHERE user_id=p_actor AND room_id=rid;
   IF NOT public.rooms_member_live(m,at_time) THEN PERFORM public.rooms_raise('REJOIN_REQUIRED',403); END IF;
   SELECT * INTO target_member FROM public.room_memberships WHERE id=(p_command->>'targetMembershipId')::uuid AND room_id=rid;
   IF target_member.id IS NULL OR target_member.user_id=p_actor THEN PERFORM public.rooms_raise('INVALID_TARGET',422); END IF;
   IF NOT EXISTS(SELECT 1 FROM public.user_blocks WHERE blocker_id=p_actor AND blocked_id=target_member.user_id AND revoked_at IS NULL) THEN
    INSERT INTO public.user_blocks(blocker_id,blocked_id,context_membership_id,created_at) VALUES(p_actor,target_member.user_id,target_member.id,at_time);
   END IF;
  ELSE
   UPDATE public.user_blocks SET revoked_at=at_time WHERE id=(p_command->>'blockId')::uuid AND blocker_id=p_actor AND revoked_at IS NULL;
   IF NOT FOUND THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
  END IF;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='react' THEN
  m=public.rooms_assert_presence(p_actor,rid,device,(p_command->>'controlVersion')::integer,at_time);
  SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
  phase=public.rooms_phase(rr,at_time);
  IF phase->>'kind' NOT IN ('shortBreak','longBreak') THEN PERFORM public.rooms_raise('REACTIONS_BREAK_ONLY',409); END IF;
  IF m.last_reaction_at>at_time-interval '30 seconds' THEN PERFORM public.rooms_raise('REACTION_RATE_LIMIT',429); END IF;
  INSERT INTO public.room_reactions(room_id,membership_id,run_id,kind,created_at) VALUES(rid,m.id,rr.id,p_command->>'reaction',at_time);
  UPDATE public.room_memberships SET last_reaction_at=at_time WHERE id=m.id;
  PERFORM public.rooms_emit_locked(rid,at_time,true);

 ELSIF kind='reviewReport' THEN
  IF NOT public.rooms_is_moderator(p_actor) THEN PERFORM public.rooms_raise('MODERATOR_REQUIRED',403); END IF;
  UPDATE public.room_reports SET status='reviewed',reviewed_at=at_time,reviewer_id=p_actor WHERE id=(p_command->>'reportId')::uuid RETURNING room_id INTO rid;
  IF NOT FOUND THEN PERFORM public.rooms_raise('NOT_FOUND',404); END IF;
 ELSE PERFORM public.rooms_raise('INVALID_INPUT',422);
 END IF;
 IF rid IS NOT NULL THEN PERFORM public.rooms_schedule_locked(rid,at_time); END IF;
 rev=public.rooms_bump(p_actor);
 receipt=jsonb_build_object('operationId',op,'type',kind,'roomId',rid,'membershipId',member_id,'runId',new_run_id,'sessionId',affected_session,'revision',rev,'acceptedAt',at_time);
 INSERT INTO public.room_operations(user_id,operation_id,command,receipt,created_at) VALUES(p_actor,op,p_command,receipt,at_time);
 response=jsonb_build_object('data',public.rooms_me_json(p_actor,rid,at_time),'receipt',receipt,'replayed',false);
 IF kind IN ('join','switchToRoom','switchToSolo','leave','takeControl','joinRound') THEN response=response||jsonb_build_object('time',public.time_snapshot_locked(p_actor,affected_session)); END IF;
 RETURN response;
END $$;
