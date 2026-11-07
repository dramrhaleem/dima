// B5 diagnostic only: rollback-scoped SQL work, not a concurrent or boundary load test.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clientEnvPath, readEnv, runtimeRoot } from '../../scripts/local-backend/env.mjs';

const sourceRun = '3a255dcc-2f50-4f7c-ae51-e75a97782515';
const roomId = 'b62dfa28-7c87-4beb-bc71-dce6ce81d6d2';
const exactEmail = `^b5-load-${sourceRun}-([0-9]|[1-7][0-9])@example[.]test$`;
assert.equal(readEnv(clientEnvPath).SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, resolve('.'));
assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const labels = JSON.parse(execFileSync('docker', ['inspect', 'dima-b0-db', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
assert.equal(labels['com.docker.compose.project'], 'dima-b0');
assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
function sql(input) {
  return execFileSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
    input, encoding: 'utf8', timeout: 20000, maxBuffer: 4e6,
  }).trim();
}
const users = `(SELECT user_id FROM public.room_memberships WHERE room_id='${roomId}')`;
const room = `room_id='${roomId}'`;
const owner = `user_id IN ${users}`;
const scopes = {
  'auth.users': `id IN ${users}`, 'auth.identities': owner, 'auth.sessions': owner,
  'auth.refresh_tokens': `user_id IN (SELECT user_id::text FROM public.room_memberships WHERE ${room})`,
  ...Object.fromEntries(['account_profiles', 'account_roles', 'profile_operations', 'public_profiles', 'learning_workspaces', 'learning_operations', 'room_accounts', 'room_operations', 'room_account_jobs', 'room_rate_buckets', 'time_accounts', 'time_sessions', 'time_intervals', 'time_corrections', 'time_operations', 'time_jobs', 'time_outbox'].map(table => [`public.${table}`, owner])),
  'public.rooms': `id='${roomId}'`,
  ...Object.fromEntries(['room_runs', 'room_memberships', 'round_participations', 'room_access_cutoffs', 'room_bans', 'room_transfer_offers', 'room_reports', 'room_reactions', 'room_audit', 'room_outbox', 'room_jobs'].map(table => [`public.${table}`, room])),
  'public.user_blocks': `blocker_id IN ${users} OR blocked_id IN ${users}`,
  'public.account_suspensions': owner,
};
function hashes() {
  const query = Object.entries(scopes).map(([table, where]) => `SELECT '${table}' AS table_name,count(*) AS rows,
    encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') AS sha256 FROM ${table} t WHERE ${where}`).join(' UNION ALL ');
  return JSON.parse(sql(`BEGIN READ ONLY; SELECT jsonb_agg(to_jsonb(s) ORDER BY table_name) FROM (${query}) s; ROLLBACK;`));
}
const guard = `
 PERFORM 1 FROM auth.users WHERE id IN ${users} ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.rooms WHERE id='${roomId}' FOR UPDATE;
 PERFORM 1 FROM public.room_runs WHERE room_id='${roomId}' ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.room_memberships WHERE room_id='${roomId}')<>20
   OR (SELECT count(DISTINCT user_id) FROM public.room_memberships WHERE room_id='${roomId}')<>20
   OR EXISTS(SELECT 1 FROM public.room_memberships m LEFT JOIN auth.users u ON u.id=m.user_id WHERE m.room_id='${roomId}' AND (u.id IS NULL OR u.email !~ '${exactEmail}'))
   OR NOT EXISTS(SELECT 1 FROM public.rooms r JOIN auth.users u ON u.id=r.owner_id WHERE r.id='${roomId}' AND r.status='closed' AND u.email ~ '${exactEmail}' AND r.owner_id IN ${users})
   OR EXISTS(SELECT 1 FROM public.time_sessions WHERE user_id IN ${users} AND status IN ('running','paused','needsReview'))
   OR EXISTS(SELECT 1 FROM public.room_memberships WHERE user_id IN ${users} AND status='active')
   OR NOT EXISTS(SELECT 1 FROM public.room_runs rr JOIN public.rooms r ON r.current_run_id=rr.id WHERE r.id='${roomId}' AND rr.room_id=r.id AND rr.status='active' AND rr.planned_end_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Exact cleaned synthetic Watching fixture required'; END IF;
`;
// Legacy030 roster control, intentionally unchanged after031. Not the current roster implementation.
const participants = `SELECT coalesce(jsonb_agg(jsonb_build_object('membershipId',other.id,'displayName',p.display_name,
 'isOwner',coalesce(r.owner_id=other.user_id,false),'isHost',coalesce(r.current_host_membership_id=other.id,false),
 'presence',CASE WHEN other.last_seen_at>at_time-interval '90 seconds' THEN 'connected' ELSE 'reconnecting' END,
 'focus',coalesce((SELECT CASE WHEN ts.status='running' THEN 'focusing' ELSE 'paused' END FROM public.time_sessions ts
 WHERE ts.user_id=other.user_id AND ts.room_id='${roomId}' AND ts.status IN ('running','paused')
 AND public.rooms_time_cutoff(ts,at_time)>at_time LIMIT 1),'watching'),'intent',other.intent)
 ORDER BY (other.user_id=actor) DESC,other.joined_at,other.id),'[]') INTO result
 FROM public.room_memberships other JOIN public.account_profiles p ON p.user_id=other.user_id
 WHERE other.room_id='${roomId}' AND public.rooms_member_live(other,at_time) AND NOT public.rooms_is_blocked(actor,other.user_id);`;
const calls = {
  me: `result=public.read_room_me('${roomId}');`,
  snapshot: `result=public.read_room_snapshot('${roomId}'); IF jsonb_array_length(result->'participants')<>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'participants') p WHERE p->>'focus'<>'watching') THEN RAISE EXCEPTION '20 Watching snapshot required'; END IF;`,
  timeCompact: `result=public.read_time_state(actor,NULL,NULL,NULL,NULL,1); IF result->'active'<>'null'::jsonb THEN RAISE EXCEPTION 'No active ledger required'; END IF;`,
  participantsOnly: participants,
};
const before = hashes();
const evidence = {
  diagnosticId: randomUUID(), sourceRun, roomId, startedAt: new Date().toISOString(), before,
  fixture: { members: 20, state: 'Original finalized ledger retained; memberships and room temporarily restored to Watching inside rollback only', clockAging: false, originalRunDeadlineModified: false, noGlobalStatisticsReset: true },
  measurements: [],
  limitations: ['One PostgreSQL session,20 sequential viewers,pre-acquired Account/Room/Run locks; no lock contention,Auth,HTTP,REST pool,Realtime or browser rendering measured.', 'Function self/total times are instrumented SQL wall times,not CPU billing; nested total times must not be added.', 'Cold first call and subsequent calls share a session plan cache; repeats use fresh sessions but warm database pages.', 'Watching fixture does not reproduce finalization of20 running sessions at an actual phase boundary.', 'participantsOnly is a legacy030 roster control copied for isolation, not the current031 roster projection; it omits authorization/settlement and must never become an API. Historical evidence remains evidence of its recorded DB version.'],
};
try {
  for (let repeat = 1; repeat <= 3; repeat++) for (const [kind, call] of Object.entries(calls)) {
    const out = sql(`BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'; SET LOCAL track_functions='all';
      DO $guard$ BEGIN ${guard}
       UPDATE public.room_memberships SET status='active',last_seen_at=clock_timestamp(),ended_at=NULL WHERE room_id='${roomId}';
       UPDATE public.rooms SET status='open',closed_at=NULL WHERE id='${roomId}';
      END $guard$;
      CREATE TEMP TABLE function_baseline ON COMMIT DROP AS SELECT * FROM pg_stat_xact_user_functions;
      CREATE TEMP TABLE sample_cost(ordinal integer,elapsed_ms numeric,bytes integer) ON COMMIT DROP;
      DO $measure$ DECLARE actor uuid; result jsonb; begin_at timestamptz; at_time timestamptz; n integer=0; r public.rooms%ROWTYPE; BEGIN
       SELECT * INTO r FROM public.rooms WHERE id='${roomId}';
       FOR actor IN SELECT user_id FROM public.room_memberships WHERE room_id='${roomId}' ORDER BY user_id LOOP
        PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
        at_time=clock_timestamp(); begin_at=clock_timestamp();
        ${call}
        n=n+1; INSERT INTO sample_cost VALUES(n,extract(epoch FROM clock_timestamp()-begin_at)*1000,octet_length(result::text));
       END LOOP;
      END $measure$;
      SELECT jsonb_build_object('kind','${kind}','repeat',${repeat},'at',clock_timestamp(),
       'phase',(SELECT public.rooms_phase(rr,clock_timestamp())->>'kind' FROM public.room_runs rr JOIN public.rooms r ON r.current_run_id=rr.id WHERE r.id='${roomId}'),
       'samples',(SELECT jsonb_agg(to_jsonb(s) ORDER BY ordinal) FROM sample_cost s),
       'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('function',f.funcid::regprocedure::text,'calls',f.calls-coalesce(b.calls,0),'totalMs',f.total_time-coalesce(b.total_time,0),'selfMs',f.self_time-coalesce(b.self_time,0)) ORDER BY f.self_time-coalesce(b.self_time,0) DESC),'[]') FROM pg_stat_xact_user_functions f LEFT JOIN function_baseline b USING(funcid) WHERE f.calls>coalesce(b.calls,0)),
       'transactionTableWrites',(SELECT jsonb_agg(jsonb_build_object('table',relname,'insert',n_tup_ins,'update',n_tup_upd,'delete',n_tup_del) ORDER BY relname) FROM pg_stat_xact_user_tables WHERE schemaname='public' AND n_tup_ins+n_tup_upd+n_tup_del>0));
      ROLLBACK;`);
    evidence.measurements.push(JSON.parse(out));
  }
} finally {
  evidence.after = hashes();
  evidence.rollbackPreservedAllScopedTables = JSON.stringify(before) === JSON.stringify(evidence.after);
  evidence.finishedAt = new Date().toISOString();
  evidence.scriptSha256 = createHash('sha256').update(readFileSync('tests/integration/rooms-boundary-read-cost.mjs')).digest('hex');
  const path = `docs/evidence/B5_BOUNDARY_READ_COST_${evidence.diagnosticId}.json`;
  writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ artifact: path, measurements: evidence.measurements.length, rollbackPreservedAllScopedTables: evidence.rollbackPreservedAllScopedTables }));
  assert.ok(evidence.rollbackPreservedAllScopedTables, 'Fixture tables changed outside rolled-back measurement');
}
