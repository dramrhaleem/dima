-- B4: one authoritative time ledger, shared by personal and future room sessions.
-- All writes take auth.users account lock; GiST additionally rejects interval overlap.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.time_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE public.time_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('open','solo','room')),
  category text NOT NULL CHECK (category IN ('learning','work')),
  status text NOT NULL CHECK (status IN ('running','paused','needsReview','finalized')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  enrollment_id uuid, task_id text,
  created_at timestamptz NOT NULL,
  finalized_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  device_id uuid NOT NULL,
  control_version integer NOT NULL DEFAULT 1 CHECK (control_version > 0),
  lease_until timestamptz NOT NULL,
  remaining_seconds numeric CHECK (remaining_seconds >= 0),
  settings jsonb,
  round_index integer NOT NULL DEFAULT 1 CHECK (round_index > 0),
  previous_session_id uuid,
  room_id uuid, participation_id uuid,
  UNIQUE (id,user_id),
  FOREIGN KEY (previous_session_id,user_id) REFERENCES public.time_sessions(id,user_id)
);
CREATE UNIQUE INDEX time_one_active_account ON public.time_sessions(user_id)
  WHERE status IN ('running','paused','needsReview');
CREATE UNIQUE INDEX time_one_next_round ON public.time_sessions(previous_session_id)
  WHERE previous_session_id IS NOT NULL;
CREATE INDEX time_history ON public.time_sessions(user_id,created_at DESC,id DESC);

CREATE TABLE public.time_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  boundary_at timestamptz NOT NULL,
  effective_end_at timestamptz,
  source text NOT NULL CHECK (source IN ('server','manual')),
  eligibility text NOT NULL CHECK (eligibility IN ('eligible','personal','pending')),
  device_id uuid NOT NULL, control_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (session_id,user_id) REFERENCES public.time_sessions(id,user_id) ON DELETE CASCADE,
  UNIQUE (id,user_id),
  UNIQUE (id,session_id,user_id),
  CHECK (boundary_at >= start_at),
  CHECK (end_at IS NULL OR end_at BETWEEN start_at AND boundary_at),
  CHECK (effective_end_at IS NULL OR (end_at IS NOT NULL AND effective_end_at BETWEEN start_at AND end_at)),
  EXCLUDE USING gist (user_id WITH =, tstzrange(start_at,coalesce(effective_end_at,end_at,boundary_at),'[)') WITH &&)
);
CREATE UNIQUE INDEX time_one_open_interval ON public.time_intervals(session_id) WHERE end_at IS NULL;
CREATE INDEX time_intervals_owner ON public.time_intervals(user_id,start_at,id);
CREATE TABLE public.time_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.time_sessions(id) ON DELETE CASCADE,
  interval_id uuid NOT NULL REFERENCES public.time_intervals(id) ON DELETE CASCADE,
  previous_end_at timestamptz NOT NULL,
  reported_end_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN ('offline-stop','manual-correction')),
  original_operation_id uuid,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (interval_id,session_id,user_id) REFERENCES public.time_intervals(id,session_id,user_id) ON DELETE CASCADE
);
CREATE TABLE public.time_operations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  command jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,operation_id)
);
-- Boundary jobs are durable and idempotent. No ticks or elapsed time live in Worker memory.
CREATE TABLE public.time_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  interval_id uuid NOT NULL REFERENCES public.time_intervals(id) ON DELETE CASCADE,
  boundary_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_run_at timestamptz NOT NULL,
  lease_until timestamptz,
  claim_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (interval_id,user_id) REFERENCES public.time_intervals(id,user_id) ON DELETE CASCADE
);
CREATE INDEX time_jobs_due ON public.time_jobs(status,next_run_at,lease_until);
CREATE TABLE public.time_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  revision bigint NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Outbox is a durable version-invalidation log, not a copy of private task/session content.
-- HTTP snapshots remain authoritative; B5 can consume the same log for realtime invalidation.

ALTER TABLE public.time_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_outbox ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['time_accounts','time_sessions','time_intervals','time_corrections','time_operations'] LOOP
    EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING (user_id=(select auth.uid()))',t);
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.%I FROM anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END LOOP;
END $$;
GRANT ALL ON public.time_accounts,public.time_sessions,public.time_intervals,public.time_corrections,
  public.time_operations,public.time_jobs,public.time_outbox TO service_role;
REVOKE ALL ON public.time_jobs,public.time_outbox FROM anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.time_intervals_ordinal_seq TO service_role;

