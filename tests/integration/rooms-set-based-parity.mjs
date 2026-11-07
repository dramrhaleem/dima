// B5 functional parity only. Never applies a migration permanently.
// Requires explicit operator GO; all fixture rows/function replacements ROLLBACK.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';

assert.deepEqual(process.argv.slice(2), ['--approved-local-rollback'], 'Requires root review and explicit GO before execution.');
const root = resolve('.');
assert.equal(readEnv(clientEnvPath).SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, root);
assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const labels = JSON.parse(execFileSync('docker', ['inspect', 'dima-b0-db', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
assert.equal(labels['com.docker.compose.project'], 'dima-b0');
assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
const migrationPath = 'supabase/migrations/20261101031000_rooms_set_based_projection.sql';
const migration = readFileSync(migrationPath, 'utf8');
assert.ok(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/mi.test(migration));
const runId = randomUUID(), roomId = randomUUID(), run = randomUUID();
const at = new Date().toISOString();
const members = Array.from({ length: 20 }, (_, n) => ({ n, user: randomUUID(), member: randomUUID(), device: randomUUID(), participation: randomUUID(), session: randomUUID(), interval: randomUUID(), job: randomUUID() }));
const idList = members.map(m => `'${m.user}'`).join(',');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const scopes = {
  'auth.users': `id IN (${idList})`,
  'auth.identities': `user_id IN (${idList})`,
  'auth.sessions': `user_id IN (${idList})`,
  'auth.refresh_tokens': `user_id IN (${members.map(m => quote(m.user)).join(',')})`,
  ...Object.fromEntries(['account_profiles', 'account_roles', 'profile_operations', 'public_profiles', 'learning_workspaces', 'learning_operations', 'room_accounts', 'room_operations', 'room_account_jobs', 'room_rate_buckets', 'time_accounts', 'time_sessions', 'time_intervals', 'time_corrections', 'time_operations', 'time_jobs', 'time_outbox', 'account_suspensions'].map(t => [`public.${t}`, `user_id IN (${idList})`])),
  'public.rooms': `id='${roomId}'`,
  ...Object.fromEntries(['room_runs', 'room_memberships', 'round_participations', 'room_access_cutoffs', 'room_bans', 'room_transfer_offers', 'room_reports', 'room_reactions', 'room_audit', 'room_outbox', 'room_jobs'].map(t => [`public.${t}`, `room_id='${roomId}'`])),
  'public.user_blocks': `blocker_id IN (${idList}) OR blocked_id IN (${idList})`,
};
const signatures = ['public.rooms_public_json(uuid,timestamp with time zone)', 'public.read_room_snapshot(uuid)', 'public.rooms_emit_locked(uuid,timestamp with time zone,boolean)'];
function sql(input) {
  return execFileSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input, encoding: 'utf8', timeout: 90000, maxBuffer: 16e6 }).trim();
}
const hashSelect = Object.entries(scopes).map(([table, where]) => `SELECT '${table}' AS table_name,count(*) AS rows,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') AS sha256 FROM ${table} t WHERE ${where}`).join(' UNION ALL ');
function stateProof() {
  return JSON.parse(sql(`BEGIN READ ONLY; SELECT jsonb_build_object('tables',(SELECT jsonb_agg(to_jsonb(s) ORDER BY table_name) FROM (${hashSelect}) s),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',md5(pg_get_functiondef(p.oid)),'owner',p.proowner,'acl',p.proacl,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig) ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY(ARRAY[${signatures.map(s => `${quote(s)}::regprocedure`).join(',')}])),'helperAbsent',to_regprocedure('public.rooms_live_members(uuid,timestamptz)') IS NULL); ROLLBACK;`));
}
const before = stateProof();
assert.equal(before.helperAbsent, true, 'Expected DB030;031 must not already be applied.');
assert.ok(before.tables.every(t => t.rows === 0), 'Fresh synthetic IDs must have no existing data.');
const semanticSelect = Object.entries(scopes).map(([table, where]) => {
  // time_bump creates random outbox row UUIDs. Preserve every semantic field,
  // multiplicity and stable dedupe key; only that generated identity is normalized.
  const row = table === 'public.time_outbox' ? "to_jsonb(t)-'id'" : 'to_jsonb(t)';
  return `SELECT '${table}' AS name,coalesce(jsonb_agg(${row} ORDER BY (${row})::text),'[]') AS data FROM ${table} t WHERE ${where}`;
}).join(' UNION ALL ');
const cases = [
  ['mixed-active', 0], ['watching-only', 0], ['lease-before180', 0], ['lease-at180', 0], ['lease-after180', 0],
  ['connected-before90', 0], ['connected-at90', 0], ['connected-after90', 0], ['member-left', 0], ['member-expired', 0], ['member-removed', 0],
  ['ban-active', 0], ['ban-revoked', 0], ['suspension-active', 0], ['suspension-revoked', 0], ['suspension-future-effective', 0],
  ['block-outbound', 0], ['block-inbound', 0], ['block-revoked', 0], ['block-owner', 2],
  ['actor-banned', 0], ['actor-suspended', 0], ['actor-lease-at180', 0], ['no-actor', 0], ['actor-not-onboarded', 0],
  ['room-lobby', 0], ['closed-active', 0], ['closed-completed', 0], ['closed-cancelled', 0], ['closed-at-end', 0],
  ['open-completed', 0], ['open-at-end', 0], ['open-cancelled', 0], ['room-suspended', 0], ['room-archived', 0], ['effective-archive', 0],
  ['short-break', 0], ['long-break', 0], ['running-controller', 2], ['paused-controller', 3], ['controller-mismatch', 2],
  ['session-cutoff-other', 0], ['session-cutoff-actor', 2], ['outbox-inflight', 0], ['job-running', 0], ['job-failed', 0],
];
const fixture = `
CREATE TEMP TABLE fixture(n integer PRIMARY KEY,user_id uuid,member_id uuid,device_id uuid,participation_id uuid,session_id uuid,interval_id uuid,job_id uuid) ON COMMIT DROP;
INSERT INTO fixture VALUES ${members.map(m => `(${m.n},'${m.user}','${m.member}','${m.device}','${m.participation}','${m.session}','${m.interval}','${m.job}')`).join(',')};
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id IN (${idList}) OR email LIKE 'b5-setbased-${runId}-%')
 OR EXISTS(SELECT 1 FROM public.rooms WHERE id='${roomId}') OR EXISTS(SELECT 1 FROM public.room_runs WHERE id='${run}') THEN RAISE EXCEPTION 'Synthetic identity collision'; END IF;
END $guard$;
INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) SELECT user_id,'b5-setbased-${runId}-'||n||'@example.test','authenticated','authenticated','${at}','${at}' FROM fixture;
INSERT INTO public.account_profiles(user_id,display_name,timezone,intent,appearance,onboarded,revision) SELECT user_id,'Synthetic member '||lpad(n::text,2,'0'),'UTC','learning','light',true,1 FROM fixture;
INSERT INTO public.room_accounts(user_id,revision) SELECT user_id,1 FROM fixture;
INSERT INTO public.time_accounts(user_id,revision) SELECT user_id,1 FROM fixture;
INSERT INTO public.rooms(id,owner_id,title,description,language,topic,configured_preset,host_last_seen_at,last_activity_at,created_at)
 VALUES('${roomId}','${members[0].user}','B5 rollback parity','Synthetic only','en','Parity','classic','${at}','${at}','${at}'::timestamptz-interval '2 hours');
INSERT INTO public.room_memberships(id,room_id,user_id,status,device_id,visibility_version,joined_at,last_seen_at,intent)
 SELECT member_id,'${roomId}',user_id,'active',device_id,1,'${at}'::timestamptz-interval '2 minutes'+n*interval '1 millisecond','${at}',CASE WHEN n%2=0 THEN 'reading' ELSE 'project' END FROM fixture;
INSERT INTO public.room_runs(id,room_id,preset_id,status,started_at,planned_end_at,current_host_membership_id)
 VALUES('${run}','${roomId}','classic','active','${at}'::timestamptz-interval '60 seconds','${at}'::timestamptz+interval '7740 seconds','${members[0].member}');
UPDATE public.rooms SET current_run_id='${run}',current_host_membership_id='${members[0].member}' WHERE id='${roomId}';
INSERT INTO public.round_participations(id,user_id,room_id,run_id,round_index,accepted_at,boundary_at)
 SELECT participation_id,user_id,'${roomId}','${run}',1,'${at}'::timestamptz-interval '30 seconds','${at}'::timestamptz+interval '1440 seconds' FROM fixture WHERE n IN(2,3);
INSERT INTO public.time_sessions(id,user_id,mode,category,status,title,created_at,device_id,control_version,lease_until,room_id,participation_id,room_deadline_at,remaining_seconds)
 SELECT session_id,user_id,'room','learning',CASE WHEN n=2 THEN 'running' ELSE 'paused' END,'Synthetic focus','${at}'::timestamptz-interval '30 seconds',device_id,7,'${at}'::timestamptz+interval '180 seconds','${roomId}',participation_id,'${at}'::timestamptz+interval '1440 seconds',CASE WHEN n=3 THEN 1440 ELSE NULL END FROM fixture WHERE n IN(2,3);
INSERT INTO public.time_intervals(id,ordinal,user_id,session_id,start_at,end_at,boundary_at,source,eligibility,device_id,control_version,created_at) OVERRIDING SYSTEM VALUE
 SELECT interval_id,${-parseInt(runId.replaceAll('-', '').slice(0, 12), 16)}-n,user_id,session_id,'${at}'::timestamptz-interval '30 seconds',CASE WHEN n=3 THEN '${at}'::timestamptz-interval '10 seconds' ELSE NULL END,'${at}'::timestamptz+interval '1440 seconds','server','eligible',device_id,7,'${at}'::timestamptz-interval '30 seconds' FROM fixture WHERE n IN(2,3);
INSERT INTO public.time_jobs(id,user_id,dedupe_key,interval_id,boundary_at,next_run_at) SELECT job_id,user_id,'boundary:'||interval_id,interval_id,'${at}'::timestamptz+interval '1440 seconds','${at}'::timestamptz+interval '1440 seconds' FROM fixture WHERE n=2;
INSERT INTO public.room_jobs(room_id,status,next_run_at,attempts,last_error) VALUES('${roomId}','pending','${at}'::timestamptz+interval '90 seconds',2,'SYNTHETIC_KEEP');
INSERT INTO public.room_outbox(room_id,version,pending,attempts,next_run_at,last_error) VALUES('${roomId}',1,false,2,'${at}','SYNTHETIC_KEEP');
INSERT INTO public.room_reactions(id,room_id,membership_id,run_id,kind,created_at) VALUES('${randomUUID()}','${roomId}','${members[4].member}','${run}','wave','${at}'::timestamptz-interval '2 seconds');
DO $guard$ BEGIN
 PERFORM 1 FROM auth.users WHERE id IN (${idList}) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.rooms WHERE id='${roomId}' FOR UPDATE;
 PERFORM 1 FROM public.room_runs WHERE room_id='${roomId}' ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.room_memberships WHERE room_id='${roomId}')<>20
 OR EXISTS(SELECT 1 FROM public.room_memberships m LEFT JOIN auth.users u ON u.id=m.user_id WHERE m.room_id='${roomId}' AND (u.id IS NULL OR u.email !~ '^b5-setbased-${runId}-([0-9]|1[0-9])@example[.]test$'))
 THEN RAISE EXCEPTION 'Every owner/member must belong to this exact synthetic run'; END IF;
END $guard$;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
`;
const config = `
CREATE FUNCTION pg_temp.configure_case(label text) RETURNS void LANGUAGE plpgsql AS $configure$
DECLARE t timestamptz='${at}'; target uuid='${members[4].member}'; subject uuid='${members[4].user}';
BEGIN
 IF label='watching-only' THEN UPDATE public.time_intervals SET end_at=t WHERE user_id IN (${idList}) AND end_at IS NULL; UPDATE public.time_sessions SET status='finalized',finalized_at=t WHERE user_id IN (${idList}); END IF;
 IF label LIKE 'lease-%180' THEN UPDATE public.room_memberships SET last_seen_at=t-interval '180 seconds'+CASE label WHEN 'lease-before180' THEN interval '1 millisecond' WHEN 'lease-after180' THEN -interval '1 millisecond' ELSE interval '0' END WHERE id=target; END IF;
 IF label LIKE 'connected-%90' THEN UPDATE public.room_memberships SET last_seen_at=t-interval '90 seconds'+CASE label WHEN 'connected-before90' THEN interval '1 millisecond' WHEN 'connected-after90' THEN -interval '1 millisecond' ELSE interval '0' END WHERE id=target; END IF;
 IF label IN('member-left','member-expired','member-removed') THEN UPDATE public.room_memberships SET status=split_part(label,'-',2),ended_at=t WHERE id=target; END IF;
 IF label IN('ban-active','ban-revoked','actor-banned') THEN
  INSERT INTO public.room_bans(id,room_id,membership_id,actor_id,reason,created_at,revoked_at) VALUES('${randomUUID()}','${roomId}',CASE WHEN label='actor-banned' THEN '${members[0].member}'::uuid ELSE target END,'${members[0].user}','synthetic',t-interval '1 second',CASE WHEN label='ban-revoked' THEN t END);
 END IF;
 IF label IN('suspension-active','suspension-revoked','suspension-future-effective','actor-suspended') THEN
  INSERT INTO public.account_suspensions(id,user_id,reason,effective_at,revoked_at) VALUES('${randomUUID()}',CASE WHEN label='actor-suspended' THEN '${members[0].user}'::uuid ELSE subject END,'synthetic',CASE WHEN label='suspension-future-effective' THEN t+interval '1 day' ELSE t-interval '1 second' END,CASE WHEN label='suspension-revoked' THEN t END);
 END IF;
 IF label LIKE 'block-%' THEN
  INSERT INTO public.user_blocks(id,blocker_id,blocked_id,created_at,revoked_at) VALUES('${randomUUID()}',CASE WHEN label='block-inbound' THEN subject WHEN label='block-owner' THEN '${members[2].user}'::uuid ELSE '${members[0].user}'::uuid END,CASE WHEN label IN('block-inbound','block-owner') THEN '${members[0].user}'::uuid ELSE subject END,t,CASE WHEN label='block-revoked' THEN t END);
 END IF;
 IF label='actor-lease-at180' THEN UPDATE public.room_memberships SET last_seen_at=t-interval '180 seconds' WHERE id='${members[0].member}'; END IF;
 IF label='actor-not-onboarded' THEN UPDATE public.account_profiles SET onboarded=false WHERE user_id='${members[0].user}'; END IF;
 IF label='room-lobby' THEN UPDATE public.rooms SET current_run_id=NULL WHERE id='${roomId}'; END IF;
 IF label LIKE 'closed-%' THEN UPDATE public.rooms SET status='closed',closed_at=t WHERE id='${roomId}'; END IF;
 IF label IN('closed-completed','open-completed') THEN UPDATE public.room_runs SET status='completed',completed_at=t WHERE id='${run}'; END IF;
 IF label IN('closed-cancelled','open-cancelled') THEN UPDATE public.room_runs SET status='cancelled',cancelled_at=t WHERE id='${run}'; END IF;
 IF label IN('closed-at-end','open-at-end') THEN UPDATE public.room_runs SET planned_end_at=t WHERE id='${run}'; END IF;
 IF label='room-suspended' THEN UPDATE public.rooms SET status='suspended',suspended_at=t WHERE id='${roomId}'; END IF;
 IF label='room-archived' THEN UPDATE public.rooms SET status='archived',archived_at=t WHERE id='${roomId}'; END IF;
 IF label='effective-archive' THEN
  UPDATE public.room_memberships SET status='left',ended_at=t WHERE room_id='${roomId}';
  UPDATE public.room_runs SET status='completed',started_at=t-interval '10 days',planned_end_at=t-interval '8 days',completed_at=t-interval '8 days' WHERE id='${run}';
  UPDATE public.rooms SET last_activity_at=t-interval '8 days' WHERE id='${roomId}';
 END IF;
 IF label IN('short-break','long-break') THEN UPDATE public.room_runs SET started_at=t-CASE WHEN label='short-break' THEN interval '1500 seconds' ELSE interval '6900 seconds' END,planned_end_at=t+CASE WHEN label='short-break' THEN interval '6300 seconds' ELSE interval '900 seconds' END WHERE id='${run}'; END IF;
 IF label='controller-mismatch' THEN UPDATE public.room_memberships SET control_version=9,device_id='${members[1].device}' WHERE id='${members[2].member}'; END IF;
 IF label IN('session-cutoff-other','session-cutoff-actor') THEN INSERT INTO public.room_access_cutoffs(id,room_id,membership_id,run_id,effective_at,reason) VALUES('${randomUUID()}','${roomId}','${members[2].member}','${run}',t-interval '10 seconds','remove'); END IF;
 IF label='outbox-inflight' THEN UPDATE public.room_outbox SET pending=true,claim_token='${randomUUID()}',lease_until=t+interval '30 seconds' WHERE room_id='${roomId}'; END IF;
 IF label IN('job-running','job-failed') THEN UPDATE public.room_jobs SET status=split_part(label,'-',2),claim_token='${randomUUID()}',lease_until=t+interval '30 seconds' WHERE room_id='${roomId}'; END IF;
END $configure$;
`;
const functionCapture = phase => `INSERT INTO function_versions SELECT '${phase}',p.oid::regprocedure::text,pg_get_functiondef(p.oid),jsonb_build_object('owner',p.proowner,'acl',p.proacl,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig) FROM pg_proc p WHERE p.oid=ANY(ARRAY[${signatures.map(s => `${quote(s)}::regprocedure`).join(',')}]);`;
const testSql = `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='30s';
DO $guard$ BEGIN
 IF to_regprocedure('public.rooms_live_members(uuid,timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'Expected unapplied031'; END IF;
 IF strpos((SELECT prosrc FROM pg_proc WHERE oid='public.read_room_snapshot(uuid)'::regprocedure),'time_settle_locked(actor,at_time,ARRAY[p_room])')=0 THEN RAISE EXCEPTION 'Expected DB030 snapshot'; END IF;
END $guard$;
CREATE TEMP TABLE function_versions(phase text,signature text,definition text,attributes jsonb,PRIMARY KEY(phase,signature)) ON COMMIT DROP;
${functionCapture('old')}
${migration}
${functionCapture('new')}
DO $acl$ DECLARE f record; ordinary_role text; denied boolean; BEGIN
 IF (SELECT count(*) FROM function_versions)<>6 THEN RAISE EXCEPTION 'Missing old/new function definitions'; END IF;
 IF EXISTS(SELECT 1 FROM function_versions a JOIN function_versions b USING(signature) WHERE a.phase='old' AND b.phase='new' AND a.attributes<>b.attributes) THEN RAISE EXCEPTION 'Existing owner/ACL/security/settings changed'; END IF;
 IF has_function_privilege('anon','public.rooms_live_members(uuid,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','public.rooms_live_members(uuid,timestamptz)','EXECUTE') OR NOT has_function_privilege('service_role','public.rooms_live_members(uuid,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'New helper role privilege mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.rooms_live_members(uuid,timestamptz)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'New helper exposed to PUBLIC'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.rooms_live_members(uuid,timestamptz)'::regprocedure AND NOT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""'] AND proowner=(SELECT proowner FROM pg_proc WHERE oid='public.rooms_public_json(uuid,timestamptz)'::regprocedure)) THEN RAISE EXCEPTION 'Helper security/owner/settings mismatch'; END IF;
 FOREACH ordinary_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  denied=false;
  BEGIN
   EXECUTE format('SET LOCAL ROLE %I',ordinary_role);
   PERFORM public.rooms_live_members(NULL,'${at}'::timestamptz);
   EXECUTE 'RESET ROLE';
  EXCEPTION WHEN insufficient_privilege THEN
   denied=true; EXECUTE 'RESET ROLE';
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Ordinary role could execute private helper: %',ordinary_role; END IF;
 END LOOP;
 FOR f IN SELECT * FROM function_versions WHERE signature='read_room_snapshot(uuid)' OR signature='public.read_room_snapshot(uuid)' LOOP
  IF (length(f.definition)-length(replace(f.definition,$needle$date_trunc('milliseconds',clock_timestamp())$needle$,'')))/length($needle$date_trunc('milliseconds',clock_timestamp())$needle$)<>1
  OR strpos(f.definition,$location$PERFORM public.rooms_lock_for_actor(actor,ARRAY[p_room]);
 at_time=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.time_settle_locked(actor,at_time,ARRAY[p_room]);$location$)=0 THEN RAISE EXCEPTION 'Clock replacement must be unique and after lock acquisition'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM function_versions WHERE signature IN('read_room_snapshot(uuid)','public.read_room_snapshot(uuid)'))<>2 THEN RAISE EXCEPTION 'Snapshot definition identity mismatch'; END IF;
 -- This substitution exists only in the two test definitions and rolls back.
 UPDATE function_versions SET definition=replace(definition,$needle$date_trunc('milliseconds',clock_timestamp())$needle$,$clock$'${at}'::timestamptz$clock$) WHERE signature IN('read_room_snapshot(uuid)','public.read_room_snapshot(uuid)');
END $acl$;
${fixture}
${config}
CREATE FUNCTION pg_temp.fixture_state() RETURNS jsonb LANGUAGE sql AS $state$
 SELECT jsonb_object_agg(name,data) FROM (${semanticSelect}) s
$state$;
CREATE TEMP TABLE cases(label text PRIMARY KEY,actor_n integer) ON COMMIT DROP;
INSERT INTO cases VALUES ${cases.map(([name, n]) => `(${quote(name)},${n})`).join(',')};
CREATE TEMP TABLE parity_evidence(label text PRIMARY KEY,public_reserved integer,public_connected integer,snapshot_error text,result_sha256 text) ON COMMIT DROP;
DO $compare$
DECLARE c record; variant text; f record; actor uuid; old_result jsonb; new_result jsonb; result jsonb; dto jsonb;
 first_hint jsonb; second_hint jsonb; forced_hint jsonb; snap jsonb; snapshot_error text; before_version bigint;
 scalar_members jsonb; set_members jsonb; after_members jsonb; t timestamptz='${at}';
BEGIN
 FOR c IN SELECT * FROM cases ORDER BY label LOOP
  old_result=NULL; new_result=NULL;
  FOREACH variant IN ARRAY ARRAY['old','new'] LOOP
   result=NULL;
   BEGIN
    -- Each variant runs from the identical baseline; deliberate exception below
    -- rolls back all scenario mutations and function DDL, retaining PL variables.
    FOR f IN SELECT definition FROM function_versions WHERE phase=variant ORDER BY signature LOOP EXECUTE f.definition; END LOOP;
    PERFORM pg_temp.configure_case(c.label);
    SELECT user_id INTO actor FROM fixture WHERE n=c.actor_n;
    PERFORM set_config('request.jwt.claims',CASE WHEN c.label='no-actor' THEN '{}' ELSE jsonb_build_object('sub',actor,'role','authenticated')::text END,true);
    SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO scalar_members FROM public.room_memberships m WHERE room_id='${roomId}' AND public.rooms_member_live(m,t);
    SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO set_members FROM public.rooms_live_members('${roomId}',t);
    IF scalar_members<>set_members THEN RAISE EXCEPTION 'Live-members relation differs: %',c.label; END IF;
    dto=public.rooms_public_json('${roomId}',t);
    IF c.label IN('mixed-active','watching-only','block-outbound','block-inbound','block-revoked','block-owner') AND (dto->>'reservedCount')::integer<>20 THEN RAISE EXCEPTION 'Public count incorrectly filtered by viewer: %',c.label; END IF;
    IF c.label IN('lease-at180','lease-after180') AND (dto->>'reservedCount')::integer<>19 THEN RAISE EXCEPTION 'Strict180 boundary violated'; END IF;
    IF c.label='lease-before180' AND (dto->>'reservedCount')::integer<>20 THEN RAISE EXCEPTION '180 minus epsilon rejected'; END IF;
    IF c.label IN('connected-at90','connected-after90') AND (dto->>'connectedCount')::integer<>19 THEN RAISE EXCEPTION 'Strict90 boundary violated'; END IF;
    IF c.label='connected-before90' AND (dto->>'connectedCount')::integer<>20 THEN RAISE EXCEPTION '90 minus epsilon rejected'; END IF;
    SELECT hint_version INTO before_version FROM public.rooms WHERE id='${roomId}';
    PERFORM public.rooms_emit_locked('${roomId}',t,false);
    first_hint=pg_temp.fixture_state();
    IF (first_hint#>>'{public.rooms,0,hint_phase}')<>concat(dto#>>'{phase,kind}',':',dto#>>'{phase,roundIndex}',':',dto#>>'{run,id}')
    OR (first_hint#>>'{public.rooms,0,hint_reserved}')::integer<>(dto->>'reservedCount')::integer
    OR (first_hint#>>'{public.rooms,0,hint_connected}')::integer<>(dto->>'connectedCount')::integer THEN RAISE EXCEPTION 'Hint/public projection mismatch'; END IF;
    PERFORM public.rooms_emit_locked('${roomId}',t,false);
    second_hint=pg_temp.fixture_state();
    IF first_hint<>second_hint THEN RAISE EXCEPTION 'Unchanged hint is not a no-op'; END IF;
    PERFORM public.rooms_emit_locked('${roomId}',t,true);
    forced_hint=pg_temp.fixture_state();
    IF (forced_hint#>>'{public.rooms,0,hint_version}')::bigint<>(first_hint#>>'{public.rooms,0,hint_version}')::bigint+1 THEN RAISE EXCEPTION 'Force must bump exactly once'; END IF;
    IF (public.rooms_public_json('${roomId}',t)->>'hintVersion')::bigint<>(forced_hint#>>'{public.rooms,0,hint_version}')::bigint THEN RAISE EXCEPTION 'Pre-hint DTO reused'; END IF;
    snapshot_error=NULL; snap=NULL;
    BEGIN
     EXECUTE 'SET LOCAL ROLE authenticated';
     snap=public.read_room_snapshot('${roomId}');
     EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
     GET STACKED DIAGNOSTICS snapshot_error=RETURNED_SQLSTATE;
     snap=jsonb_build_object('error',SQLERRM,'sqlstate',snapshot_error);
     EXECUTE 'RESET ROLE';
    END;
    IF c.label IN('actor-banned','actor-suspended','actor-lease-at180','no-actor','actor-not-onboarded','closed-completed','closed-cancelled','closed-at-end','room-suspended','room-archived','effective-archive') THEN
     IF snapshot_error IS NULL OR snapshot_error NOT IN('PT401','PT403','PT409') THEN RAISE EXCEPTION 'Expected policy denial for %, got %',c.label,snapshot_error; END IF;
    ELSIF snapshot_error IS NOT NULL THEN RAISE EXCEPTION 'Unexpected snapshot error in %: %',c.label,snap;
    END IF;
    IF snapshot_error IS NULL THEN
     IF snap#>>'{participants,0,membershipId}'<>(SELECT member_id::text FROM fixture WHERE n=c.actor_n) THEN RAISE EXCEPTION 'Viewer must sort first'; END IF;
     IF snap#>>'{room,hintVersion}' IS DISTINCT FROM snap#>>'{me,room,hintVersion}' THEN RAISE EXCEPTION 'Snapshot nested hint version differs'; END IF;
     IF c.label IN('block-outbound','block-inbound','block-owner') AND jsonb_array_length(snap->'participants')<>19 THEN RAISE EXCEPTION 'Directional Block not applied to roster'; END IF;
     IF c.label='mixed-active' AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'participants') x WHERE x->>'membershipId'='${members[2].member}' AND x->>'focus'='focusing') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'participants') x WHERE x->>'membershipId'='${members[3].member}' AND x->>'focus'='paused')) THEN RAISE EXCEPTION 'Active/paused focus projection changed'; END IF;
    END IF;
    after_members=pg_temp.fixture_state();
    result=jsonb_build_object('public',dto,'firstHint',first_hint,'secondHint',second_hint,'forcedHint',forced_hint,'snapshot',snap,'snapshotError',snapshot_error,'after',after_members,'beforeVersion',before_version);
    RAISE EXCEPTION 'rollback parity variant' USING ERRCODE='ZX031';
   EXCEPTION WHEN SQLSTATE 'ZX031' THEN NULL;
   END;
   IF variant='old' THEN old_result=result; ELSE new_result=result; END IF;
  END LOOP;
  IF old_result IS NULL OR old_result IS DISTINCT FROM new_result THEN
   RAISE EXCEPTION 'Old/new functional parity mismatch in % (old %, new %)',c.label,md5(old_result::text),md5(new_result::text);
  END IF;
  INSERT INTO parity_evidence VALUES(c.label,(new_result#>>'{public,reservedCount}')::integer,(new_result#>>'{public,connectedCount}')::integer,new_result->>'snapshotError',encode(sha256(convert_to(new_result::text,'UTF8')),'hex'));
 END LOOP;
END $compare$;
SELECT jsonb_build_object('cases',(SELECT jsonb_agg(to_jsonb(e) ORDER BY label) FROM parity_evidence e),'existingFunctionAttributesUnchanged',true,'helperAclVerified',true,'clockSubstitution','Unique snapshot clock assignment after locks, test-local in both old/new variants','fixtureMembers',20,'comparison','Exact JSON and scoped table-state equality; only new time_outbox random row IDs normalized');
ROLLBACK;
`;
const startedAt = new Date().toISOString();
let output, failure;
try { output = JSON.parse(sql(testSql)); }
catch (error) { failure = String(error.stderr ?? error.message).slice(0, 8000); }
const after = stateProof();
assert.deepEqual(after, before, 'Rollback did not restore scoped fixture data/function metadata.');
const evidence = { runId, startedAt, endedAt: new Date().toISOString(), migrationPath, migrationSha256: createHash('sha256').update(migration).digest('hex'), status: failure ? 'failed' : 'passed', failure: failure ?? null, output: output ?? null, before, after, rollbackVerified: true, limitations: ['Functional SQL parity only; pinned snapshot time and pre-acquired synthetic locks.', 'No HTTP, Auth API, pool contention, Realtime delivery or real-boundary latency acceptance.', 'No permanent migration/fixture writes; sequence defaults avoided for fixture inserts.', 'Scoped fixture hashes and replaced function attributes verified after ROLLBACK; not a global data audit.'] };
const path = resolve(`docs/evidence/B5_SET_BASED_PARITY_${runId}.json`), tmp = `${path}.tmp`;
const fd = openSync(tmp, 'wx', 0o600);
try { writeFileSync(fd, JSON.stringify(evidence, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
renameSync(tmp, path);
console.log(JSON.stringify({ status: evidence.status, cases: output?.cases.length ?? 0, rollbackVerified: true, evidence: path }));
if (failure) throw new Error(failure);
assert.equal(output.cases.length, cases.length);
