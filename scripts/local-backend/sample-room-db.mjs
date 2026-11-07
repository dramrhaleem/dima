// Read-only, run-aligned diagnostics. Never emits SQL text, identifiers or credentials.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { readEnv, clientEnvPath, runtimeRoot } from './env.mjs';

const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const seconds = Number(argument('--seconds', '180'));
const intervalMs = Number(argument('--interval-ms', '1000'));
assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 10000);
assert.ok(Number.isInteger(intervalMs) && intervalMs >= 500 && intervalMs <= 10000);
const out = resolve(argument('--out', `docs/evidence/B5_DB_WAIT_${Date.now()}.ndjson`));
assert.ok(out.startsWith(resolve('docs/evidence') + '/') || out.startsWith('/media/amro/Data2/dima-local-runtime/artifacts/'));
assert.equal(readEnv(clientEnvPath).SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, resolve('.'));
assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const labels = JSON.parse(execFileSync('docker', ['inspect', 'dima-b0-db', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
assert.equal(labels['com.docker.compose.project'], 'dima-b0');
assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));

mkdirSync(dirname(out), { recursive: true });
const fd = openSync(out, 'wx', 0o600);
const started = Date.now();
const emit = value => writeSync(fd, JSON.stringify(value) + '\n');
emit({ type: 'metadata', startedAt: new Date(started).toISOString(), intervalMs, requestedSeconds: seconds,
  source: 'pg_stat_activity: authenticator client backends only', observer: 'one separate direct PostgreSQL connection; not a PostgREST pool slot',
  limitations: ['Point samples do not measure CPU time or prove a cause.', 'Clients queued outside the PostgREST pool are absent.', 'Short waits can occur between samples.'], credentialsPrinted: false, queryTextPrinted: false });

// Only a fixed allowlist is extracted inside the database. No raw query crosses the pipe.
const sql = `SELECT json_build_object('at',clock_timestamp(),'serverStartedAt',pg_postmaster_start_time(),'groups',coalesce((
 SELECT json_agg(g) FROM (
  SELECT state,wait_event_type,wait_event,
   CASE WHEN state='active' THEN coalesce(substring(query FROM '\\m(read_room_me|read_room_snapshot|read_room_realtime_grant|execute_room_command|claim_room_hints|ack_room_hint|ack_room_hint_result|fail_room_hint|read_time_state|execute_time_command|dispatch_room_jobs|claim_room_jobs)\\M'),'other') ELSE 'idle' END AS operation,
   count(*)::integer AS connections
  FROM pg_stat_activity WHERE usename='authenticator' AND backend_type='client backend' AND datname=current_database()
  GROUP BY 1,2,3,4 ORDER BY 1,2,3,4
 ) g),'[]'::json))::jsonb;\n`;
const child = spawn('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stopping = false, reason = 'duration', pending = false, samples = 0, pendingSince = 0, buffer = '', stderrSeen = false;
let timer, stopTimer, killTimer;
const totals = new Map();
function stop(why) {
  if (stopping) return;
  stopping = true; reason = why;
  clearInterval(timer); clearTimeout(stopTimer);
  child.stdin.end();
  killTimer = setTimeout(() => child.kill('SIGTERM'), 3000);
}
function sample() {
  if (stopping) return;
  if (pending) { if (Date.now() - pendingSince > 3000) stop('sample-timeout'); return; }
  pending = true; pendingSince = Date.now(); child.stdin.write(sql);
}
child.stdin.on('error', () => stop('pipe-error'));
child.stderr.on('data', () => { stderrSeen = true; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', text => {
  buffer += text;
  if (buffer.length > 100000) { stop('unexpected-output'); return; }
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      assert.ok(Array.isArray(row.groups));
      emit({ type: 'sample', ...row }); samples++; pending = false;
      for (const group of row.groups) {
        const key = JSON.stringify([group.operation, group.state, group.wait_event_type, group.wait_event]);
        totals.set(key, (totals.get(key) ?? 0) + group.connections);
      }
    } catch { stop('invalid-sample'); }
  }
});
child.on('error', () => stop('process-error'));
child.on('close', code => {
  clearInterval(timer); clearTimeout(stopTimer); clearTimeout(killTimer);
  emit({ type: 'summary', endedAt: new Date().toISOString(), elapsedMs: Date.now() - started, samples, reason, exitCode: code, stderrSeen,
    connectionSamples: [...totals].map(([key, count]) => ({ dimensions: JSON.parse(key), count })) });
  closeSync(fd);
  console.log(JSON.stringify({ evidence: out, samples, reason, exitCode: code }));
  if (code !== 0 || !['duration', 'SIGINT', 'SIGTERM'].includes(reason) || samples === 0 || stderrSeen) process.exitCode = 1;
});
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.stdin.write("SET default_transaction_read_only=on; SET statement_timeout='1s';\n");
sample(); timer = setInterval(sample, intervalMs); stopTimer = setTimeout(() => stop('duration'), seconds * 1000);
