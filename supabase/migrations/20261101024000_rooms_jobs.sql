-- B5: durable lifecycle, account-cutoff and coalesced post-commit hint delivery.
CREATE FUNCTION public.claim_room_jobs(p_limit integer DEFAULT 3) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed jsonb; at_time timestamptz=clock_timestamp();
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 UPDATE public.room_jobs SET status='failed',last_error='LEASE_RETRIES_EXHAUSTED',claim_token=NULL,lease_until=NULL WHERE status='running' AND attempts>=5 AND lease_until<=at_time;
 WITH candidates AS (SELECT room_id FROM public.room_jobs WHERE attempts<5 AND ((status='pending' AND next_run_at<=at_time) OR (status='running' AND lease_until<=at_time)) ORDER BY next_run_at,room_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 updated AS (UPDATE public.room_jobs j SET status='running',attempts=attempts+1,claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds' FROM candidates c WHERE j.room_id=c.room_id RETURNING j.room_id,j.claim_token)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',room_id,'claimToken',claim_token)),'[]') INTO claimed FROM updated;
 RETURN claimed;
END $$;
CREATE FUNCTION public.execute_room_job(p_room uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.room_jobs%ROWTYPE; at_time timestamptz;
BEGIN
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 PERFORM 1 FROM public.room_runs WHERE room_id=p_room AND status='active' ORDER BY id FOR UPDATE;
 SELECT * INTO j FROM public.room_jobs WHERE room_id=p_room FOR UPDATE;
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF j.status IS DISTINCT FROM 'running' OR j.claim_token IS DISTINCT FROM p_claim OR j.lease_until<=at_time THEN RETURN jsonb_build_object('status','stale'); END IF;
 PERFORM public.rooms_settle_locked(p_room,at_time);
 UPDATE public.room_jobs SET status='idle',attempts=0,claim_token=NULL,lease_until=NULL,last_error=NULL WHERE room_id=p_room;
 PERFORM public.rooms_schedule_locked(p_room,at_time);
 RETURN jsonb_build_object('status','done');
END $$;
CREATE FUNCTION public.claim_room_account_jobs(p_limit integer DEFAULT 3) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed jsonb; at_time timestamptz=clock_timestamp();
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 UPDATE public.room_account_jobs SET status='failed',last_error='LEASE_RETRIES_EXHAUSTED',claim_token=NULL,lease_until=NULL WHERE status='running' AND attempts>=5 AND lease_until<=at_time;
 WITH candidates AS (SELECT user_id FROM public.room_account_jobs WHERE attempts<5 AND ((status='pending' AND next_run_at<=at_time) OR (status='running' AND lease_until<=at_time)) ORDER BY next_run_at,user_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 updated AS (UPDATE public.room_account_jobs j SET status='running',attempts=attempts+1,claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds' FROM candidates c WHERE j.user_id=c.user_id RETURNING j.user_id,j.claim_token)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',user_id,'claimToken',claim_token)),'[]') INTO claimed FROM updated;
 RETURN claimed;
