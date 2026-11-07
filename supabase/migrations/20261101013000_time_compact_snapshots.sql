-- B4: bounded control/command snapshots. Explicit paginated history keeps its requested limit.
-- Commands/replays include their affected session, even when its creation predates newer manual entries.
CREATE OR REPLACE FUNCTION public.time_snapshot_locked(p_actor uuid,p_session uuid DEFAULT NULL,p_category text DEFAULT NULL,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ids uuid[]; records jsonb; active jsonb; cursor text; totals jsonb; last_record public.time_sessions%ROWTYPE;
BEGIN
 SELECT public.time_session_json(s) INTO active FROM public.time_sessions s
 WHERE user_id=p_actor AND status IN ('running','paused','needsReview');
 SELECT array_agg(id ORDER BY created_at DESC,id DESC) INTO ids FROM (
  SELECT id,created_at FROM public.time_sessions WHERE user_id=p_actor
  AND (p_session IS NULL OR id=p_session) AND (p_category IS NULL OR category=p_category)
  AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id))
  ORDER BY created_at DESC,id DESC LIMIT p_limit+1
 ) q;
 IF cardinality(ids)>p_limit THEN
  ids=ids[1:p_limit];
  SELECT * INTO last_record FROM public.time_sessions WHERE id=ids[p_limit];
  cursor=to_char(last_record.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||'|'||last_record.id::text;
 END IF;
 IF active IS NOT NULL AND NOT(coalesce(ids,ARRAY[]::uuid[]) @> ARRAY[(active->>'id')::uuid]) THEN
  ids=array_append(coalesce(ids,ARRAY[]::uuid[]),(active->>'id')::uuid);
 END IF;
 SELECT coalesce(jsonb_agg(public.time_session_json(s) ORDER BY created_at DESC,id DESC),'[]') INTO records
 FROM public.time_sessions s WHERE id=ANY(ids);
 SELECT jsonb_build_object(
 'eligibleSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='eligible' AND status='finalized'),0),
 'personalSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='personal'),0),
 'pendingSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='pending' OR (eligibility='eligible' AND status<>'finalized')),0)) INTO totals
 FROM (SELECT i.eligibility,s.status,greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at,clock_timestamp()),i.boundary_at)-i.start_at)) seconds
 FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id WHERE i.user_id=p_actor) q;
 RETURN jsonb_build_object('accountId',p_actor,'revision',coalesce((SELECT revision FROM public.time_accounts WHERE user_id=p_actor),0),
 'serverTime',date_trunc('milliseconds',clock_timestamp()),'active',active,'sessions',records,'nextCursor',cursor,'totals',totals,
 'intervals',coalesce((SELECT jsonb_agg(public.time_interval_json(i) ORDER BY i.start_at,i.ordinal) FROM public.time_intervals i WHERE session_id=ANY(ids)),'[]'),
 'corrections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'sessionId',c.session_id,'intervalId',c.interval_id,
 'previousEndAt',c.previous_end_at,'reportedEndAt',c.reported_end_at,'reason',c.reason,'originalOperationId',c.original_operation_id,'createdAt',c.created_at)
 ORDER BY c.created_at,c.id) FROM public.time_corrections c WHERE session_id=ANY(ids)),'[]'));
END $$;

CREATE OR REPLACE FUNCTION public.execute_time_command(p_actor uuid,p_command jsonb) RETURNS jsonb
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
        remaining_seconds=CASE WHEN mode='solo' THEN greatest(0,extract(epoch FROM i.boundary_at-least(reported,i.end_at))) ELSE NULL END,
        revision=revision+1 WHERE id=sid;
    ELSIF kind='offlineStop' AND s.status='paused' AND s.control_version=i.control_version AND s.device_id=i.device_id
      AND NOT EXISTS(SELECT 1 FROM public.time_intervals newer WHERE newer.session_id=sid AND newer.ordinal>i.ordinal) THEN
      -- No newer period/control exists: preserve an earlier pause's remaining work,
      -- or finalize the paused session for an explicit original Finish intent.
      UPDATE public.time_sessions SET status=CASE WHEN original->>'type'='pause' THEN 'paused' ELSE 'finalized' END,
        finalized_at=CASE WHEN original->>'type'='pause' THEN NULL ELSE at_time END,
        remaining_seconds=CASE WHEN mode='solo' THEN greatest(0,extract(epoch FROM i.boundary_at-least(reported,i.end_at))) ELSE NULL END,
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
      UPDATE public.time_sessions SET status='paused',remaining_seconds=CASE WHEN mode='solo' THEN extract(epoch FROM i.boundary_at-at_time) ELSE NULL END,
        lease_until=at_time+interval '90 seconds',revision=revision+1 WHERE id=sid;
    ELSIF kind='resume' THEN
      IF s.status<>'paused' THEN RETURN public.time_error(p_actor,'SESSION_NOT_PAUSED',409); END IF;
      boundary=at_time+make_interval(secs=>CASE WHEN s.mode='open' THEN 14400 ELSE s.remaining_seconds::double precision END);
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

CREATE OR REPLACE FUNCTION public.read_time_receipt(p_actor uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.time_operations%ROWTYPE;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 SELECT * INTO r FROM public.time_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN public.time_error(p_actor,'OPERATION_NOT_FOUND',404); END IF;
 IF r.command<>p_command THEN RETURN public.time_error(p_actor,'IDEMPOTENCY_MISMATCH',409); END IF;
 PERFORM public.time_settle_locked(p_actor,date_trunc('milliseconds',clock_timestamp()));
 RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor,(r.receipt->>'sessionId')::uuid),'receipt',r.receipt,'replayed',true);
END $$;

NOTIFY pgrst,'reload schema';
