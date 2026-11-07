-- B5: one central ledger; Room sessions use immutable round deadlines.
CREATE OR REPLACE FUNCTION public.time_session_json(s public.time_sessions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',s.id,'mode',s.mode,'category',s.category,'status',s.status,
 'title',s.title,'enrollmentId',s.enrollment_id,'taskId',s.task_id,'createdAt',s.created_at,
 'finalizedAt',s.finalized_at,'revision',s.revision,'deviceId',s.device_id,
 'controlVersion',s.control_version,'leaseUntil',s.lease_until,'remainingSeconds',s.remaining_seconds,
 'settings',s.settings,'roundIndex',s.round_index,'previousSessionId',s.previous_session_id,
 'roomId',s.room_id,'participationId',s.participation_id,'roomDeadlineAt',s.room_deadline_at)
$$;
CREATE FUNCTION public.rooms_time_cutoff(s public.time_sessions,p_now timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN c.cutoff IS NULL THEN NULL ELSE greatest(s.created_at,c.cutoff) END FROM (SELECT least(s.room_deadline_at,
  (SELECT min(c.effective_at) FROM public.room_access_cutoffs c JOIN public.room_memberships m ON m.id=c.membership_id
   WHERE m.user_id=s.user_id AND c.room_id=s.room_id AND c.effective_at>=s.created_at),
  (SELECT r.suspended_at FROM public.rooms r WHERE r.id=s.room_id),
  (SELECT rr.cancelled_at FROM public.round_participations p JOIN public.room_runs rr ON rr.id=p.run_id WHERE p.id=s.participation_id),
  (SELECT min(a.effective_at) FROM public.account_suspensions a WHERE a.user_id=s.user_id AND a.effective_at<=p_now
   AND (a.revoked_at IS NULL OR a.revoked_at>s.created_at))) AS cutoff) c
$$;
CREATE OR REPLACE FUNCTION public.time_settle_locked(p_actor uuid,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s public.time_sessions%ROWTYPE; i public.time_intervals%ROWTYPE; cutoff timestamptz; locked_room uuid;
BEGIN
 -- Caller owns Account first. These locks precede interval/job changes.
 PERFORM public.rooms_lock_for_actor(p_actor);
 FOR locked_room IN SELECT m.room_id FROM public.room_memberships m WHERE m.user_id=p_actor AND status='active'
 UNION SELECT ts.room_id FROM public.time_sessions ts WHERE ts.user_id=p_actor AND ts.room_id IS NOT NULL AND status IN ('running','paused') LOOP
  PERFORM public.rooms_settle_locked(locked_room,p_now);
 END LOOP;
 SELECT * INTO s FROM public.time_sessions WHERE user_id=p_actor AND status IN ('running','paused');
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO i FROM public.time_intervals WHERE session_id=s.id AND end_at IS NULL;
 cutoff=public.rooms_time_cutoff(s,p_now);
 -- Administrative action cannot turn a previously capped Open period into verified time.
 IF s.status='running' AND s.mode='open' AND i.boundary_at<=p_now AND (cutoff IS NULL OR i.boundary_at<=cutoff) THEN
  UPDATE public.time_intervals SET end_at=i.boundary_at,eligibility='pending' WHERE id=i.id;
  UPDATE public.time_sessions SET status='needsReview',finalized_at=NULL,remaining_seconds=NULL,revision=revision+1 WHERE id=s.id;
  PERFORM public.time_bump(p_actor,'boundary:'||i.id::text,'boundary');
  RETURN;
 END IF;
 IF cutoff IS NOT NULL AND cutoff<=p_now THEN
  IF i.id IS NOT NULL THEN
   UPDATE public.time_intervals SET end_at=greatest(start_at,least(boundary_at,cutoff)),eligibility='eligible' WHERE id=i.id;
  END IF;
  UPDATE public.time_sessions SET status='finalized',finalized_at=cutoff,remaining_seconds=0,revision=revision+1 WHERE id=s.id;
  PERFORM public.time_bump(p_actor,'room-cutoff:'||s.id::text,'boundary');
  IF s.room_id IS NOT NULL THEN PERFORM public.rooms_emit_locked(s.room_id,p_now,true); END IF;
  RETURN;
 END IF;
 IF s.status<>'running' OR i.id IS NULL OR i.boundary_at>p_now THEN RETURN; END IF;
 UPDATE public.time_intervals SET end_at=i.boundary_at,eligibility=CASE WHEN s.mode='open' THEN 'pending' ELSE 'eligible' END WHERE id=i.id;
 UPDATE public.time_sessions SET status=CASE WHEN mode='open' THEN 'needsReview' ELSE 'finalized' END,
 finalized_at=CASE WHEN mode='open' THEN NULL ELSE i.boundary_at END,
 remaining_seconds=CASE WHEN mode='open' THEN NULL ELSE 0 END,revision=revision+1 WHERE id=s.id;
 PERFORM public.time_bump(p_actor,'boundary:'||i.id::text,'boundary');
END $$;

CREATE OR REPLACE FUNCTION public.execute_time_command_core(p_actor uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  op uuid=(p_command->>'operationId')::uuid;
  kind text=p_command->>'type';
  expected bigint=(p_command->>'expectedRevision')::bigint;
  current_revision bigint; new_revision bigint; at_time timestamptz;
  s public.time_sessions%ROWTYPE; i public.time_intervals%ROWTYPE;
  prior public.time_operations%ROWTYPE;
  sid uuid; iid uuid; boundary timestamptz; reported timestamptz;
  original jsonb; original_id uuid; receipt jsonb; result_outcome text='applied';
  next_round integer=1; remaining numeric; had_open boolean=false;
BEGIN
  PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
  at_time=date_trunc('milliseconds',clock_timestamp());
  -- Receipts win before stale revision/control checks and before offline classification.
  SELECT * INTO prior FROM public.time_operations WHERE user_id=p_actor AND operation_id=op;
  IF FOUND THEN
    IF prior.command<>p_command THEN RETURN public.time_error(p_actor,'IDEMPOTENCY_MISMATCH',409); END IF;
    PERFORM public.time_settle_locked(p_actor,at_time);
    RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,(prior.receipt->>'sessionId')::uuid),'receipt',prior.receipt,'replayed',true);
  END IF;
  IF kind='offlineStop' THEN
    original=p_command->'originalCommand'; original_id=(original->>'operationId')::uuid;
    IF original_id=op OR original->>'type' NOT IN ('pause','finish') OR original->>'intervalId' IS NULL THEN
      RETURN public.time_error(p_actor,'INVALID_INPUT',422);
    END IF;
    SELECT * INTO prior FROM public.time_operations WHERE user_id=p_actor AND operation_id=original_id;
    IF FOUND THEN
      IF prior.command<>original THEN RETURN public.time_error(p_actor,'IDEMPOTENCY_MISMATCH',409); END IF;
      PERFORM public.time_settle_locked(p_actor,at_time);
      -- Remember this reconciliation too, while returning the original immutable receipt.
      INSERT INTO public.time_operations(user_id,operation_id,command,receipt) VALUES(p_actor,op,p_command,prior.receipt);
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,(prior.receipt->>'sessionId')::uuid),'receipt',prior.receipt,'replayed',true);
    END IF;
  END IF;
  PERFORM public.time_settle_locked(p_actor,at_time);
  current_revision=coalesce((SELECT revision FROM public.time_accounts WHERE user_id=p_actor),0);
  IF kind='start' AND EXISTS(SELECT 1 FROM public.time_sessions WHERE user_id=p_actor AND status IN ('running','paused','needsReview')) THEN
    RETURN public.time_error(p_actor,'ACTIVE_SESSION',409);
  END IF;
  -- A bounded lease receipt does not grow the permanent operation ledger every30seconds.
  IF kind='renew' THEN
    SELECT * INTO s FROM public.time_sessions WHERE id=(p_command->>'sessionId')::uuid AND user_id=p_actor;
    IF NOT FOUND THEN RETURN public.time_error(p_actor,'NOT_FOUND',404); END IF;
    IF s.last_lease_command->>'operationId'=op::text THEN
      IF s.last_lease_command<>p_command THEN RETURN public.time_error(p_actor,'IDEMPOTENCY_MISMATCH',409); END IF;
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,s.id),'receipt',s.last_lease_receipt,'replayed',true);
    END IF;
  END IF;
  IF current_revision<>expected THEN RETURN public.time_error(p_actor,'REVISION_CONFLICT',409); END IF;

  IF kind='start' THEN
    IF (p_command->>'mode'='solo')<>(jsonb_typeof(p_command->'settings')='object') THEN
      RETURN public.time_error(p_actor,'INVALID_INPUT',422);
    END IF;
    IF p_command->>'taskId' IS NOT NULL AND p_command->>'enrollmentId' IS NULL THEN
      RETURN public.time_error(p_actor,'INVALID_INPUT',422);
    END IF;
    IF p_command->>'category'='work' AND p_command->>'enrollmentId' IS NOT NULL THEN
      RETURN public.time_error(p_actor,'INVALID_INPUT',422);
    END IF;
    IF p_command->>'enrollmentId' IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.learning_workspaces w,jsonb_array_elements(w.state->'enrollments') e
      WHERE w.user_id=p_actor AND e->>'id'=p_command->>'enrollmentId'
      AND (p_command->>'taskId' IS NULL OR (e->'taskIds') ? (p_command->>'taskId'))
    ) THEN RETURN public.time_error(p_actor,'NOT_FOUND',404); END IF;
    IF p_command->>'previousSessionId' IS NOT NULL THEN
      SELECT * INTO s FROM public.time_sessions WHERE id=(p_command->>'previousSessionId')::uuid AND user_id=p_actor;
      IF NOT FOUND OR s.mode<>'solo' OR s.status<>'finalized' OR p_command->>'mode'<>'solo' THEN
        RETURN public.time_error(p_actor,'INVALID_PREVIOUS_ROUND',409);
      END IF;
      IF EXISTS(SELECT 1 FROM public.time_sessions WHERE previous_session_id=s.id) THEN
        RETURN public.time_error(p_actor,'ROUND_ALREADY_STARTED',409);
      END IF;
      next_round=s.round_index+1;
    END IF;
    remaining=CASE WHEN p_command->>'mode'='solo' THEN (p_command->'settings'->>'focusMinutes')::integer*60 ELSE NULL END;
    boundary=at_time+make_interval(secs=>coalesce(remaining,14400)::double precision);
    INSERT INTO public.time_sessions(user_id,mode,category,status,title,enrollment_id,task_id,created_at,
      device_id,lease_until,remaining_seconds,settings,round_index,previous_session_id)
    VALUES(p_actor,p_command->>'mode',p_command->>'category','running',p_command->>'title',
      (p_command->>'enrollmentId')::uuid,p_command->>'taskId',at_time,(p_command->>'deviceId')::uuid,
      at_time+interval '90 seconds',remaining,nullif(p_command->'settings','null'),next_round,(p_command->>'previousSessionId')::uuid)
    RETURNING id INTO sid;
    iid=public.time_open_interval(p_actor,sid,at_time,boundary,(p_command->>'deviceId')::uuid,1);

  ELSIF kind='manual' THEN
    reported=(p_command->>'endAt')::timestamptz;
    boundary=(p_command->>'startAt')::timestamptz;
    IF reported>at_time OR reported<=boundary OR reported-boundary>interval '24 hours' THEN
      RETURN public.time_error(p_actor,'INVALID_MANUAL_RANGE',422);
    END IF;
    IF EXISTS(SELECT 1 FROM public.time_intervals WHERE user_id=p_actor
      AND tstzrange(start_at,coalesce(effective_end_at,end_at,boundary_at),'[)') && tstzrange(boundary,reported,'[)')) THEN
      RETURN public.time_error(p_actor,'TIME_OVERLAP',409);
    END IF;
    INSERT INTO public.time_sessions(user_id,mode,category,status,title,created_at,finalized_at,device_id,lease_until)
    VALUES(p_actor,'open',p_command->>'category','finalized',p_command->>'title',at_time,at_time,gen_random_uuid(),at_time)
    RETURNING * INTO s;
    sid=s.id;
    INSERT INTO public.time_intervals(user_id,session_id,start_at,end_at,boundary_at,source,eligibility,device_id,control_version,created_at)
    VALUES(p_actor,sid,boundary,reported,reported,'manual','personal',s.device_id,1,at_time) RETURNING id INTO iid;

  ELSIF kind IN ('offlineStop','correctInterval') THEN
    sid=CASE WHEN kind='offlineStop' THEN (original->>'sessionId')::uuid ELSE (p_command->>'sessionId')::uuid END;
    iid=CASE WHEN kind='offlineStop' THEN (original->>'intervalId')::uuid ELSE (p_command->>'intervalId')::uuid END;
    SELECT * INTO s FROM public.time_sessions WHERE id=sid AND user_id=p_actor;
    IF NOT FOUND THEN RETURN public.time_error(p_actor,'NOT_FOUND',404); END IF;
    SELECT * INTO i FROM public.time_intervals WHERE id=iid AND session_id=sid AND user_id=p_actor;
    IF NOT FOUND THEN RETURN public.time_error(p_actor,'NOT_FOUND',404); END IF;
    IF kind='offlineStop' AND (i.device_id<>(original->>'deviceId')::uuid OR i.control_version<>(original->>'controlVersion')::integer) THEN
      RETURN public.time_error(p_actor,'CONTROL_LOST',409);
    END IF;
    reported=(p_command->>'reportedEndAt')::timestamptz;
    IF reported<i.start_at OR reported>at_time THEN RETURN public.time_error(p_actor,'INVALID_CORRECTION_RANGE',422); END IF;
    had_open=i.end_at IS NULL;
    IF kind='correctInterval' AND had_open THEN RETURN public.time_error(p_actor,'INTERVAL_STILL_RUNNING',409); END IF;
    IF kind='correctInterval' AND reported>i.end_at THEN RETURN public.time_error(p_actor,'INVALID_CORRECTION_RANGE',422); END IF;
    IF kind='offlineStop' AND had_open THEN
      UPDATE public.time_intervals SET end_at=least(at_time,boundary_at) WHERE id=i.id RETURNING * INTO i;
    END IF;
    -- A local intent at/after an already accepted boundary does not invalidate that boundary.
    -- Only an actually shortened period becomes personal; older periods retain provenance.
    IF kind='correctInterval' OR reported<i.end_at THEN
      IF EXISTS(SELECT 1 FROM public.time_intervals x WHERE x.user_id=p_actor AND x.id<>i.id
        AND tstzrange(x.start_at,coalesce(x.effective_end_at,x.end_at,x.boundary_at),'[)') && tstzrange(i.start_at,reported,'[)')) THEN
        RETURN public.time_error(p_actor,'TIME_OVERLAP',409);
      END IF;
      INSERT INTO public.time_corrections(user_id,session_id,interval_id,previous_end_at,reported_end_at,reason,original_operation_id,created_at)
      VALUES(p_actor,sid,iid,coalesce(i.effective_end_at,i.end_at),reported,
        CASE WHEN kind='offlineStop' THEN 'offline-stop' ELSE 'manual-correction' END,original_id,at_time);
      UPDATE public.time_intervals SET effective_end_at=reported,eligibility='personal' WHERE id=iid;
    END IF;
    IF had_open THEN
      UPDATE public.time_sessions SET status=CASE WHEN original->>'type'='pause' THEN 'paused' ELSE 'finalized' END,
        finalized_at=CASE WHEN original->>'type'='pause' THEN NULL ELSE at_time END,
        remaining_seconds=CASE WHEN mode IN ('solo','room') THEN greatest(0,extract(epoch FROM i.boundary_at-least(reported,i.end_at))) ELSE NULL END,
        revision=revision+1 WHERE id=sid;
    ELSIF kind='offlineStop' AND s.status='paused' AND s.control_version=i.control_version AND s.device_id=i.device_id
      AND NOT EXISTS(SELECT 1 FROM public.time_intervals newer WHERE newer.session_id=sid AND newer.ordinal>i.ordinal) THEN
      -- No newer period/control exists: preserve an earlier pause's remaining work,
      -- or finalize the paused session for an explicit original Finish intent.
      UPDATE public.time_sessions SET status=CASE WHEN original->>'type'='pause' THEN 'paused' ELSE 'finalized' END,
        finalized_at=CASE WHEN original->>'type'='pause' THEN NULL ELSE at_time END,
        remaining_seconds=CASE WHEN mode IN ('solo','room') THEN greatest(0,extract(epoch FROM i.boundary_at-least(reported,i.end_at))) ELSE NULL END,
        revision=revision+1 WHERE id=sid;
    ELSIF s.status='needsReview' AND i.eligibility='pending' AND (kind='correctInterval' OR
      (reported<i.end_at AND s.control_version=i.control_version AND s.device_id=i.device_id
       AND NOT EXISTS(SELECT 1 FROM public.time_intervals newer WHERE newer.session_id=sid AND newer.ordinal>i.ordinal))) THEN
      UPDATE public.time_sessions SET status=CASE WHEN kind='offlineStop' AND original->>'type'='pause' THEN 'paused' ELSE 'finalized' END,
        finalized_at=CASE WHEN kind='offlineStop' AND original->>'type'='pause' THEN NULL ELSE at_time END,revision=revision+1 WHERE id=sid;
    END IF;
    result_outcome=CASE WHEN kind='offlineStop' THEN 'offline-correction' ELSE 'applied' END;

  ELSE
    sid=(p_command->>'sessionId')::uuid;
    SELECT * INTO s FROM public.time_sessions WHERE id=sid AND user_id=p_actor;
    IF NOT FOUND THEN RETURN public.time_error(p_actor,'NOT_FOUND',404); END IF;
    IF s.control_version<>(p_command->>'controlVersion')::integer OR
      (kind<>'claimControl' AND s.device_id<>(p_command->>'deviceId')::uuid) THEN
      RETURN public.time_error(p_actor,'CONTROL_LOST',409);
    END IF;
    IF s.status='finalized' THEN RETURN public.time_error(p_actor,'SESSION_FINALIZED',409); END IF;
    SELECT * INTO i FROM public.time_intervals WHERE session_id=sid AND end_at IS NULL;
    iid=i.id;
    IF kind IN ('pause','finish') AND (p_command->>'intervalId')::uuid IS DISTINCT FROM iid THEN
      RETURN public.time_error(p_actor,'INTERVAL_CHANGED',409);
    END IF;
    IF kind='renew' THEN
      receipt=jsonb_build_object('operationId',op,'type',kind,'sessionId',sid,'intervalId',iid,
        'revision',current_revision,'acceptedAt',at_time,'outcome','applied');
      UPDATE public.time_sessions SET lease_until=at_time+interval '90 seconds',last_lease_command=p_command,last_lease_receipt=receipt WHERE id=sid;
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,sid),'receipt',receipt,'replayed',false);
    ELSIF kind='claimControl' THEN
      IF s.status='running' THEN
        UPDATE public.time_intervals SET end_at=at_time WHERE id=iid;
        -- Technical device split preserves boundary: changing devices cannot reset the cap.
        iid=public.time_open_interval(p_actor,sid,at_time,i.boundary_at,(p_command->>'deviceId')::uuid,s.control_version+1);
      END IF;
      UPDATE public.time_sessions SET device_id=(p_command->>'deviceId')::uuid,control_version=control_version+1,
        lease_until=at_time+interval '90 seconds',revision=revision+1,last_lease_command=NULL,last_lease_receipt=NULL WHERE id=sid;
    ELSIF kind='pause' THEN
      IF s.status<>'running' THEN RETURN public.time_error(p_actor,'SESSION_NOT_RUNNING',409); END IF;
      UPDATE public.time_intervals SET end_at=at_time WHERE id=iid;
      UPDATE public.time_sessions SET status='paused',remaining_seconds=CASE WHEN mode IN ('solo','room') THEN extract(epoch FROM i.boundary_at-at_time) ELSE NULL END,
        lease_until=at_time+interval '90 seconds',revision=revision+1 WHERE id=sid;
    ELSIF kind='resume' THEN
      IF s.status<>'paused' THEN RETURN public.time_error(p_actor,'SESSION_NOT_PAUSED',409); END IF;
      boundary=CASE WHEN s.mode='room' THEN s.room_deadline_at ELSE at_time+make_interval(secs=>CASE WHEN s.mode='open' THEN 14400 ELSE s.remaining_seconds::double precision END) END;
      IF boundary<=at_time THEN RETURN public.time_error(p_actor,'NO_REMAINING_TIME',409); END IF;
      iid=public.time_open_interval(p_actor,sid,at_time,boundary,s.device_id,s.control_version);
      UPDATE public.time_sessions SET status='running',lease_until=at_time+interval '90 seconds',revision=revision+1 WHERE id=sid;
    ELSIF kind='finish' THEN
      IF s.status='needsReview' THEN RETURN public.time_error(p_actor,'REVIEW_REQUIRED',409); END IF;
      IF iid IS NOT NULL THEN UPDATE public.time_intervals SET end_at=at_time WHERE id=iid; END IF;
      UPDATE public.time_sessions SET status='finalized',finalized_at=at_time,revision=revision+1 WHERE id=sid;
    ELSIF kind='review' THEN
      IF s.status<>'needsReview' THEN RETURN public.time_error(p_actor,'REVIEW_NOT_REQUIRED',409); END IF;
      UPDATE public.time_intervals SET eligibility='eligible' WHERE session_id=sid AND eligibility='pending';
      UPDATE public.time_sessions SET status='finalized',finalized_at=at_time,revision=revision+1 WHERE id=sid;
    ELSE
      RETURN public.time_error(p_actor,'INVALID_INPUT',422);
    END IF;
  END IF;

  new_revision=public.time_bump(p_actor,'command:'||p_actor::text||':'||op::text,kind);
  receipt=jsonb_build_object('operationId',op,'type',kind,'sessionId',sid,'intervalId',iid,
    'revision',new_revision,'acceptedAt',at_time,'outcome',result_outcome);
  INSERT INTO public.time_operations(user_id,operation_id,command,receipt) VALUES(p_actor,op,p_command,receipt);
  IF kind='offlineStop' THEN
    -- Tombstone the exact original request atomically, even if it arrives after reconciliation.
    INSERT INTO public.time_operations(user_id,operation_id,command,receipt)
    VALUES(p_actor,original_id,original,receipt||jsonb_build_object('operationId',original_id,'type',original->>'type'));
  END IF;
  RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,sid),'receipt',receipt,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.execute_time_command(p_actor uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text=p_command->>'type'; target_session uuid; s public.time_sessions%ROWTYPE;
 m public.room_memberships%ROWTYPE; at_time timestamptz; response jsonb; target_room uuid;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.rooms_raise('AUTH_REQUIRED',401); END IF;
 target_session=CASE WHEN kind='offlineStop' THEN (p_command->'originalCommand'->>'sessionId')::uuid ELSE (p_command->>'sessionId')::uuid END;
 SELECT * INTO s FROM public.time_sessions WHERE id=target_session AND user_id=p_actor;
 target_room=s.room_id;
 PERFORM public.rooms_lock_for_actor(p_actor,ARRAY[target_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 -- The established immutable receipt must win even after leaving or losing room access.
 IF EXISTS(SELECT 1 FROM public.time_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid)
 OR (kind='offlineStop' AND EXISTS(SELECT 1 FROM public.time_operations WHERE user_id=p_actor AND operation_id=(p_command->'originalCommand'->>'operationId')::uuid)) THEN
  RETURN public.execute_time_command_core(p_actor,p_command);
 END IF;
 PERFORM public.time_settle_locked(p_actor,at_time);
 SELECT * INTO m FROM public.room_memberships WHERE user_id=p_actor AND status='active';
 IF public.rooms_is_suspended(p_actor) AND kind IN ('start','resume','manual') THEN RETURN public.time_error(p_actor,'ACCOUNT_SUSPENDED',403); END IF;
 IF kind='start' AND public.rooms_member_live(m,at_time) THEN RETURN public.time_error(p_actor,'ACTIVE_MEMBERSHIP',409); END IF;
 IF s.mode='room' AND kind='resume' AND (m.room_id IS DISTINCT FROM s.room_id OR NOT public.rooms_member_live(m,at_time)) THEN
  RETURN public.time_error(p_actor,'REJOIN_REQUIRED',409);
 END IF;
 response=public.execute_time_command_core(p_actor,p_command);
 IF response ? 'error' OR coalesce((response->>'replayed')::boolean,false) THEN RETURN response; END IF;
 IF kind='claimControl' AND s.mode='room' AND m.room_id=s.room_id AND public.rooms_member_live(m,at_time) THEN
  SELECT * INTO s FROM public.time_sessions WHERE id=s.id;
  UPDATE public.room_memberships SET device_id=s.device_id,control_version=s.control_version,last_seen_at=at_time,
   version=version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE id=m.id;
  UPDATE public.rooms SET last_activity_at=greatest(last_activity_at,at_time),
   host_last_seen_at=CASE WHEN current_host_membership_id=m.id THEN at_time ELSE host_last_seen_at END WHERE id=s.room_id;
  PERFORM public.rooms_bump(p_actor);
 END IF;
 IF target_room IS NOT NULL AND kind IN ('pause','resume','finish','claimControl','offlineStop') THEN
  PERFORM public.rooms_emit_locked(target_room,at_time,true);
  PERFORM public.rooms_schedule_locked(target_room,at_time);
 END IF;
 RETURN response;
END $$;
CREATE OR REPLACE FUNCTION public.execute_time_job(p_job uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.time_jobs%ROWTYPE; actor uuid; at_time timestamptz;
BEGIN
 SELECT user_id INTO actor FROM public.time_jobs WHERE id=p_job;
 IF actor IS NULL THEN RETURN jsonb_build_object('status','missing'); END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 PERFORM public.rooms_lock_for_actor(actor);
 -- A claimed lease is committed separately; Account -> Rooms/Runs -> Job here.
 SELECT * INTO j FROM public.time_jobs WHERE id=p_job FOR UPDATE;
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF j.status='done' THEN RETURN jsonb_build_object('status','done','replayed',true); END IF;
 IF j.status<>'running' OR j.claim_token IS DISTINCT FROM p_claim OR j.lease_until<=at_time THEN RETURN jsonb_build_object('status','stale'); END IF;
 IF EXISTS(SELECT 1 FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id
 WHERE i.id=j.interval_id AND i.boundary_at=j.boundary_at AND j.boundary_at<=at_time
 AND (i.end_at IS NULL OR (s.mode='room' AND s.status IN ('running','paused') AND s.room_deadline_at=j.boundary_at))) THEN
  PERFORM public.time_settle_locked(actor,at_time);
 END IF;
 UPDATE public.time_jobs SET status='done',completed_at=at_time,lease_until=NULL,claim_token=NULL,last_error=NULL WHERE id=j.id;
 RETURN jsonb_build_object('status','done','replayed',false);
END $$;