END $$;
CREATE FUNCTION public.execute_room_account_job(p_actor uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.room_account_jobs%ROWTYPE; at_time timestamptz;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 PERFORM public.rooms_lock_for_actor(p_actor);
 SELECT * INTO j FROM public.room_account_jobs WHERE user_id=p_actor FOR UPDATE;
 at_time=date_trunc('milliseconds',clock_timestamp());
 IF j.status IS DISTINCT FROM 'running' OR j.claim_token IS DISTINCT FROM p_claim OR j.lease_until<=at_time THEN RETURN jsonb_build_object('status','stale'); END IF;
 PERFORM public.time_settle_locked(p_actor,at_time);
 UPDATE public.room_account_jobs SET status='idle',attempts=0,claim_token=NULL,lease_until=NULL,last_error=NULL WHERE user_id=p_actor;
 RETURN jsonb_build_object('status','done');
END $$;
CREATE FUNCTION public.fail_room_job(p_kind text,p_id uuid,p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_table text; target_key text;
BEGIN
 IF p_kind='room' THEN target_table='room_jobs'; target_key='room_id';
 ELSIF p_kind='account' THEN target_table='room_account_jobs'; target_key='user_id';
 ELSE PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 EXECUTE format('UPDATE public.%I SET status=CASE WHEN attempts>=5 THEN ''failed'' ELSE ''pending'' END,
 next_run_at=clock_timestamp()+make_interval(secs=>least(600,power(2,attempts)*15+floor(random()*5))::double precision),
 lease_until=NULL,claim_token=NULL,last_error=''TRANSIENT_EXECUTION_FAILURE'' WHERE %I=$1 AND status=''running'' AND claim_token=$2',target_table,target_key) USING p_id,p_claim;
END $$;
CREATE FUNCTION public.claim_room_hints(p_limit integer DEFAULT 3,p_rooms uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed jsonb; at_time timestamptz=date_trunc('milliseconds',clock_timestamp());
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 OR coalesce(array_length(p_rooms,1),0)>10 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 UPDATE public.room_outbox SET lease_until=NULL,claim_token=NULL,last_error='LEASE_RETRIES_EXHAUSTED' WHERE pending AND attempts>=5 AND lease_until<=at_time;
 WITH candidates AS (SELECT room_id FROM public.room_outbox WHERE pending AND attempts<5 AND next_run_at<=at_time AND (lease_until IS NULL OR lease_until<=at_time) AND (p_rooms IS NULL OR room_id=ANY(p_rooms)) ORDER BY next_run_at,room_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 updated AS (UPDATE public.room_outbox o SET attempts=attempts+1,claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds' FROM candidates c WHERE o.room_id=c.room_id RETURNING o.room_id,o.version,o.claim_token),
 payloads AS (SELECT u.*,public.rooms_public_json(u.room_id,at_time) dto FROM updated u)
 SELECT coalesce(jsonb_agg(jsonb_build_object('roomId',room_id,'version',version,'claimToken',claim_token,'topic','room:'||room_id::text,
 'hint',jsonb_build_object('version',version,'phase',dto->'phase'->>'kind','count',jsonb_build_object('reserved',(dto->>'reservedCount')::integer,'connected',(dto->>'connectedCount')::integer)))),'[]') INTO claimed FROM payloads;
 RETURN claimed;
END $$;
CREATE FUNCTION public.ack_room_hint(p_room uuid,p_claim uuid,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.room_outbox SET pending=version>p_version,claim_token=NULL,lease_until=NULL,attempts=0,last_error=NULL,
 next_run_at=CASE WHEN version>p_version THEN clock_timestamp() ELSE next_run_at END
 WHERE room_id=p_room AND claim_token=p_claim;
END $$;
CREATE FUNCTION public.fail_room_hint(p_room uuid,p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.room_outbox SET lease_until=NULL,claim_token=NULL,last_error='TRANSIENT_DELIVERY_FAILURE',
 next_run_at=clock_timestamp()+make_interval(secs=>least(600,power(2,attempts)*15+floor(random()*5))::double precision)
 WHERE room_id=p_room AND claim_token=p_claim;
END $$;
CREATE FUNCTION public.room_job_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'roomPending',(SELECT count(*) FROM public.room_jobs WHERE status='pending'),
 'roomRunning',(SELECT count(*) FROM public.room_jobs WHERE status='running'),
 'roomFailed',(SELECT count(*) FROM public.room_jobs WHERE status='failed'),
 'settlementPending',(SELECT count(*) FROM public.room_account_jobs WHERE status='pending'),
 'settlementRunning',(SELECT count(*) FROM public.room_account_jobs WHERE status='running'),
 'settlementFailed',(SELECT count(*) FROM public.room_account_jobs WHERE status='failed'),
 'hintPending',(SELECT count(*) FROM public.room_outbox WHERE pending AND attempts<5),
 'hintFailed',(SELECT count(*) FROM public.room_outbox WHERE pending AND attempts>=5),
 'nextRoomDueAt',(SELECT min(next_run_at) FROM public.room_jobs WHERE status='pending'))
$$;
CREATE FUNCTION public.retry_failed_room_jobs(p_limit integer DEFAULT 10) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer=0; n integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 20 THEN PERFORM public.rooms_raise('INVALID_INPUT',422); END IF;
 UPDATE public.room_jobs SET status='pending',attempts=0,next_run_at=clock_timestamp(),claim_token=NULL,lease_until=NULL,last_error=NULL
 WHERE room_id IN (SELECT room_id FROM public.room_jobs WHERE status='failed' ORDER BY next_run_at,room_id LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT; changed=changed+n;
 UPDATE public.room_account_jobs SET status='pending',attempts=0,next_run_at=clock_timestamp(),claim_token=NULL,lease_until=NULL,last_error=NULL
 WHERE user_id IN (SELECT user_id FROM public.room_account_jobs WHERE status='failed' ORDER BY next_run_at,user_id LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT; changed=changed+n;
 UPDATE public.room_outbox SET attempts=0,next_run_at=clock_timestamp(),claim_token=NULL,lease_until=NULL,last_error=NULL
 WHERE room_id IN (SELECT room_id FROM public.room_outbox WHERE pending AND attempts>=5 ORDER BY next_run_at,room_id LIMIT p_limit FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN changed+n;
END $$;

CREATE FUNCTION public.rooms_realtime_allowed(p_topic text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb; m public.room_memberships%ROWTYPE;
BEGIN
 claims=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 IF claims->>'role' IS DISTINCT FROM 'anon' OR claims->>'aud' IS DISTINCT FROM 'realtime' OR claims->>'iss' IS DISTINCT FROM 'dima-room-realtime' OR claims ? 'sub' THEN RETURN false; END IF;
 IF coalesce(claims->>'dima_room_id','') !~ '^[0-9a-f-]{36}$' OR coalesce(claims->>'dima_membership_id','') !~ '^[0-9a-f-]{36}$' OR coalesce(claims->>'dima_generation','') !~ '^[1-9][0-9]{0,8}$' THEN RETURN false; END IF;
 IF p_topic IS DISTINCT FROM 'room:'||(claims->>'dima_room_id') THEN RETURN false; END IF;
 SELECT * INTO m FROM public.room_memberships WHERE id=(claims->>'dima_membership_id')::uuid AND room_id=(claims->>'dima_room_id')::uuid AND control_version=(claims->>'dima_generation')::integer;
 RETURN public.rooms_member_live(m,statement_timestamp());
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE FUNCTION public.install_room_realtime_policy() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF to_regclass('realtime.messages') IS NULL THEN RETURN false; END IF;
 EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
 EXECUTE 'GRANT USAGE ON SCHEMA realtime TO anon,authenticated';
 EXECUTE 'GRANT SELECT ON realtime.messages TO anon';
 EXECUTE 'REVOKE INSERT,UPDATE,DELETE ON realtime.messages FROM anon,authenticated';
 EXECUTE 'DROP POLICY IF EXISTS dima_room_broadcast_read ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_broadcast_read ON realtime.messages FOR SELECT TO anon USING (extension=''broadcast'' AND public.rooms_realtime_allowed(realtime.topic()))';
 RETURN true;
END $$;
SELECT public.install_room_realtime_policy();

-- Explicit privilege closure: no arbitrary state replacement or caller-supplied actor RPC.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'rooms\_%' ESCAPE '\' OR p.proname LIKE 'room\_%' ESCAPE '\' OR p.proname IN
 ('execute_room_command','list_public_rooms','read_public_room','read_room_options','read_room_me','read_room_snapshot','read_room_reports','read_room_realtime_grant',
 'claim_room_jobs','execute_room_job','claim_room_account_jobs','execute_room_account_job','fail_room_job','claim_room_hints','ack_room_hint','fail_room_hint','retry_failed_room_jobs','install_room_realtime_policy','execute_time_command_core')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.list_public_rooms(text,text,text,text,timestamptz,uuid,integer),public.read_public_room(uuid),public.read_room_options() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_room_me(uuid),public.read_room_snapshot(uuid),public.read_room_reports(text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rooms_realtime_allowed(text) TO anon;
COMMENT ON TABLE public.room_account_jobs IS 'Durable target settlement; profile FK deliberately avoids hidden target Account locks. Future deletion must lock Account then Rooms/Runs before profile cascades.';
COMMENT ON TABLE public.room_outbox IS 'Coalesced non-sensitive invalidation only; post-commit publication, version-aware ack, bounded retries. No roster snapshots in receipts or broadcast.';
