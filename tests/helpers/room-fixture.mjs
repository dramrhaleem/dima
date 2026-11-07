// Test-only local SQL fixtures. No application endpoint, clock parameter or production override.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function localSql(sql) {
  const env = readEnv(clientEnvPath);
  assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
  const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
  assert.equal(ownership.DIMA_REPO_ROOT, resolve('.'));
  assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
  const label = spawnSync('docker', ['inspect', 'dima-b0-db', '--format', '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: 'utf8' });
  assert.equal(label.status, 0);
  assert.equal(label.stdout.trim(), 'dima-b0');
  const configLabel = spawnSync('docker', ['inspect', 'dima-b0-db', '--format', '{{index .Config.Labels "com.docker.compose.project.config_files"}}'], { encoding: 'utf8' });
  assert.equal(configLabel.status, 0);
  assert.equal(configLabel.stdout.trim(), resolve('scripts/local-backend/compose.yaml'));
  const result = spawnSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
    input: sql, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, `Guarded synthetic fixture failed: ${result.stderr}`);
  return result.stdout.trim();
}
function guard(ownerId, roomId) {
  assert.match(ownerId, uuid); assert.match(roomId, uuid);
  return `
    PERFORM 1 FROM auth.users WHERE id IN (SELECT user_id FROM public.room_memberships WHERE room_id='${roomId}' UNION SELECT '${ownerId}'::uuid) ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.rooms WHERE id='${roomId}' FOR UPDATE;
    PERFORM 1 FROM public.room_runs WHERE room_id='${roomId}' ORDER BY id FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM public.rooms r JOIN auth.users u ON u.id=r.owner_id WHERE r.id='${roomId}' AND r.owner_id='${ownerId}' AND u.email ~* '^b5-[a-z0-9-]+@example[.]test$') THEN RAISE EXCEPTION 'Synthetic room owner required'; END IF;
    IF EXISTS(SELECT 1 FROM public.room_memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.room_id='${roomId}' AND u.email !~* '^b5-[a-z0-9-]+@example[.]test$') THEN RAISE EXCEPTION 'Every room member must be synthetic'; END IF;
  `;
}
/** Session-local counters; every measured mutation is rolled back. No global statistics reset. */
export async function measureSyntheticRoomReadCost(ownerId, roomId, kind) {
  assert.ok(['me', 'snapshot', 'grant', 'intent'].includes(kind));
  const calls = {
    me: `PERFORM public.read_room_me('${roomId}');`,
    snapshot: `PERFORM public.read_room_snapshot('${roomId}');`,
    grant: `PERFORM public.read_room_realtime_grant('${ownerId}','${roomId}');`,
    intent: `PERFORM public.execute_room_command('${ownerId}',jsonb_build_object('operationId',gen_random_uuid(),'type','setIntent','roomId','${roomId}',
      'deviceId',(SELECT device_id FROM public.room_memberships WHERE room_id='${roomId}' AND user_id='${ownerId}'),
      'controlVersion',(SELECT control_version FROM public.room_memberships WHERE room_id='${roomId}' AND user_id='${ownerId}'),
      'expectedRevision',(SELECT revision FROM public.room_accounts WHERE user_id='${ownerId}'),'intent',NULL));`,
  };
  const result = localSql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL track_functions='all';
    DO $guard$ BEGIN ${guard(ownerId, roomId)}
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','${ownerId}','role','authenticated')::text,true);
    END $guard$;
    DO $measure$ BEGIN ${calls[kind]} END $measure$;
    SELECT jsonb_build_object('kind','${kind}',
      'settlementCalls',coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcid='public.rooms_settle_locked(uuid,timestamptz)'::regprocedure),0),
      'publicProjectionCalls',coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcid='public.rooms_public_json(uuid,timestamptz)'::regprocedure),0),
      'scheduleCalls',coalesce((SELECT calls FROM pg_stat_xact_user_functions WHERE funcid='public.rooms_schedule_locked(uuid,timestamptz)'::regprocedure),0),
      'jobTupleUpdates',(SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relid='public.room_jobs'::regclass));
    ROLLBACK;`);
  return JSON.parse(result);
}
/** Job state transitions are compared inside a rolled-back synthetic transaction. */
export async function probeSyntheticRoomSchedulePolicy(ownerId, roomId) {
  return JSON.parse(localSql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s';
    DO $guard$ BEGIN ${guard(ownerId, roomId)} END $guard$;
    CREATE TEMP TABLE schedule_evidence(name text,passed boolean) ON COMMIT DROP;
    DO $measure$ DECLARE label text; prior public.room_jobs%ROWTYPE; after_row public.room_jobs%ROWTYPE;
      at_time timestamptz=clock_timestamp(); expected timestamptz; old_tuple tid; new_tuple tid;
    BEGIN
      SELECT last_seen_at+interval '90 seconds' INTO expected FROM public.room_memberships WHERE room_id='${roomId}' AND user_id='${ownerId}';
      FOREACH label IN ARRAY ARRAY['pending-earlier','pending-later','running','failed','idle'] LOOP
        UPDATE public.room_jobs SET status=split_part(label,'-',1),attempts=2,last_error='SYNTHETIC_KEEP',claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds',
          next_run_at=CASE WHEN label='pending-earlier' THEN at_time+interval '1 second' ELSE at_time+interval '1 day' END WHERE room_id='${roomId}';
        SELECT * INTO prior FROM public.room_jobs WHERE room_id='${roomId}';
        PERFORM public.rooms_schedule_locked('${roomId}',at_time);
        SELECT * INTO after_row FROM public.room_jobs WHERE room_id='${roomId}';
        INSERT INTO schedule_evidence VALUES(label,
          after_row.status=CASE WHEN label IN ('running','failed') THEN label ELSE 'pending' END
          AND after_row.next_run_at=CASE WHEN label='pending-earlier' THEN prior.next_run_at ELSE expected END
          AND after_row.attempts=prior.attempts AND after_row.claim_token=prior.claim_token
          AND after_row.lease_until=prior.lease_until AND after_row.last_error=prior.last_error);
      END LOOP;
      UPDATE public.room_memberships SET status='left',ended_at=at_time WHERE room_id='${roomId}';
      UPDATE public.rooms SET status='closed',closed_at=at_time WHERE id='${roomId}';
      FOREACH label IN ARRAY ARRAY['running','failed','idle'] LOOP
        UPDATE public.room_jobs SET status=label,attempts=2,last_error='SYNTHETIC_KEEP',claim_token=gen_random_uuid(),lease_until=at_time+interval '30 seconds' WHERE room_id='${roomId}';
        SELECT * INTO prior FROM public.room_jobs WHERE room_id='${roomId}';
        PERFORM public.rooms_schedule_locked('${roomId}',at_time);
        SELECT * INTO after_row FROM public.room_jobs WHERE room_id='${roomId}';
        INSERT INTO schedule_evidence VALUES('no-next-'||label,
          after_row.status=CASE WHEN label='running' THEN 'running' ELSE 'idle' END
          AND after_row.next_run_at=prior.next_run_at AND after_row.attempts=prior.attempts AND after_row.last_error=prior.last_error
          AND CASE WHEN label='running' THEN after_row.claim_token=prior.claim_token AND after_row.lease_until=prior.lease_until
            ELSE after_row.claim_token IS NULL AND after_row.lease_until IS NULL END);
      END LOOP;
      SELECT ctid INTO old_tuple FROM public.room_jobs WHERE room_id='${roomId}';
      PERFORM public.rooms_schedule_locked('${roomId}',at_time);
      SELECT ctid INTO new_tuple FROM public.room_jobs WHERE room_id='${roomId}';
      INSERT INTO schedule_evidence VALUES('already-idle-no-tuple-update',old_tuple=new_tuple);
    END $measure$;
    SELECT jsonb_agg(jsonb_build_object('name',name,'passed',passed)) FROM schedule_evidence;
    ROLLBACK;`));
}
/** Compare both internal ledger paths from identical state; future test time never commits. */
export async function probeSyntheticRoomSettlementParity(ownerId, roomId, paused) {
  assert.equal(typeof paused, 'boolean');
  const projection = `jsonb_build_object(
    'sessions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.time_sessions t WHERE user_id='${ownerId}'),
    'intervals',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.time_intervals i WHERE user_id='${ownerId}'),
    'timeAccount',(SELECT to_jsonb(a) FROM public.time_accounts a WHERE user_id='${ownerId}'),
    'events',(SELECT jsonb_agg(to_jsonb(e)-'id'-'created_at' ORDER BY dedupe_key) FROM public.time_outbox e WHERE user_id='${ownerId}'),
    'room',(SELECT to_jsonb(r) FROM public.rooms r WHERE id='${roomId}'),
    'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.room_memberships m WHERE room_id='${roomId}'),
    'job',(SELECT to_jsonb(j) FROM public.room_jobs j WHERE room_id='${roomId}'),
    'hint',(SELECT to_jsonb(h) FROM public.room_outbox h WHERE room_id='${roomId}'))`;
  return JSON.parse(localSql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s';
    DO $guard$ BEGIN ${guard(ownerId, roomId)} END $guard$;
    CREATE TEMP TABLE parity_evidence(value jsonb) ON COMMIT DROP;
    DO $measure$ DECLARE original jsonb; candidate jsonb; session_row public.time_sessions%ROWTYPE; at_time timestamptz;
    BEGIN
      SELECT * INTO session_row FROM public.time_sessions WHERE user_id='${ownerId}' AND room_id='${roomId}' AND status='running';
      IF NOT FOUND THEN RAISE EXCEPTION 'Synthetic active Room session required'; END IF;
      at_time=session_row.room_deadline_at+interval '1 millisecond';
      IF ${paused ? 'true' : 'false'} THEN
        UPDATE public.time_intervals SET end_at=start_at WHERE session_id=session_row.id AND end_at IS NULL;
        UPDATE public.time_sessions SET status='paused' WHERE id=session_row.id;
      END IF;
      BEGIN
        PERFORM public.time_settle_locked('${ownerId}',at_time);
        SELECT ${projection} INTO original;
        RAISE EXCEPTION 'Rollback first comparison path' USING ERRCODE='Z0001';
      EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
      PERFORM public.time_settle_locked('${ownerId}',at_time,ARRAY['${roomId}'::uuid,'${roomId}'::uuid,NULL]);
      SELECT ${projection} INTO candidate;
      IF original IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Ledger path parity failed'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.time_sessions WHERE id=session_row.id AND status='finalized' AND finalized_at=room_deadline_at) THEN RAISE EXCEPTION 'Exact Room cutoff failed'; END IF;
      INSERT INTO parity_evidence VALUES(jsonb_build_object('mode',CASE WHEN ${paused ? 'true' : 'false'} THEN 'paused' ELSE 'running' END,
        'equalState',true,'exactDeadline',true,'duplicateAndNullTargets',true,
        'internalOnly',NOT has_function_privilege('service_role','public.time_settle_locked(uuid,timestamptz,uuid[])','EXECUTE')
          AND NOT has_function_privilege('authenticated','public.time_settle_locked(uuid,timestamptz,uuid[])','EXECUTE')
          AND NOT has_function_privilege('anon','public.time_settle_locked(uuid,timestamptz,uuid[])','EXECUTE'),
        'existingServiceAbi',has_function_privilege('service_role','public.time_settle_locked(uuid,timestamptz)','EXECUTE')));
    END $measure$;
    SELECT value FROM parity_evidence; ROLLBACK;`));
}
/** Shift one synthetic Run and its own ledger consistently; keeps interval overlap constraints enabled. */
export async function ageSyntheticRoomRun(ownerId, roomId, seconds) {
  assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 20000);
  const sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET CONSTRAINTS ALL DEFERRED;
  DO $fixture$ DECLARE selected_run uuid; BEGIN
   ${guard(ownerId, roomId)}
   SELECT current_run_id INTO selected_run FROM public.rooms WHERE id='${roomId}';
   IF selected_run IS NULL THEN RAISE EXCEPTION 'An active synthetic Run is required'; END IF;
   UPDATE public.room_runs SET started_at=started_at-make_interval(secs=>${seconds}),planned_end_at=planned_end_at-make_interval(secs=>${seconds}) WHERE id=selected_run AND status='active';
   IF NOT FOUND THEN RAISE EXCEPTION 'A completed/cancelled Run cannot be aged'; END IF;
   UPDATE public.time_corrections SET previous_end_at=previous_end_at-make_interval(secs=>${seconds}),reported_end_at=reported_end_at-make_interval(secs=>${seconds}),created_at=created_at-make_interval(secs=>${seconds})
    WHERE session_id IN (SELECT s.id FROM public.time_sessions s JOIN public.round_participations p ON p.id=s.participation_id WHERE p.run_id=selected_run);
   UPDATE public.time_intervals SET start_at=start_at-make_interval(secs=>${seconds}),end_at=end_at-make_interval(secs=>${seconds}),boundary_at=boundary_at-make_interval(secs=>${seconds}),effective_end_at=effective_end_at-make_interval(secs=>${seconds}),created_at=created_at-make_interval(secs=>${seconds})
    WHERE session_id IN (SELECT s.id FROM public.time_sessions s JOIN public.round_participations p ON p.id=s.participation_id WHERE p.run_id=selected_run);
   UPDATE public.time_jobs SET boundary_at=boundary_at-make_interval(secs=>${seconds}),next_run_at=next_run_at-make_interval(secs=>${seconds})
    WHERE interval_id IN (SELECT i.id FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id JOIN public.round_participations p ON p.id=s.participation_id WHERE p.run_id=selected_run);
   UPDATE public.time_sessions SET created_at=created_at-make_interval(secs=>${seconds}),finalized_at=finalized_at-make_interval(secs=>${seconds}),room_deadline_at=room_deadline_at-make_interval(secs=>${seconds})
    WHERE participation_id IN (SELECT p.id FROM public.round_participations p WHERE p.run_id=selected_run);
   UPDATE public.round_participations SET accepted_at=accepted_at-make_interval(secs=>${seconds}),boundary_at=boundary_at-make_interval(secs=>${seconds}) WHERE round_participations.run_id=selected_run;
   UPDATE public.rooms SET created_at=least(created_at,(SELECT started_at FROM public.room_runs WHERE id=selected_run)) WHERE id='${roomId}';
   UPDATE public.room_jobs SET next_run_at=clock_timestamp(),status='pending',attempts=0,claim_token=NULL,lease_until=NULL WHERE room_id='${roomId}';
  END $fixture$; COMMIT;`;
  localSql(sql);
}
/** Lease expiry changes presence only: it deliberately leaves accepted personal time untouched. */
export async function ageSyntheticRoomLease(ownerId, roomId, userId, seconds = 181) {
  assert.match(userId, uuid);
  assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 1000000);
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; DO $fixture$ DECLARE member_id uuid; seen_at timestamptz=date_trunc('milliseconds',clock_timestamp())-make_interval(secs=>${seconds}); BEGIN
   ${guard(ownerId, roomId)}
   SELECT id INTO member_id FROM public.room_memberships WHERE room_id='${roomId}' AND user_id='${userId}' AND status='active';
   IF member_id IS NULL THEN RAISE EXCEPTION 'An active synthetic membership is required'; END IF;
   UPDATE public.room_memberships SET last_seen_at=seen_at WHERE id=member_id;
   UPDATE public.rooms SET host_last_seen_at=seen_at WHERE id='${roomId}' AND current_host_membership_id=member_id;
   UPDATE public.room_jobs SET next_run_at=clock_timestamp(),status='pending',attempts=0,claim_token=NULL,lease_until=NULL WHERE room_id='${roomId}';
  END $fixture$; COMMIT;`);
}
export async function grantSyntheticRoomModerator(userId) {
  assert.match(userId, uuid);
  localSql(`BEGIN; DO $fixture$ BEGIN
   PERFORM 1 FROM auth.users WHERE id='${userId}' FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${userId}' AND email ~* '^b5-[a-z0-9-]+@example[.]test$') THEN RAISE EXCEPTION 'Synthetic moderator required'; END IF;
   INSERT INTO public.account_roles(user_id,role) VALUES('${userId}','moderator') ON CONFLICT(user_id) DO UPDATE SET role='moderator';
  END $fixture$; COMMIT;`);
}
export async function ageSyntheticOpenSession(userId, sessionId, seconds) {
  assert.match(userId, uuid); assert.match(sessionId, uuid);
  assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 20000);
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; DO $fixture$ BEGIN
   PERFORM 1 FROM auth.users WHERE id='${userId}' FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${userId}' AND email ~* '^b5-[a-z0-9-]+@example[.]test$') THEN RAISE EXCEPTION 'Synthetic account required'; END IF;
   IF (SELECT count(*) FROM public.time_sessions WHERE user_id='${userId}')<>1 OR NOT EXISTS(SELECT 1 FROM public.time_sessions WHERE id='${sessionId}' AND user_id='${userId}' AND mode='open' AND status='running') THEN RAISE EXCEPTION 'One initial Open session required'; END IF;
   IF (SELECT count(*) FROM public.time_intervals WHERE session_id='${sessionId}')<>1 THEN RAISE EXCEPTION 'One initial interval required'; END IF;
   UPDATE public.time_intervals SET start_at=start_at-make_interval(secs=>${seconds}),boundary_at=boundary_at-make_interval(secs=>${seconds}),created_at=created_at-make_interval(secs=>${seconds}) WHERE session_id='${sessionId}';
   UPDATE public.time_sessions SET created_at=created_at-make_interval(secs=>${seconds}) WHERE id='${sessionId}';
   UPDATE public.time_jobs SET boundary_at=boundary_at-make_interval(secs=>${seconds}),next_run_at=next_run_at-make_interval(secs=>${seconds}) WHERE user_id='${userId}';
  END $fixture$; COMMIT;`);
}
export async function setSyntheticRoomArchiveAge(ownerId, roomId, secondsSinceRunStart) {
  assert.ok(Number.isInteger(secondsSinceRunStart) && secondsSinceRunStart > 0 && secondsSinceRunStart <= 30 * 86400);
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; DO $fixture$ DECLARE start_at timestamptz=date_trunc('milliseconds',clock_timestamp())-make_interval(secs=>${secondsSinceRunStart}); BEGIN
   ${guard(ownerId, roomId)}
   IF EXISTS(SELECT 1 FROM public.time_sessions WHERE room_id='${roomId}') THEN RAISE EXCEPTION 'Archive fixture requires a Run without personal time'; END IF;
   UPDATE public.room_runs SET started_at=start_at,planned_end_at=start_at+make_interval(secs=>CASE WHEN preset_id='classic' THEN 7800 ELSE 15000 END),status='active',completed_at=NULL,cancelled_at=NULL WHERE id=(SELECT current_run_id FROM public.rooms WHERE id='${roomId}');
   IF NOT FOUND THEN RAISE EXCEPTION 'Current synthetic Run required'; END IF;
   UPDATE public.rooms SET created_at=start_at-interval '1 minute',last_activity_at=start_at WHERE id='${roomId}';
   UPDATE public.room_memberships SET last_seen_at=clock_timestamp()-interval '181 seconds' WHERE room_id='${roomId}' AND status='active';
   UPDATE public.room_jobs SET next_run_at=clock_timestamp(),status='pending',attempts=0,claim_token=NULL,lease_until=NULL WHERE room_id='${roomId}';
  END $fixture$; COMMIT;`);
}
export async function ageSyntheticRoomActivity(ownerId, roomId, seconds = 8 * 86400) {
  assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 30 * 86400);
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; DO $fixture$ BEGIN
   ${guard(ownerId, roomId)}
   UPDATE public.rooms SET last_activity_at=clock_timestamp()-make_interval(secs=>${seconds}),created_at=least(created_at,clock_timestamp()-make_interval(secs=>${seconds})) WHERE id='${roomId}';
   UPDATE public.room_memberships SET last_seen_at=clock_timestamp()-interval '181 seconds' WHERE room_id='${roomId}' AND status='active';
   UPDATE public.room_jobs SET next_run_at=clock_timestamp(),status='pending',attempts=0,claim_token=NULL,lease_until=NULL WHERE room_id='${roomId}';
  END $fixture$; COMMIT;`);
}