CREATE FUNCTION public.time_session_json(s public.time_sessions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',s.id,'mode',s.mode,'category',s.category,'status',s.status,
 'title',s.title,'enrollmentId',s.enrollment_id,'taskId',s.task_id,'createdAt',s.created_at,
 'finalizedAt',s.finalized_at,'revision',s.revision,'deviceId',s.device_id,
 'controlVersion',s.control_version,'leaseUntil',s.lease_until,'remainingSeconds',s.remaining_seconds,
 'settings',s.settings,'roundIndex',s.round_index,'previousSessionId',s.previous_session_id,
 'roomId',s.room_id,'participationId',s.participation_id)
$$;
CREATE FUNCTION public.time_interval_json(i public.time_intervals) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',i.id,'sessionId',i.session_id,'startAt',i.start_at,'endAt',i.end_at,
 'boundaryAt',i.boundary_at,'effectiveEndAt',i.effective_end_at,'source',i.source,
 'eligibility',i.eligibility,'deviceId',i.device_id,'controlVersion',i.control_version,'createdAt',i.created_at)
$$;
CREATE FUNCTION public.time_bump(p_actor uuid,p_key text,p_type text) RETURNS bigint
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE rev bigint;
BEGIN
 INSERT INTO public.time_accounts(user_id,revision) VALUES(p_actor,1)
 ON CONFLICT(user_id) DO UPDATE SET revision=public.time_accounts.revision+1 RETURNING revision INTO rev;
 INSERT INTO public.time_outbox(user_id,dedupe_key,revision,event_type)
 VALUES(p_actor,p_key,rev,p_type) ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN rev;
END $$;
CREATE FUNCTION public.time_open_interval(p_actor uuid,p_session uuid,p_at timestamptz,p_boundary timestamptz,p_device uuid,p_control integer) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE interval_id uuid;
BEGIN
 INSERT INTO public.time_intervals(user_id,session_id,start_at,boundary_at,source,eligibility,device_id,control_version,created_at)
 VALUES(p_actor,p_session,p_at,p_boundary,'server','eligible',p_device,p_control,p_at) RETURNING id INTO interval_id;
 INSERT INTO public.time_jobs(user_id,dedupe_key,interval_id,boundary_at,next_run_at)
 VALUES(p_actor,'boundary:'||interval_id::text,interval_id,p_boundary,p_boundary);
 RETURN interval_id;
