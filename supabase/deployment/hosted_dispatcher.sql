-- Run only through scripts/production-cron.mjs, which supplies the Vault input.
-- The scheduled command contains no token; it decrypts the scoped token at execution.
-- Avoid replaying Supabase extension event triggers when already installed.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
  CREATE EXTENSION pg_net WITH SCHEMA extensions;
 END IF;
END $$;

-- pg_net transiently queues Authorization in a managed table. Its platform
-- owner grants SQL access; API clients have no arbitrary SQL or exposed net
-- schema. The runner verifies this boundary before activating the schedule.

CREATE TABLE IF NOT EXISTS dima_deploy.dispatch_requests(
 request_id bigint PRIMARY KEY,
 queued_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON dima_deploy.dispatch_requests FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE dima_deploy.dispatch_requests IS 'Dima hosted dispatcher request IDs only; no headers, tokens or user payloads.';

CREATE OR REPLACE FUNCTION dima_deploy.enqueue_dispatch() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text; request_id bigint;
BEGIN
 SELECT decrypted_secret INTO STRICT token FROM vault.decrypted_secrets WHERE name='dima_jobs_token';
 IF char_length(token)<32 THEN RAISE EXCEPTION 'Dispatcher token is missing'; END IF;
 SELECT net.http_post(
  url:='https://dima.study/api/internal/jobs/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,
  timeout_milliseconds:=45000
 ) INTO request_id;
 INSERT INTO dima_deploy.dispatch_requests(request_id) VALUES(request_id);
 DELETE FROM dima_deploy.dispatch_requests WHERE queued_at<now()-interval '7 days';
 DELETE FROM cron.job_run_details WHERE jobid IN(SELECT jobid FROM cron.job WHERE jobname='dima-dispatch-every-minute') AND end_time<now()-interval '7 days';
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION dima_deploy.enqueue_dispatch() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION dima_deploy.enqueue_dispatch() IS 'Dima hosted dispatcher v1: fixed HTTPS target, Vault bearer token, empty JSON, bounded timeout.';

SELECT cron.schedule('dima-dispatch-every-minute','* * * * *','SELECT dima_deploy.enqueue_dispatch();');
SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='dima-dispatch-every-minute' AND command='SELECT dima_deploy.enqueue_dispatch();';