/** Holds the actual B1 profile-save transaction while the supplied independent request runs. */
export async function duringSyntheticProfileSave(userId, callback) {
  assert.match(userId, uuid);
  localSql('SELECT 1'); // Recheck local project/container ownership before spawning the transaction.
  const sql = `BEGIN; SET LOCAL lock_timeout='5s';
    SELECT set_config('request.jwt.claims',jsonb_build_object('sub','${userId}','role','authenticated')::text,true);
    DO $fixture$ DECLARE p public.account_profiles%ROWTYPE; BEGIN
      IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${userId}' AND email ~* '^b5-[a-z0-9-]+@example[.]test$') THEN RAISE EXCEPTION 'Synthetic profile required'; END IF;
      SELECT * INTO p FROM public.account_profiles WHERE user_id='${userId}';
      PERFORM public.save_account_profile(jsonb_build_object('displayName',p.display_name,'timezone',p.timezone,'intent',p.intent,'appearance',p.appearance,'reducedMotion',p.reduced_motion,'onboarded',p.onboarded,'expectedRevision',p.revision,'operationId',gen_random_uuid()));
    END $fixture$;
    SELECT 'PROFILE_HELD'; SELECT pg_sleep(2); COMMIT;`;
  const child = spawn('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; let closed = false;
  const completed = new Promise((resolveDone, reject) => {
    child.on('error', reject);
    child.on('close', code => { closed = true; if (code === 0) resolveDone(); else reject(new Error(`Synthetic profile transaction failed: ${errors}`)); });
  });
  const ready = new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Synthetic profile lock did not become ready')), 10000);
    child.on('error', reject);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('PROFILE_HELD')) { globalThis.clearTimeout(timeout); resolveReady(); } });
    child.on('close', () => { globalThis.clearTimeout(timeout); if (!output.includes('PROFILE_HELD')) reject(new Error('Synthetic profile transaction ended before lock assertion')); });
  });
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  child.stdin.end(sql);
  try {
    await ready;
    const result = await callback();
    assert.equal(closed, false, 'Target settlement enqueue must not wait on the held Account/profile-save transaction');
    return result;
  } finally { await completed; }
}