END $$;
CREATE FUNCTION public.time_settle_locked(p_actor uuid,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s public.time_sessions%ROWTYPE; i public.time_intervals%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.time_sessions WHERE user_id=p_actor AND status='running';
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO i FROM public.time_intervals WHERE session_id=s.id AND end_at IS NULL;
 IF NOT FOUND OR i.boundary_at>p_now THEN RETURN; END IF;
 UPDATE public.time_intervals SET end_at=i.boundary_at,
 eligibility=CASE WHEN s.mode='open' THEN 'pending' ELSE 'eligible' END WHERE id=i.id;
 UPDATE public.time_sessions SET status=CASE WHEN mode='open' THEN 'needsReview' ELSE 'finalized' END,
 finalized_at=CASE WHEN mode='open' THEN NULL ELSE i.boundary_at END,
 remaining_seconds=CASE WHEN mode='open' THEN NULL ELSE 0 END,revision=revision+1 WHERE id=s.id;
 PERFORM public.time_bump(p_actor,'boundary:'||i.id::text,'boundary');
END $$;
CREATE FUNCTION public.time_snapshot_locked(p_actor uuid,p_session uuid DEFAULT NULL,p_category text DEFAULT NULL,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
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
CREATE FUNCTION public.read_time_state(p_actor uuid,p_session uuid DEFAULT NULL,p_category text DEFAULT NULL,
 p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 PERFORM public.time_settle_locked(p_actor,date_trunc('milliseconds',clock_timestamp()));
 IF p_session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.time_sessions WHERE id=p_session AND user_id=p_actor) THEN
  RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';
 END IF;
 RETURN public.time_snapshot_locked(p_actor,p_session,p_category,p_before,p_before_id,p_limit);
END $$;
CREATE FUNCTION public.time_error(p_actor uuid,p_code text,p_status integer) RETURNS jsonb
LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('error',jsonb_build_object('code',p_code,'status',p_status),'data',public.time_snapshot_locked(p_actor))
$$;
ALTER TABLE public.time_sessions ADD COLUMN last_lease_command jsonb;
ALTER TABLE public.time_sessions ADD COLUMN last_lease_receipt jsonb;

CREATE FUNCTION public.execute_time_command(p_actor uuid,p_command jsonb) RETURNS jsonb
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
    RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',prior.receipt,'replayed',true);
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
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',prior.receipt,'replayed',true);
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
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',s.last_lease_receipt,'replayed',true);
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
      RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',receipt,'replayed',false);
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
  RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',receipt,'replayed',false);
END $$;

CREATE FUNCTION public.read_time_receipt(p_actor uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.time_operations%ROWTYPE;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 SELECT * INTO r FROM public.time_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN public.time_error(p_actor,'OPERATION_NOT_FOUND',404); END IF;
 IF r.command<>p_command THEN RETURN public.time_error(p_actor,'IDEMPOTENCY_MISMATCH',409); END IF;
 PERFORM public.time_settle_locked(p_actor,date_trunc('milliseconds',clock_timestamp()));
 RETURN jsonb_build_object('data',public.time_snapshot_locked(p_actor),'receipt',r.receipt,'replayed',true);
END $$;

CREATE FUNCTION public.claim_time_jobs(p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed jsonb; at_time timestamptz=date_trunc('milliseconds',clock_timestamp());
BEGIN
 IF p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 UPDATE public.time_jobs SET status='failed',last_error='LEASE_RETRIES_EXHAUSTED',lease_until=NULL,claim_token=NULL
 WHERE attempts>=5 AND status='running' AND lease_until<=at_time;
 WITH candidates AS (
   SELECT id FROM public.time_jobs WHERE attempts<5
   AND ((status='pending' AND next_run_at<=at_time) OR (status='running' AND lease_until<=at_time))
   ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), updated AS (
   UPDATE public.time_jobs j SET status='running',attempts=attempts+1,claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds'
   FROM candidates c WHERE j.id=c.id RETURNING j.id,j.claim_token
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'claimToken',claim_token)),'[]') INTO claimed FROM updated;
 RETURN claimed;
END $$;
CREATE FUNCTION public.execute_time_job(p_job uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.time_jobs%ROWTYPE; actor uuid; at_time timestamptz;
BEGIN
 SELECT user_id INTO actor FROM public.time_jobs WHERE id=p_job;
 IF actor IS NULL THEN RETURN jsonb_build_object('status','missing'); END IF;
 -- Separate from lease claim; never hold a job lock while waiting for an Account lock.
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 SELECT * INTO j FROM public.time_jobs WHERE id=p_job FOR UPDATE;
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF j.status='done' THEN RETURN jsonb_build_object('status','done','replayed',true); END IF;
 IF j.status<>'running' OR j.claim_token IS DISTINCT FROM p_claim OR j.lease_until<=at_time THEN
   RETURN jsonb_build_object('status','stale');
 END IF;
 IF EXISTS(SELECT 1 FROM public.time_intervals WHERE id=j.interval_id AND end_at IS NULL
   AND boundary_at=j.boundary_at AND boundary_at<=at_time) THEN
   PERFORM public.time_settle_locked(actor,at_time);
 END IF;
 UPDATE public.time_jobs SET status='done',completed_at=at_time,lease_until=NULL,claim_token=NULL,last_error=NULL WHERE id=j.id;
 RETURN jsonb_build_object('status','done','replayed',false);
END $$;
CREATE FUNCTION public.fail_time_job(p_job uuid,p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.time_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
 next_run_at=clock_timestamp()+make_interval(secs=>least(600,power(2,attempts)*15+floor(random()*5))::double precision),
 lease_until=NULL,claim_token=NULL,last_error='TRANSIENT_EXECUTION_FAILURE'
 WHERE id=p_job AND status='running' AND claim_token=p_claim;
END $$;
CREATE FUNCTION public.time_job_status() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),
 'running',count(*) FILTER(WHERE status='running'),'failed',count(*) FILTER(WHERE status='failed'),
 'oldestDueAt',min(next_run_at) FILTER(WHERE status='pending')) FROM public.time_jobs
$$;
-- An operator may explicitly retry failed jobs via service role after investigating them.
CREATE FUNCTION public.retry_failed_time_jobs(p_limit integer DEFAULT 10) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 UPDATE public.time_jobs SET status='pending',attempts=0,next_run_at=clock_timestamp(),lease_until=NULL,claim_token=NULL,last_error=NULL
 WHERE id IN (SELECT id FROM public.time_jobs WHERE status='failed' ORDER BY next_run_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
-- No authenticated SQL mutation bypass. Helpers are callable only within trusted functions.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'time\_%' ESCAPE '\' OR p.proname IN
 ('read_time_state','execute_time_command','read_time_receipt','claim_time_jobs','execute_time_job','fail_time_job','retry_failed_time_jobs')) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