/** Deterministic two-transaction FK cycle probe. Every fixture write is rolled back. */
export async function probeSyntheticRoomFkCycle(ownerId, roomId, memberId, edge) {
  assert.match(memberId, uuid); assert.ok(['owner', 'membership'].includes(edge));
  localSql(`BEGIN; DO $fixture$ BEGIN ${guard(ownerId, roomId)}
    IF NOT EXISTS(SELECT 1 FROM public.room_memberships WHERE room_id='${roomId}' AND user_id='${memberId}') THEN RAISE EXCEPTION 'Synthetic member required'; END IF;
    END $fixture$; ROLLBACK;`);
  const heldUser = edge === 'owner' ? ownerId : memberId;
  const actor = edge === 'owner' ? memberId : ownerId;
  function connection() {
    const child = spawn('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-qAt'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', closed = false;
    const completed = new Promise(resolveDone => {
      child.on('error', () => resolveDone({ ok: false, sqlstate: 'PROCESS_ERROR' }));
      child.on('close', code => { closed = true; resolveDone({ ok: code === 0, sqlstate: stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null }); });
    });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdin.on('error', () => { /* An aborted SQL transaction may close its pipe before cleanup. */ });
    return {
      completed,
      write(sql) { if (!closed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(sql); },
      end(sql = 'ROLLBACK;\n') { if (!closed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(sql); },
      async marker(marker) {
        const deadline = Date.now() + 15000;
        while (!stdout.includes(marker)) {
          if (closed || Date.now() >= deadline) return false;
          await new Promise(resolveWait => setTimeout(resolveWait, 10));
        }
        return true;
      },
    };
  }
  const held = connection(), writer = connection();
  const settings = "BEGIN; SET LOCAL lock_timeout='8s'; SET LOCAL statement_timeout='12s'; SET LOCAL deadlock_timeout='100ms';\n";
  let roomHeld;
  try {
    held.write(`${settings}SELECT 1 FROM auth.users WHERE id='${heldUser}' FOR UPDATE;
      UPDATE public.account_profiles SET display_name=display_name WHERE user_id='${heldUser}'; SELECT 'ACCOUNT_HELD';\n`);
    assert.equal(await held.marker('ACCOUNT_HELD'), true, 'Synthetic Account lock must be acquired');
    const mutation = edge === 'owner'
      ? `UPDATE public.rooms SET last_activity_at=clock_timestamp() WHERE id='${roomId}'; SELECT public.rooms_emit_locked('${roomId}',clock_timestamp(),true);`
      : `SELECT public.rooms_settle_locked('${roomId}',clock_timestamp()); UPDATE public.room_memberships SET status='removed',ended_at=clock_timestamp(),version=version+1,control_version=control_version+1 WHERE room_id='${roomId}' AND user_id='${memberId}';`;
    writer.write(`${settings}SELECT 1 FROM auth.users WHERE id='${actor}' FOR UPDATE;
      SELECT public.rooms_lock_for_actor('${actor}',ARRAY['${roomId}'::uuid]); SELECT 'ROOM_HELD'; ${mutation} SELECT 'WORK_DONE';\n`);
    roomHeld = await writer.marker('ROOM_HELD');
    assert.equal(roomHeld, true, 'Other actor must acquire Room before the second owner/target request');
    held.end(`SELECT public.rooms_lock_for_actor('${heldUser}',ARRAY['${roomId}'::uuid]); SELECT 'ACCOUNT_ROOM_DONE'; ROLLBACK;\n`);
    await writer.marker('WORK_DONE'); writer.end();
    const [heldResult, writerResult] = await Promise.all([held.completed, writer.completed]);
    return { edge, roomHeld, held: heldResult, writer: writerResult,
      deadlocks: [heldResult, writerResult].filter(result => result.sqlstate === '40P01').length };
  } finally {
    held.end(); writer.end(); await Promise.all([held.completed, writer.completed]);
  }
}

/** Outbox-only fault fixtures for an explicitly synthetic room; never used by load cleanup. */
export async function mutateSyntheticRoomHint(ownerId, roomId, action) {
  assert.ok(['emit', 'exhaust', 'reset', 'expire'].includes(action));
  const change = action === 'emit' ? `PERFORM public.rooms_emit_locked('${roomId}',clock_timestamp(),true);`
    : action === 'exhaust' ? `UPDATE public.room_outbox SET pending=true,attempts=5,claim_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second',next_run_at=clock_timestamp() WHERE room_id='${roomId}';`
    : action === 'reset' ? `UPDATE public.room_outbox SET pending=true,attempts=0,claim_token=NULL,lease_until=NULL,last_error=NULL,next_run_at=clock_timestamp() WHERE room_id='${roomId}';`
    : `UPDATE public.room_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE room_id='${roomId}' AND claim_token IS NOT NULL;`;
  localSql(`BEGIN; SET LOCAL lock_timeout='5s'; DO $fixture$ BEGIN ${guard(ownerId, roomId)} ${change} END $fixture$; COMMIT;`);
}
/** Hold only a synthetic outbox row so REST must enforce its hoisted SQL timeout. */
export async function duringSyntheticRoomHintLock(ownerId, roomId, callback) {
  const guarded = guard(ownerId, roomId);
  localSql(`BEGIN; DO $fixture$ BEGIN ${guarded} END $fixture$; ROLLBACK;`);
  const child = spawn('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', closed = false;
  const completed = new Promise((resolveDone, reject) => {
    child.on('error', reject);
    child.on('close', code => { closed = true; if (code === 0) resolveDone(); else reject(new Error('Synthetic hint lock transaction failed')); });
  });
  void completed.catch(() => {});
  child.stderr.on('data', () => {}); // Never print SQL context or internal claim identifiers.
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic hint lock not ready')), 10000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('HINT_HELD')) { globalThis.clearTimeout(timer); resolveReady(); } });
    child.on('error', reject);
    child.on('close', () => { globalThis.clearTimeout(timer); if (!output.includes('HINT_HELD')) reject(new Error('Synthetic hint lock ended early')); });
  });
  child.stdin.write(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s';
    DO $fixture$ BEGIN ${guarded} PERFORM 1 FROM public.room_outbox WHERE room_id='${roomId}' FOR UPDATE; END $fixture$;
    SELECT 'HINT_HELD';\n`);
  try { await ready; return await callback(); }
  finally { if (!closed) child.stdin.end('ROLLBACK;\n'); await completed; }
}

/** Re-deliver an existing version through the real local broker; never mutate the ledger. */
export async function republishSyntheticRoomHint(ownerId, roomId, version) {
  const room = JSON.parse(localSql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s';
    DO $guard$ BEGIN ${guard(ownerId, roomId)} END $guard$;
    SELECT public.rooms_public_json('${roomId}',clock_timestamp()); ROLLBACK;`));
  const deliveredVersion = version ?? room.hintVersion;
  assert.ok(Number.isSafeInteger(deliveredVersion) && deliveredVersion >= 0 && deliveredVersion <= room.hintVersion);
  const hint = { version: deliveredVersion, phase: room.phase.kind,
    count: { reserved: room.reservedCount, connected: room.connectedCount } };
  const env = readEnv(clientEnvPath);
  const service = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `room:${roomId}`, event: 'invalidate', private: true, payload: hint }] }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 202, 'Guarded local hint replay must be accepted');
  await response.text();
  return hint;
}
