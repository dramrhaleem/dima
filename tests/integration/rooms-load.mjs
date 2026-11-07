// Local real-wall-clock load gate. Never ages a Run, membership or accepted ledger interval.
// Default: 2h at 4x20 members + 20 secondary tabs, then 10m at 8x10 + 20 tabs.
// Explicit probe: node tests/integration/rooms-load.mjs --probe --seconds=120 --varied-seconds=60
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readlinkSync, readdirSync, writeFileSync, renameSync, statfsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { runCoordinatedBurst } from '../helpers/room-load-burst.mjs';
import { isOwnedNodeProcess } from '../../scripts/local-backend/process.mjs';
import { readEnv, clientEnvPath, runtimeRoot } from '../../scripts/local-backend/env.mjs';
import { createRoomLoadClient, createRoomOperation, createBoundaryDiagnostics, closedGrantDelay, transientGrantDelay } from '../helpers/room-load-client.mjs';

const args = new Set(process.argv.slice(2));
const probe = args.has('--probe');
const initialJoinBurst = args.has('--initial-join-burst');
assert.ok(!initialJoinBurst || probe, 'Initial join burst is probe-only, never sustained acceptance');
const secondsArg = name => [...args].find(value => value.startsWith(`--${name}=`))?.split('=')[1];
const duration = Number(secondsArg('seconds') ?? (probe ? 120 : 7200));
const variedDuration = Number(secondsArg('varied-seconds') ?? (probe ? 60 : 600));
assert.ok(Number.isInteger(duration) && duration >= 30 && duration <= 14400);
assert.ok(Number.isInteger(variedDuration) && variedDuration >= 30 && variedDuration <= 3600);
assert.ok(probe || duration >= 7200, 'Short runs require --probe and are never sustained acceptance evidence');
for (const arg of args) assert.ok(arg === '--probe' || arg === '--initial-join-burst' || /^--(seconds|varied-seconds)=\d+$/.test(arg), `Unknown argument: ${arg}`);
const base = process.env.DIMA_TEST_API ?? 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const env = readEnv(clientEnvPath);
assert.equal(env.SUPABASE_URL, 'http://127.0.0.1:54321');
const ownership = readEnv(resolve(runtimeRoot, 'docker.env'));
assert.equal(ownership.DIMA_REPO_ROOT, resolve('.'));
assert.equal(ownership.DIMA_BACKEND_ROOT, runtimeRoot);
const containers = ['dima-b0-db', 'dima-b0-auth', 'dima-b0-rest', 'dima-b0-realtime'];
for (const name of containers) {
  const labels = JSON.parse(execFileSync('docker', ['inspect', name, '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
  assert.equal(labels['com.docker.compose.project'], 'dima-b0');
  assert.equal(labels['com.docker.compose.project.config_files'], resolve('scripts/local-backend/compose.yaml'));
}
const serviceKey = readEnv(resolve(runtimeRoot, 'server.env')).SUPABASE_SERVICE_ROLE_KEY;
assert.ok(serviceKey);
const jobsToken = readEnv(resolve(runtimeRoot, 'jobs.env')).DIMA_JOBS_TOKEN;
assert.ok(jobsToken);
function assertNoExternalPump() {
  const pidFile = resolve(runtimeRoot, 'jobs.pid');
  if (existsSync(pidFile) && isOwnedNodeProcess(Number(readFileSync(pidFile, 'utf8')), resolve('scripts/local-backend/dispatch.mjs'))) throw Object.assign(new Error('EXTERNAL_JOB_PUMP_ALREADY_RUNNING'), { code: 'EXTERNAL_JOB_PUMP_ALREADY_RUNNING' });
}
assertNoExternalPump();
const execAsync = promisify(execFile);
const buildConfig = resolve('.local/worker-build.json');
const buildRoot = existsSync(buildConfig) ? JSON.parse(readFileSync(buildConfig, 'utf8')).directory : resolve('.');
if (buildRoot !== resolve('.')) assert.equal(readFileSync(resolve(buildRoot, '.dima-build-owner'), 'utf8'), resolve('.'));
const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
const cpuSamples = new Map(), hintVersions = new Set();
const operationMetrics = {}, operationGroups = {};
const boundaryDiagnostics = createBoundaryDiagnostics();
let dispatchBusy = false, dispatchJob = null, dispatchTimer = null;
const require = createRequire(resolve('packages/client/package.json'));
const { RealtimeClient } = require('@supabase/realtime-js');
const runId = randomUUID();
const output = resolve(`docs/evidence/B5_ROOMS_LOAD_${initialJoinBurst ? 'INITIAL_BURST_PROBE' : probe ? 'PROBE' : 'SUSTAINED'}_${runId}.json`);
const startedAt = new Date().toISOString();
const buildManifestPath = resolve(buildRoot, '.dima-build-inputs.json');
const buildManifest = existsSync(buildManifestPath) ? JSON.parse(readFileSync(buildManifestPath, 'utf8')) : null;
const actors = [], allRooms = [], connections = [], expectedHints = [];
const aliveSockets = new Set();
let stop = false, interrupted = false, phase = 'setup-accounts', measuring = false, phaseStart = 0;
let activeBurst = null;
let activeRooms = [], failureCount = 0, totalConnectionSeconds = 0, authorizedConnectionSeconds = 0;
const stats = {
  codeEvidence: { harnessSha256: createHash('sha256').update(readFileSync('tests/integration/rooms-load.mjs')).digest('hex'),
    workloadSources: Object.fromEntries(['tests/helpers/room-load-client.mjs', 'tests/helpers/room-load-burst.mjs', 'packages/ui/src/rooms-provider.tsx', 'packages/ui/src/rooms.tsx', 'packages/ui/src/focus.tsx', 'packages/client/src/realtime.ts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
    buildFingerprint: buildManifest?.fingerprint ?? null, builtAt: buildManifest?.builtAt ?? null },
  initialJoinMode: initialJoinBurst ? 'separate-initial-80-action-burst' : 'ordinary-concurrency-6', initialBursts: [],
  startedAt, runId, mode: probe ? 'short-probe-not-acceptance' : 'sustained-local', requestedSeconds: duration, variedSeconds: variedDuration,
  environment: { network: 'Linux host loopback HTTP and WebSocket; no WAN or throttling', region: 'local', node: process.version, platform: process.platform, workerCpu: 'owned local workerd processes; not hosted CPU billing' },
  scope: { controllerAccounts: 80, secondaryReadOnlyConnections: 20, expectedConnections: 100, hostedEvidence: false, clockAcceleration: false,
    workloadProfile: 'current-ui-foreground-room-v4-time-snapshot-floors', requestPattern: 'Independent per-tab caches; snapshot-first hints/secondary polling and floor-aware room boundary; independent deadline timer plus one750ms retry; known live Time reconciliation uses snapshot with server-time and Time-revision floors, expired/denied recovery retains Me; unchanged renewal, activity-list and grant paths',
    privateLearningState: 'Synthetic accounts have no enrollments; rounds choose Work with no linked activity. Learning-list requests are retained, but large enrolled-course payload costs are not represented.',
    simulatedUserBehavior: 'Every controller explicitly chooses each eligible future round; owners change intent every120s. The product never auto-joins.',
    startupBoundary: 'Synthetic account/membership bootstrap precedes100 foreground room views. Public room metadata/time/room state are loaded; HTML/assets and cookie-auth shell bootstrap are not modeled.' },
  http: { requests: 0, errors: 0, bytesIn: 0, bytesOut: 0, authRefreshes: 0, grants: 0, renewals: 0, joins: 0, snapshots: 0, durationsMs: [] },
  realtime: { opened: 0, closed: 0, peakTransportConnections: 0, peakAuthorizedSubscriptions: 0, wireFramesIn: 0, wireFramesOut: 0,
    wireBytesIn: 0, wireBytesOut: 0, deliveredHints: 0, malformedHints: 0, reconnects: 0, intentionalDisconnects: 0, grantRefreshes: 0, subscriptionFailures: 0, missedExpectedHintDeliveries: 0, lateExpectedHintDeliveries: 0, truncatedHintTimeoutEvents: 0 },
  dispatcher: { cadenceSeconds: 30, httpEnvelopeSeconds: 45, singleFlight: true, baseline: null, samples: [], scopedFinal: null },
  databaseDiagnostics: { baseline: null, final: null, observedDeadlocks: null, windows: [], finalFlushSamples: [] },
  interruptions: [], checkpoints: [], hintTimeouts: [], slowSamples: [], failures: [], phases: [], samples: [], resources: [], ledgerProbes: [], roundParticipation: [], hintLatencyMs: [], phaseAgreementMs: [], joinRoundActionMs: [], cleanup: [],
  limitations: ['Local runtime only; no hosted CPU, billing or provider capacity claim.', 'The in-process30s dispatcher executes normal durable project jobs; existing backlog is recorded separately and never reset.', 'Server-Timing reports coarse handler wall-clock segments. rpc includes transport/pool/lock/SQL; response timing is not CPU billing.', 'Wire frames and application hint deliveries are separate; provider billed message units are not inferred from frames.', 'No artificial OS/network throttling. Planned connection interruption is explicitly labeled.', 'Synthetic accounts and immutable time history are retained for audit; cleanup uses own-user Finish/Leave and owner Close.'],
};
function fail(stage, code, status) {
  failureCount += 1;
  if (stats.failures.length < 100) stats.failures.push({ phase, elapsedSeconds: measuring ? Math.round((performance.now() - phaseStart) / 1000) : null, stage, code, ...(status ? { status } : {}) });
}
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 100) / 100; }
function metricSummary(value) { return { requests: value.values.length, errors: value.errors, p50: percentile(value.values, .5), p95: percentile(value.values, .95), p99: percentile(value.values, .99), max: value.values.length ? Math.max(...value.values) : null, serverTiming: Object.fromEntries(Object.entries(value.timing ?? {}).map(([name, values]) => [name, { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) }])) }; }
function summary(final = false) {
  const pending = expectedHints.reduce((sum, event) => sum + event.expected.size, 0);
  return { ...stats, boundaryDiagnostics: boundaryDiagnostics.report, checkedAt: new Date().toISOString(), final, interrupted, completed: final && !interrupted && phase === 'done',
    acceptanceEligible: !probe && final && !interrupted && phase === 'done' && failureCount === 0 && stats.http.errors === 0 && pending === 0 && !stats.cleanup.some(item => item.status === 'failed'),
    failureCount, realtime: { ...stats.realtime, liveTransportConnections: aliveSockets.size, connectionSeconds: totalConnectionSeconds,
      authorizedConnectionSeconds, expectedHintDeliveriesStillPending: pending },
    http: { ...stats.http, durationsMs: undefined, latencyMs: { p50: percentile(stats.http.durationsMs, .5), p95: percentile(stats.http.durationsMs, .95), p99: percentile(stats.http.durationsMs, .99) } },
    operationLatency: Object.fromEntries(Object.entries(operationMetrics).map(([key, value]) => [key, metricSummary(value)])),
    operationGroups: Object.fromEntries(Object.entries(operationGroups).map(([group, values]) => [group, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, metricSummary(value)]))])),
    distinctReceivedRoomVersions: hintVersions.size,
    phaseAgreementMs: { samples: stats.phaseAgreementMs.length, p95: percentile(stats.phaseAgreementMs, .95), max: stats.phaseAgreementMs.length ? Math.max(...stats.phaseAgreementMs) : null, model: 'Server-timestamp anchored virtual display compared with fresh authoritative snapshots; real browser rendering is a separate gate' },
    joinRoundActionMs: { samples: stats.joinRoundActionMs.length, p95: percentile(stats.joinRoundActionMs, .95), includesPreparatoryReads: false, includesPostActionSnapshot: true, backgroundTimeReadsMayOverlap: true },
    hintLatencyMs: { samples: stats.hintLatencyMs.length, p50: percentile(stats.hintLatencyMs, .5), p95: percentile(stats.hintLatencyMs, .95), p99: percentile(stats.hintLatencyMs, .99) },
    credentialsPrinted: false };
}
function save(final = false) { writeFileSync(`${output}.tmp`, JSON.stringify(summary(final), null, 2) + '\n'); renameSync(`${output}.tmp`, output); }
function checkpoint(stage) {
  stats.checkpoints.push({ stage, at: new Date().toISOString(), phase, accounts: actors.length, rooms: allRooms.length,
    completedBursts: stats.initialBursts.filter(item => item.status === 'completed').length });
  save();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stop = true; interrupted = true;
  const event = { signal, at: new Date().toISOString(), phase, elapsedSeconds: measuring ? (performance.now() - phaseStart) / 1000 : null };
  stats.interruptions.push(event); console.log(JSON.stringify({ event: 'load-interrupted', ...event }));
});
async function pool(values, concurrency, fn) {
  let cursor = 0, failure;
  await Promise.all(Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (cursor < values.length && !failure) { const index = cursor++; try { await fn(values[index], index); } catch (error) { failure ??= error; } }
  }));
  if (failure) throw failure;
}
async function tokenRequest(path, body, admin = false) {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, { method: 'POST', headers: { apikey: admin ? serviceKey : env.SUPABASE_ANON_KEY,
    ...(admin ? { Authorization: `Bearer ${serviceKey}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Object.assign(new Error('AUTH_REQUEST_FAILED'), { code: 'AUTH_REQUEST_FAILED', status: response.status });
  return response.json();
}
async function refreshAuth(actor) {
  if (actor.expiresAt > Date.now() + 90000) return;
  if (!actor.refreshPromise) actor.refreshPromise = (async () => {
    const session = await tokenRequest('token?grant_type=refresh_token', { refresh_token: actor.refreshToken });
    assert.equal(session.user.id, actor.userId);
    actor.token = session.access_token; actor.refreshToken = session.refresh_token;
    actor.expiresAt = Date.now() + session.expires_in * 1000;
    stats.http.authRefreshes += 1;
  })().finally(() => { actor.refreshPromise = null; });
  await actor.refreshPromise;
}
async function api(actor, path, method = 'GET', body, onTiming) {
  if (actor) await refreshAuth(actor);
  const started = performance.now(), startedEpoch = Date.now(), group = phase, payload = body === undefined ? undefined : JSON.stringify(body);
  const operation = method === 'POST' && path === 'rooms' ? `rooms.${body.type}` : path.endsWith('/snapshot') ? 'rooms.snapshot' : path.endsWith('/realtime') ? 'rooms.grant' : `${method} ${path.split('?')[0]}`;
  operationMetrics[operation] ??= { values: [], errors: 0, timing: {} };
  operationGroups[group] ??= {}; operationGroups[group][operation] ??= { values: [], errors: 0, timing: {} };
  stats.http.requests += 1; stats.http.bytesOut += payload ? Buffer.byteLength(payload) : 0;
  const noteError = () => { stats.http.errors++; operationMetrics[operation].errors++; operationGroups[group][operation].errors++; };
  let response, text;
  const burstSample = operation === 'rooms.joinRound' && activeBurst?.released ? activeBurst.actions.find(item => item.index === actor.index) : null;
  if (burstSample) {
    assert.equal(burstSample.dispatchOffsetMs, null, 'Each burst actor submits exactly one initial JoinRound');
    burstSample.dispatchOffsetMs = performance.now() - activeBurst.releasedAt;
    activeBurst.inFlight++; activeBurst.peakInFlight = Math.max(activeBurst.peakInFlight, activeBurst.inFlight);
  }
  try {
    response = await fetch(`${base}/api/v1/${path}`, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}`, 'X-Dima-Account-Id': actor.userId } : {}),
      'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: payload }), signal: AbortSignal.timeout(20000) });
    text = await response.text();
  } catch (error) {
    const elapsed = performance.now() - started;
    stats.http.durationsMs.push(elapsed); operationMetrics[operation].values.push(elapsed); operationGroups[group][operation].values.push(elapsed); noteError();
    onTiming?.({ requestDurationMs: elapsed, outcome: 'transport-error' });
    throw Object.assign(new Error('TRANSPORT_FAILED'), { code: error.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'TRANSPORT_FAILED' });
  } finally {
    if (burstSample) { burstSample.httpDurationMs = performance.now() - started; burstSample.status = response?.status ?? null; activeBurst.inFlight--; }
  }
  const elapsedMs = performance.now() - started; stats.http.bytesIn += Buffer.byteLength(text); stats.http.durationsMs.push(elapsedMs);
  const timings = Object.fromEntries([...String(response.headers.get('Server-Timing') ?? '').matchAll(/(?:^|,)\s*(auth|profile|rpc|sign|response|total);dur=(\d+(?:\.\d+)?)/g)].map(match => [match[1], Number(match[2])]));
  onTiming?.({ requestDurationMs: elapsedMs, statusCode: response.status, outcome: response.ok ? 'http-ok' : 'http-error', serverTiming: timings });
  for (const metrics of [operationMetrics[operation], operationGroups[group][operation]]) {
    metrics.values.push(elapsedMs);
    for (const [name, value] of Object.entries(timings)) { metrics.timing[name] ??= []; metrics.timing[name].push(value); }
  }
  let data;
  try { data = JSON.parse(text); }
  catch { noteError(); throw Object.assign(new Error('INVALID_RESPONSE'), { code: 'INVALID_RESPONSE', status: response.status }); }
  if (['rooms.join', 'rooms.joinRound', 'rooms.startRun'].includes(operation)) {
    const acceptedAt = Date.parse(data.receipt?.acceptedAt ?? '');
    stats.slowSamples.push({ operation, group, elapsedMs, timing: timings, beforeLockBoundaryMs: Number.isFinite(acceptedAt) ? acceptedAt - startedEpoch : null, afterLockBoundaryMs: Number.isFinite(acceptedAt) ? Date.now() - acceptedAt : null });
    stats.slowSamples.sort((a, b) => b.elapsedMs - a.elapsedMs); stats.slowSamples.length = Math.min(stats.slowSamples.length, 50);
  }
  if (!response.ok) { noteError(); throw Object.assign(new Error(data.error?.code ?? 'API_REQUEST_FAILED'), { code: data.error?.code ?? 'API_REQUEST_FAILED', status: response.status }); }
  return data;
}
async function createActor(index) {
  const email = `b5-load-${runId}-${index}@example.test`, password = randomBytes(24).toString('base64url');
  const user = await tokenRequest('admin/users', { email, password, email_confirm: true }, true);
  const session = await tokenRequest('token?grant_type=password', { email, password });
  const actor = { index, userId: user.id, token: session.access_token, refreshToken: session.refresh_token, expiresAt: Date.now() + session.expires_in * 1000,
    deviceId: randomUUID(), me: null, time: null, room: null, nextHeartbeat: 0, nextJoinAttempt: 0, busy: false, job: null, joinedRound: null, acceptedRounds: new Set(), operation: createRoomOperation(randomUUID) };
  actors.push(actor);
  const initial = (await api(actor, 'me')).data;
  await api(actor, 'me', 'PATCH', { operationId: randomUUID(), expectedRevision: initial.profile?.revision ?? 0, displayName: `Load participant ${index + 1}`,
    timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: true });
  await loadActor(actor);
}
async function loadActor(actor, roomId) {
  actor.time = (await api(actor, 'time?limit=1')).data;
  actor.me = (await api(actor, `rooms/me${roomId ? `?roomId=${roomId}` : ''}`)).data;
}
const presence = actor => ({ roomId: actor.me.membership.roomId, deviceId: actor.deviceId, controlVersion: actor.me.membership.controlVersion });
const primaryConnection = actor => connections.find(conn => conn.actor === actor && !conn.secondary && conn.desired);
async function roomCommand(actor, fields) {
  const body = actor.operation.prepare(fields, actor.me.revision);
  let result;
  try { result = await api(actor, 'rooms', 'POST', body); actor.operation.succeeded(); }
  catch (error) {
    actor.operation.failed(error);
    if ([403, 409, 410].includes(error.status)) await primaryConnection(actor)?.ui.refresh();
    throw error;
  }
  if (fields.type !== 'renewPresence' && result.data.room && connections.some(conn => conn.status === 'SUBSCRIBED')) recordExpectedHint(result.data.room.id, result.data.room.hintVersion, result.receipt.acceptedAt);
  const primary = primaryConnection(actor);
  if (primary) await primary.ui.acceptCommand(result, fields.type);
  else {
    actor.me = result.data; if (result.time) actor.time = result.time;
    if (result.data.membership?.status === 'active') {
      // Bootstrap/cleanup has no mounted tab. Snapshot failure does not un-accept
      // a successful command or turn the next tick into a new user command.
      try { actor.me = (await privateSnapshot(actor, result.data.membership.roomId)).me; }
      catch (error) { fail('action-snapshot', error.code ?? 'SNAPSHOT_FAILED', error.status); }
    }
  }
  return result;
}
async function privateSnapshot(actor, roomId) {
  const result = (await api(actor, `rooms/${roomId}/snapshot`)).data;
  stats.http.snapshots += 1;
  return result;
}
async function setupDistribution(roomCount) {
  const groupSize = 80 / roomCount;
  phase = `setup-${roomCount}x${groupSize}`;
  const dbBefore = await databaseCounter(`${phase}:before`);
  const owners = roomCount === 4 ? [0, 20, 40, 60] : [1, 11, 21, 31, 41, 51, 61, 71];
  activeRooms = [];
  const ordered = [...owners.map(index => actors[index]), ...actors.filter(actor => !owners.includes(actor.index))];
  for (let index = 0; index < roomCount; index += 1) {
    if (stop) return;
    const owner = ordered[index]; await loadActor(owner);
    const created = await roomCommand(owner, { type: 'create', deviceId: owner.deviceId, title: `Load ${runId.slice(0, 8)} room ${allRooms.length + 1}`,
      description: 'Synthetic real-wall-clock capacity verification', language: 'en', topic: 'Load acceptance', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
    const room = { id: created.receipt.roomId, owner, actors: [owner], run: null, nextPulse: 0, pulse: 0 }; owner.room = room;
    activeRooms.push(room); allRooms.push(room);
  }
  const others = ordered.slice(roomCount);
  await pool(others, 6, async (actor, index) => {
    const room = activeRooms[Math.floor(index / (groupSize - 1))];
    await loadActor(actor);
    await roomCommand(actor, { type: 'join', roomId: room.id, deviceId: actor.deviceId, acknowledgeVisibility: true, visibilityVersion: 1 });
    actor.room = room; room.actors.push(actor);
  });
  for (const actor of actors) { actor.nextHeartbeat = Infinity; actor.nextJoinAttempt = 0; }
  const setupPump = globalThis.setInterval(() => {
    if (stop) return;
    try { pumpClients(performance.now(), false, false); }
    catch (error) { fail('setup-pump', error.code ?? 'SETUP_PUMP_FAILED'); stop = true; }
  }, 100);
  try {
  await pool([...actors.map(actor => ({ actor, secondary: false })), ...actors.slice(0, 20).map(actor => ({ actor, secondary: true }))], 5,
    async spec => { const conn = { id: randomUUID(), ...spec, roomId: spec.actor.room.id, client: null, channel: null, status: 'new', desired: true,
      grantAt: 0, grantExpires: 0, nextGrantAt: Infinity, grantRetry: 0, refreshing: false, latestVersion: 0, latestReceivedAt: 0, snapshotDue: 0, snapshotBusy: false, faultUntil: 0, nextSecondaryPoll: performance.now() + 30000, clock: null, run: null, phaseKey: null, phaseBoundary: null, phaseBoundaryServerMs: null, phaseEndsAt: null };
      conn.ui = createRoomLoadClient({ owner: spec.actor.userId, roomId: conn.roomId,
        request: async (path, metadata = {}) => {
          const endpoint = path.endsWith('/snapshot') ? 'rooms.snapshot' : path.startsWith('rooms/me?') ? 'rooms.me'
            : path === 'time?limit=1' ? 'time.compact' : path.startsWith('time?sessionId=') ? 'time.detail' : path === 'learning' ? 'learning' : 'other';
          const observation = boundaryDiagnostics.startRequest(boundaryConnectionKey(conn), { ...metadata, endpoint });
          try {
            const value = await api(conn.actor, path, 'GET', undefined, timing => boundaryDiagnostics.endRequest(observation, timing));
            if (path.endsWith('/snapshot')) stats.http.snapshots++; return value;
          } finally { boundaryDiagnostics.endRequest(observation, { outcome: 'unresolved-transport' }); }
        },
        onMe: value => { if (!conn.secondary) conn.actor.me = value; },
        onTime: value => { if (!conn.secondary) conn.actor.time = value; },
        onSnapshot: (value, metadata) => snapshotAccepted(conn, value, metadata),
        onDiagnostic: event => boundaryDiagnostics.event(boundaryConnectionKey(conn), event),
        onError: (stage, error) => fail(`tab-${stage}`, error.code ?? 'READ_FAILED', error.status),
      });
      if (!conn.secondary) conn.actor.nextHeartbeat = performance.now() + 30000;
      connections.push(conn);
      await Promise.all([conn.ui.loadTime(), conn.ui.loadMe(), api(null, `rooms/${conn.roomId}`)]);
      await conn.ui.snapshotFor();
      conn.refreshing = true;
      try { await connect(conn); } finally { conn.refreshing = false; }
    });
  assert.equal(connections.filter(conn => conn.status === 'SUBSCRIBED').length, 100);
  await ledgerProbe(); // All participants are still Watching: no accepted personal time yet.
  assert.equal(stats.ledgerProbes.at(-1).activeSessions, 0, 'Watching setup must not create personal time');
  for (const room of activeRooms) {
    await actorAction(room.owner, async () => {
      const snapshot = await privateSnapshot(room.owner, room.id); room.owner.me = snapshot.me;
      await roomCommand(room.owner, { type: 'startRun', ...presence(room.owner), roomVersion: snapshot.room.version });
      room.run = room.owner.me.room.run; room.clock = { serverMs: Date.parse(room.owner.me.serverTime), monotonic: performance.now() };
    });
  }
  if (initialJoinBurst) await initialBurst();
  else {
  await pool(actors, 6, actor => actorAction(actor, async () => {
    const deadline = performance.now() + 30000;
    while (!stop && performance.now() < deadline && !joinEligible(actor)) await delay(50);
    if (!joinEligible(actor)) throw Object.assign(new Error('JOIN_OPTION_NOT_READY'), { code: 'JOIN_OPTION_NOT_READY' });
    await explicitJoinRound(actor);
  }));
  }
  await drainExpectedHints();
  } finally {
    globalThis.clearInterval(setupPump);
    await Promise.allSettled(actors.map(actor => actor.job));
    await Promise.allSettled(connections.flatMap(conn => [conn.job, conn.snapshotJob, conn.secondaryJob]));
    await databaseWindow(dbBefore, phase);
  }
}
async function initialBurst() {
  const record = { group: phase, expected: 80, status: 'waiting', released: false, releasedAt: null,
    readinessMs: null, inFlight: 0, peakInFlight: 0, dispatchSkewMs: null, actions: [] };
  stats.initialBursts.push(record); activeBurst = record;
  try {
    await runCoordinatedBurst(actors, {
      withGuard: actorAction, stopped: () => stop,
      ready: actor => {
        const conn = primaryConnection(actor), snapshot = conn?.ui.snapshot;
        if (!joinEligible(actor) || conn.status !== 'SUBSCRIBED' || snapshot.room.run.id !== actor.room.run.id
          || snapshot.room.phase.roundIndex !== 1 || snapshot.access.generation !== actor.me.membership.controlVersion
          || snapshot.access.membershipId !== actor.me.membership.id
          || Date.parse(snapshot.serverTime) < Date.parse(actor.room.run.startedAt)) return null;
        return { snapshotAgeMs: Math.max(0, conn.ui.serverNow() - Date.parse(snapshot.serverTime)) };
      },
      onRelease: (rows, readinessMs) => {
        assert.equal(connections.filter(conn => conn.status === 'SUBSCRIBED').length, 100);
        record.readinessMs = readinessMs;
        record.actions = rows.map(row => ({ index: row.item.index, guardWaitMs: row.guardWaitMs,
          snapshotAgeMs: row.ready.snapshotAgeMs, dispatchOffsetMs: null, httpDurationMs: null, fullActionDurationMs: null, status: null }));
        record.releasedAt = performance.now(); record.released = true; record.status = 'running';
      },
      action: async actor => {
        const started = performance.now();
        try { await explicitJoinRound(actor); }
        finally { record.actions.find(item => item.index === actor.index).fullActionDurationMs = performance.now() - started; }
      },
    });
    const dispatched = record.actions.filter(item => item.dispatchOffsetMs !== null);
    record.dispatchSkewMs = dispatched.length ? Math.max(...dispatched.map(item => item.dispatchOffsetMs)) - Math.min(...dispatched.map(item => item.dispatchOffsetMs)) : null;
    assert.equal(dispatched.length, 80, 'All80 cached actions must reach the actual HTTP boundary');
    assert.equal(record.actions.filter(item => item.status === 200).length, 80);
    assert.equal(actors.filter(actor => actor.acceptedRounds.has(`${actor.room.run.id}:1`)).length, 80);
    await ledgerProbe();
    record.ledger = stats.ledgerProbes.at(-1);
    assert.equal(record.ledger.activeSessions, 80); assert.equal(record.ledger.duplicateActiveAccounts, 0);
    assert.equal(record.ledger.openIntervals, 80); assert.equal(record.ledger.multipleOpenAccounts, 0);
    const ids = actors.map(actor => actor.userId).join(','), runs = activeRooms.map(room => room.run.id).join(',');
    const participations = await restRead(`round_participations?user_id=in.(${ids})&run_id=in.(${runs})&round_index=eq.1&select=id,user_id,room_id,run_id,round_index`);
    const sessions = await restRead(`time_sessions?user_id=in.(${ids})&status=in.(running,paused,needsReview)&select=id,user_id,mode,room_id,participation_id`);
    assert.equal(participations.length, 80); assert.equal(new Set(participations.map(row => row.user_id)).size, 80);
    assert.equal(sessions.length, 80); assert.equal(new Set(sessions.map(row => row.id)).size, 80);
    for (const actor of actors) {
      const participation = participations.find(row => row.user_id === actor.userId);
      const session = sessions.find(row => row.user_id === actor.userId);
      assert.equal(participation.room_id, actor.room.id); assert.equal(participation.run_id, actor.room.run.id);
      assert.equal(participation.round_index, 1); assert.equal(session.mode, 'room');
      assert.equal(session.room_id, actor.room.id); assert.equal(session.participation_id, participation.id);
    }
    record.ledgerPairing = { expectedAccounts: 80, distinctParticipatingAccounts: 80, distinctSessions: 80,
      exactAccountRoomRunRoundAndSessionPairing: true, currentRunCount: activeRooms.length, roundIndex: 1 };
    record.status = 'completed';
  } catch (error) { record.status = 'failed'; record.code = error.code ?? 'BURST_FAILED'; throw error; }
  finally {
    const offsets = record.actions.filter(item => item.dispatchOffsetMs !== null).map(item => item.dispatchOffsetMs);
    record.dispatchSkewMs = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null;
    activeBurst = null; checkpoint('initial-burst-settled');
  }
}
async function actorAction(actor, operation) {
  while (actor.busy) await actor.job;
  if (stop) return;
  actor.busy = true;
  actor.job = Promise.resolve().then(operation).finally(() => { actor.busy = false; });
  return actor.job;
}
async function explicitJoinRound(actor) {
  const actionStart = performance.now();
  if (!joinEligible(actor)) return;
  const room = primaryConnection(actor).ui.snapshot.room;
  const roundIndex = room.phase.roundIndex;
  // A failed user action may be retried after30s, not every200ms pump tick.
  // The operation store preserves its exact original receipt identity.
  actor.nextJoinAttempt = actionStart + 30000;
  await roomCommand(actor, { type: 'joinRound', ...presence(actor), runId: room.run.id, roundIndex,
    expectedTimeRevision: actor.time.revision, category: 'work', enrollmentId: null, taskId: null });
  actor.joinedRound = `${room.run.id}:${roundIndex}`; actor.acceptedRounds.add(actor.joinedRound);
  stats.http.joins += 1; stats.joinRoundActionMs.push(performance.now() - actionStart);
}
function joinEligible(actor) {
  const tab = primaryConnection(actor)?.ui, room = tab?.snapshot?.room;
  return !!tab?.live() && !!tab.time && !tab.time.active && room?.phase.kind === 'focus' && room.run
    && tab.snapshot.capabilities.canJoinRound && tab.me.membership.deviceId === actor.deviceId
    && tab.serverNow() < Date.parse(room.phase.endsAt) && actor.joinedRound !== `${room.run.id}:${room.phase.roundIndex}`;
}
function projectedPhase(run, atMs) {
  if (!run) return { key: 'lobby', end: null };
  if (run.status === 'cancelled') return { key: 'cancelled', end: null };
  const start = Date.parse(run.startedAt), elapsed = (atMs - start) / 1000;
  if (elapsed >= 7800) return { key: 'completed', end: null };
  const index = Math.min(4, Math.floor(Math.max(0, elapsed) / 1800) + 1), offset = (index - 1) * 1800;
  return elapsed - offset < 1500 ? { key: `focus:${index}`, end: start + (offset + 1500) * 1000 }
    : { key: `${index === 4 ? 'longBreak' : 'shortBreak'}:${index}`, end: start + (index === 4 ? 7800 : offset + 1800) * 1000 };
}
function boundaryConnectionKey(conn) { return `${allRooms.findIndex(room => room.id === conn.roomId)}:${connectionIndex(conn)}`; }
function snapshotAccepted(conn, snapshot, diagnostic = {}) {
  const now = performance.now();
  if (conn.clock && Date.parse(snapshot.serverTime) < conn.clock.serverMs) return;
  const serverKey = snapshot.room.phase.roundIndex ? `${snapshot.room.phase.kind}:${snapshot.room.phase.roundIndex}` : snapshot.room.phase.kind;
  const serverMs = Date.parse(snapshot.serverTime);
  if (projectedPhase(snapshot.room.run, serverMs).key !== serverKey) fail('phase-agreement', 'AUTHORITATIVE_PHASE_INCONSISTENT_WITH_RUN');
  // A hint/heartbeat may confirm a real deadline before the next client-pump tick.
  if (conn.phaseBoundary === null && conn.phaseEndsAt !== null && serverMs >= conn.phaseEndsAt && serverKey !== conn.phaseKey) {
    const readinessMs = Math.max(0, Date.now() - conn.phaseEndsAt);
    stats.phaseAgreementMs.push(readinessMs);
    boundaryDiagnostics.event(boundaryConnectionKey(conn), { type: 'boundary-confirmed', ...diagnostic, expectedBoundaryMs: conn.phaseEndsAt,
      readinessMs, serverTimeMs: serverMs, roomVersion: snapshot.room.version, hintVersion: snapshot.room.hintVersion, phaseKey: serverKey });
  }
  if (conn.phaseBoundary !== null) {
    if (Date.parse(snapshot.serverTime) < conn.phaseBoundaryServerMs) return;
    const terminalLobby = conn.run && conn.phaseBoundaryServerMs === Date.parse(conn.run.plannedEndAt) && snapshot.room.run === null && serverKey === 'lobby';
    if (serverKey === conn.phaseKey || terminalLobby) {
      const readinessMs = Math.max(0, Date.now() - conn.phaseBoundaryServerMs);
      stats.phaseAgreementMs.push(readinessMs);
      boundaryDiagnostics.event(boundaryConnectionKey(conn), { type: 'boundary-confirmed', ...diagnostic, expectedBoundaryMs: conn.phaseBoundaryServerMs,
        readinessMs, serverTimeMs: serverMs, roomVersion: snapshot.room.version, hintVersion: snapshot.room.hintVersion, phaseKey: serverKey });
      conn.phaseBoundary = null;
    }
    else { fail('phase-agreement', 'AUTHORITATIVE_PHASE_DIFFERS_FROM_ANCHORED_DISPLAY'); conn.phaseBoundary = null; }
  }
  conn.clock = { serverMs: Date.parse(snapshot.serverTime), monotonic: now };
  conn.run = snapshot.room.run;
  conn.phaseKey = serverKey; conn.phaseEndsAt = projectedPhase(conn.run, conn.clock.serverMs).end;
  boundaryDiagnostics.arm(boundaryConnectionKey(conn), { connectionIndex: connectionIndex(conn), role: conn.secondary ? 'secondary' : 'primary',
    roomIndex: allRooms.findIndex(room => room.id === conn.roomId), expectedBoundaryMs: conn.phaseEndsAt, anchorServerMs: serverMs,
    anchorMonotonicMs: now, anchorRevision: snapshot.me.revision, roomVersion: snapshot.room.version, hintVersion: snapshot.room.hintVersion });
}
function recordExpectedHint(roomId, version, acceptedAt) {
  const expected = new Set(connections.filter(conn => conn.roomId === roomId && conn.status === 'SUBSCRIBED' && !conn.faultUntil).map(conn => conn.id));
  const event = { roomId, version, acceptedAt: Date.parse(acceptedAt), expected, created: performance.now(), phase };
  expectedHints.push(event);
  for (const conn of connections.filter(conn => expected.has(conn.id) && conn.latestVersion >= version)) acknowledgeHint(event, conn, conn.latestReceivedAt);
}
function connectionIndex(conn) { return conn.actor.index + (conn.secondary ? 80 : 0); }
function expireExpectedHint(event, code, detectedBy = 'pump') {
  if (event.timeout) return;
  fail('hint-delivery', code); stats.realtime.missedExpectedHintDeliveries += event.expected.size;
  event.timeout = { phase: event.phase, roomIndex: allRooms.findIndex(room => room.id === event.roomId), expectedVersion: event.version,
    eventAgeMs: Math.round(performance.now() - event.created), detectedBy, unresolved: event.expected.size,
    missing: connections.filter(conn => event.expected.has(conn.id)).map(conn => ({ connectionIndex: connectionIndex(conn),
      latestVersionAtDetection: conn.latestVersion, statusAtDetection: conn.status, lateVersion: null, lateLatencyMs: null })) };
  if (stats.hintTimeouts.length < 100) stats.hintTimeouts.push(event.timeout);
  else stats.realtime.truncatedHintTimeoutEvents++;
}
function acknowledgeHint(event, conn, receivedAt) {
  if (event.expected.has(conn.id) && !event.timeout && performance.now() - event.created > 10000) expireExpectedHint(event, 'EXPECTED_HINT_NOT_RECEIVED_WITHIN_10S', 'late-arrival');
  if (!event.expected.delete(conn.id)) return;
  const latency = Math.max(0, receivedAt - event.acceptedAt);
  stats.hintLatencyMs.push(latency);
  if (event.timeout) {
    stats.realtime.lateExpectedHintDeliveries++;
    event.timeout.unresolved = event.expected.size;
    const observed = event.timeout.missing.find(item => item.connectionIndex === connectionIndex(conn));
    if (observed) { observed.lateVersion = conn.latestVersion; observed.lateLatencyMs = latency; }
  }
}
function receiveHint(conn, message) {
  const hint = message.payload;
  if (!hint || Object.keys(hint).sort().join(',') !== 'count,phase,version' || !Number.isInteger(hint.version) || !hint.count ||
    Object.keys(hint.count).sort().join(',') !== 'connected,reserved' || JSON.stringify(hint).length > 500) {
    stats.realtime.malformedHints += 1; fail('realtime', 'INVALID_HINT_PROJECTION'); return;
  }
  stats.realtime.deliveredHints += 1; hintVersions.add(`${conn.roomId}:${hint.version}`);
  conn.latestVersion = Math.max(conn.latestVersion, hint.version); conn.latestReceivedAt = Date.now(); conn.ui.invalidate(hint.version);
  for (const event of expectedHints) if (event.roomId === conn.roomId && hint.version >= event.version) acknowledgeHint(event, conn, conn.latestReceivedAt);
}
class CountedSocket extends globalThis.WebSocket {
  constructor(url, protocols) {
    super(url, protocols);
    const socketId = randomUUID();
    this.addEventListener('open', () => { aliveSockets.add(socketId); stats.realtime.opened += 1; stats.realtime.peakTransportConnections = Math.max(stats.realtime.peakTransportConnections, aliveSockets.size); });
    this.addEventListener('close', () => { if (aliveSockets.delete(socketId)) stats.realtime.closed += 1; });
    this.addEventListener('message', event => { stats.realtime.wireFramesIn += 1; stats.realtime.wireBytesIn += typeof event.data === 'string' ? Buffer.byteLength(event.data) : event.data.byteLength ?? 0; });
  }
  send(data) { stats.realtime.wireFramesOut += 1; stats.realtime.wireBytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength ?? 0; return super.send(data); }
}
async function grant(conn) {
  const value = (await api(conn.actor, `rooms/${conn.roomId}/realtime`, 'POST', {})).data;
  stats.http.grants += 1; conn.grantAt = performance.now(); conn.grantExpires = Date.parse(value.expiresAt);
  conn.nextGrantAt = performance.now() + Math.max(1000, conn.grantExpires - conn.ui.serverNow() - 15000);
  return value;
}
async function connect(conn, freshGrant = null) {
  if (!conn.desired || stop) return;
  const credentials = freshGrant ?? await grant(conn);
  if (conn.client) await disconnect(conn);
  conn.closing = false;
  conn.client = new RealtimeClient(credentials.url, { params: { apikey: credentials.anonKey }, transport: CountedSocket, timeout: 10000,
    heartbeatIntervalMs: 30000, reconnectAfterMs: attempts => [1000, 2000, 5000, 10000][Math.min(attempts - 1, 3)] + Math.floor(Math.random() * 500), logger: () => {} });
  const activeClient = conn.client;
  await conn.client.setAuth(credentials.token);
  conn.channel = conn.client.channel(credentials.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { enabled: false } } });
  conn.channel.on('broadcast', { event: '*' }, message => {
    if (conn.client !== activeClient) return;
    if (message.event !== 'invalidate') { fail('realtime-privacy', 'UNEXPECTED_BROADCAST_EVENT'); return; }
    receiveHint(conn, message);
  });
  await new Promise((resolveJoin, reject) => {
    const timeout = globalThis.setTimeout(() => reject(Object.assign(new Error('SUBSCRIBE_TIMEOUT'), { code: 'SUBSCRIBE_TIMEOUT' })), 15000);
    conn.channel.subscribe(status => {
      if (conn.client !== activeClient || conn.closing) return;
      conn.status = status;
      if (status === 'SUBSCRIBED') { globalThis.clearTimeout(timeout); conn.grantRetry = 0; conn.ui.connected(); stats.realtime.peakAuthorizedSubscriptions = Math.max(stats.realtime.peakAuthorizedSubscriptions, connections.filter(item => item.status === 'SUBSCRIBED').length); resolveJoin(); }
      else if (status === 'CLOSED') conn.nextGrantAt = performance.now() + closedGrantDelay(conn.grantRetry++);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { stats.realtime.subscriptionFailures += 1; fail('subscription', status); globalThis.clearTimeout(timeout); reject(Object.assign(new Error('SUBSCRIBE_FAILED'), { code: 'SUBSCRIBE_FAILED' })); }
    });
  });
}
async function disconnect(conn) {
  conn.closing = true; if (conn.client) stats.realtime.intentionalDisconnects += 1;
  conn.status = 'CLOSED';
  if (conn.client) { await conn.client.disconnect(); await Promise.race([conn.client.removeAllChannels(), delay(1500)]); }
  conn.client = null; conn.channel = null;
}
async function grantFailed(conn, error, stage) {
  fail(stage, error.code ?? 'GRANT_FAILED', error.status);
  if ([401, 403, 410].includes(error.status)) {
    conn.grantDenied = true; conn.nextGrantAt = Infinity;
    conn.ui.denyRealtime(); await disconnect(conn); await conn.ui.loadMe();
  } else conn.nextGrantAt = performance.now() + transientGrantDelay;
}
function schedule(actor, fn, stage) {
  if (actor.busy || stop) return;
  actor.busy = true;
  actor.job = fn().catch(error => fail(stage, error.code ?? 'REQUEST_FAILED', error.status)).finally(() => { actor.busy = false; });
}
async function heartbeat(actor) {
  if (actor.operation.pending && actor.operation.pending.type !== 'renewPresence') return;
  const tab = primaryConnection(actor)?.ui;
  if (!tab) return;
  if (!tab.live() || tab.me.membership.deviceId !== actor.deviceId) { await tab.refresh(); return; }
  await roomCommand(actor, { type: 'renewPresence', ...presence(actor) }); stats.http.renewals += 1;
}
async function serviceRpc(name) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return response.json();
}
function startDispatcher() {
  const tick = () => {
    if (stop || dispatchBusy) return;
    dispatchBusy = true;
    dispatchJob = dispatchJobs().catch(error => fail('dispatcher', error.code ?? 'DISPATCH_FAILED', error.status)).finally(() => { dispatchBusy = false; });
  };
  dispatchTimer = globalThis.setInterval(tick, 30000); tick();
}
async function dispatchJobs(signal) {
  assertNoExternalPump();
  const started = performance.now(); stats.http.requests += 1; stats.http.bytesOut += 2;
  const response = await fetch(`${base}/api/internal/jobs/dispatch`, { method: 'POST', headers: { Authorization: `Bearer ${jobsToken}`, 'Content-Type': 'application/json' }, body: '{}', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) });
  const text = await response.text(), elapsedMs = performance.now() - started; stats.http.bytesIn += Buffer.byteLength(text); stats.http.durationsMs.push(elapsedMs);
  const operation = 'jobs.dispatch'; operationMetrics[operation] ??= { values: [], errors: 0, timing: {} }; operationMetrics[operation].values.push(elapsedMs);
  if (!response.ok) { stats.http.errors += 1; operationMetrics[operation].errors += 1; throw Object.assign(new Error('DISPATCH_FAILED'), { code: 'DISPATCH_FAILED', status: response.status }); }
  const { data } = JSON.parse(text);
  // Dispatcher only returns numeric status counters/timestamps, never account/job payloads.
  const safe = Object.fromEntries(Object.entries(data).filter(([name, value]) => /^[a-zA-Z]+$/.test(name) && (typeof value === 'number' || value === null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))));
  stats.dispatcher.samples.push({ phase, at: new Date().toISOString(), elapsedMs, ...safe });
}
async function ownJobStatus(signal) {
  if (!actors.length) return { due: 0, failed: 0, future: 0 };
  const ids = actors.map(actor => actor.userId).join(','), rooms = allRooms.map(room => room.id).join(',');
  const rows = await restReadAll(`time_jobs?user_id=in.(${ids})&status=in.(pending,running,failed)&select=status,next_run_at`, signal);
  const account = await restReadAll(`room_account_jobs?user_id=in.(${ids})&status=in.(pending,running,failed)&select=status,next_run_at`, signal);
  const lifecycle = rooms ? await restReadAll(`room_jobs?room_id=in.(${rooms})&status=in.(pending,running,failed)&select=status,next_run_at`, signal) : [];
  const hints = rooms ? await restReadAll(`room_outbox?room_id=in.(${rooms})&pending=eq.true&select=attempts,next_run_at`, signal) : [];
  const now = Date.now();
  return { due: [...rows, ...account, ...lifecycle].filter(row => row.status !== 'failed' && Date.parse(row.next_run_at) <= now).length + hints.filter(row => row.attempts < 5 && Date.parse(row.next_run_at) <= now).length,
    failed: [...rows, ...account, ...lifecycle].filter(row => row.status === 'failed').length + hints.filter(row => row.attempts >= 5).length,
    future: [...rows, ...account, ...lifecycle, ...hints].filter(row => Date.parse(row.next_run_at) > now).length };
}
async function drainOwnJobs() {
  try {
    const deadline = performance.now() + 120000, signal = AbortSignal.timeout(120000); let batches = 0;
    for (; batches < 100 && performance.now() < deadline; batches += 1) {
      const state = await ownJobStatus(signal); stats.dispatcher.scopedFinal = state; stats.dispatcher.drain = { maxSeconds: 120, maxBatches: 100, batches };
      if (!state.due) { if (state.failed) fail('dispatcher', 'OWN_FAILED_JOBS_REMAIN'); return; }
      await dispatchJobs(signal);
    }
    stats.dispatcher.scopedFinal = await ownJobStatus(signal);
    if (stats.dispatcher.scopedFinal.due || stats.dispatcher.scopedFinal.failed) fail('dispatcher', 'OWN_DUE_JOBS_NOT_DRAINED');
  } catch (error) { fail('dispatcher-cleanup', error.code ?? 'JOB_DRAIN_FAILED', error.status); }
}
async function restReadAll(path, signal) {
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await restRead(`${path}&offset=${offset}&limit=100`, signal); rows.push(...page);
    if (page.length < 100) return rows;
  }
  throw Object.assign(new Error('JOB_INVENTORY_BOUND_EXCEEDED'), { code: 'JOB_INVENTORY_BOUND_EXCEEDED' });
}
async function restRead(path, signal) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return response.json();
}
async function ledgerProbe() {
  const ids = actors.map(actor => actor.userId).join(',');
  const sessions = await restRead(`time_sessions?user_id=in.(${ids})&status=in.(running,paused,needsReview)&select=id,user_id,mode`);
  const counts = new Map(); for (const session of sessions) counts.set(session.user_id, (counts.get(session.user_id) ?? 0) + 1);
  const duplicates = [...counts.values()].filter(count => count > 1).length;
  const intervals = await restRead(`time_intervals?user_id=in.(${ids})&end_at=is.null&select=id,user_id`);
  const openCounts = new Map(); for (const interval of intervals) openCounts.set(interval.user_id, (openCounts.get(interval.user_id) ?? 0) + 1);
  const multipleOpen = [...openCounts.values()].filter(count => count > 1).length;
  stats.ledgerProbes.push({ at: new Date().toISOString(), phase, activeSessions: sessions.length, openIntervals: intervals.length, duplicateActiveAccounts: duplicates, multipleOpenAccounts: multipleOpen });
  if (duplicates || multipleOpen) fail('ledger', 'DUPLICATE_ACTIVE_LEDGER');
}
function workerResources() {
  const result = [], now = performance.now();
  for (const pid of readdirSync('/proc').filter(value => /^\d+$/.test(value))) {
    try {
      const executable = readlinkSync(`/proc/${pid}/exe`), cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (!executable.endsWith('/workerd') || !(cwd === buildRoot || cwd.startsWith(`${buildRoot}/`))) continue;
      const raw = readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(fields[11]) + Number(fields[12]), previous = cpuSamples.get(pid);
      const rssKB = Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
      const swapKB = Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmSwap:\s+(\d+)/m)?.[1] ?? 0);
      result.push({ pid: Number(pid), swapKB, cpuPercentSinceLastSample: previous ? 100 * (ticks - previous.ticks) / clockTicks / ((now - previous.at) / 1000) : null, rssKB });
      cpuSamples.set(pid, { ticks, at: now });
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return result;
}
function capacityGuard() {
  const disk = statfsSync(resolve('.')), freeBytes = disk.bavail * disk.bsize;
  const memAvailableKB = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? 0);
  if (freeBytes < 64 * 1024 * 1024) throw Object.assign(new Error('DISK_RESERVE_TOO_LOW'), { code: 'DISK_RESERVE_TOO_LOW' });
  if (memAvailableKB && memAvailableKB < 256 * 1024) throw Object.assign(new Error('MEMORY_RESERVE_TOO_LOW'), { code: 'MEMORY_RESERVE_TOO_LOW' });
  return { sourceFilesystemFreeBytes: freeBytes, memAvailableKB };
}
async function databaseCounter(stage) {
  const { stdout } = await execAsync('docker', ['exec', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
    `SELECT json_build_object('databaseOid',datid,'deadlocks',deadlocks,'statsReset',stats_reset,'serverStartedAt',pg_postmaster_start_time()) FROM pg_stat_database WHERE datname=current_database();`], { encoding: 'utf8', timeout: 10000 });
  return { stage, at: new Date().toISOString(), ...JSON.parse(stdout.trim()) };
}
function databaseDelta(before, after) {
  if (before.databaseOid !== after.databaseOid || before.statsReset !== after.statsReset || before.serverStartedAt !== after.serverStartedAt || after.deadlocks < before.deadlocks) {
    fail('database', 'DATABASE_COUNTER_RESET_OR_RESTART'); return null;
  }
  return after.deadlocks - before.deadlocks;
}
async function databaseWindow(before, stage) {
  try {
    const after = await databaseCounter(`${stage}:after`);
    stats.databaseDiagnostics.windows.push({ stage, before, after, observedDeadlocks: databaseDelta(before, after) });
  } catch { fail('database', 'DATABASE_COUNTER_UNAVAILABLE'); }
}
async function finalizeDatabaseDiagnostics() {
  try {
    // PostgreSQL backend statistics can flush after the transaction has completed.
    for (let index = 0; index < 2; index += 1) {
      await delay(1100);
      stats.databaseDiagnostics.finalFlushSamples.push(await databaseCounter(`final-flush-${index + 1}`));
    }
    const last = stats.databaseDiagnostics.finalFlushSamples.at(-1);
    stats.databaseDiagnostics.final = last;
    if (!stats.databaseDiagnostics.baseline) { fail('database', 'DATABASE_BASELINE_MISSING'); return; }
    const delta = databaseDelta(stats.databaseDiagnostics.baseline, last);
    stats.databaseDiagnostics.observedDeadlocks = delta;
    if (delta > 0) fail('database', 'DATABASE_DEADLOCKS_OBSERVED');
  } catch { fail('database', 'DATABASE_COUNTER_UNAVAILABLE'); }
}
async function resources() {
  const capacity = capacityGuard();
  const { stdout } = await execAsync('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containers], { encoding: 'utf8', timeout: 10000 });
  const rows = stdout.trim().split('\n').map(line => JSON.parse(line));
  const { stdout: dbOutput } = await execAsync('docker', ['exec', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', `SELECT json_build_object('maxConnections',current_setting('max_connections')::int,'superuserReserved',current_setting('superuser_reserved_connections')::int,'clientBackends',count(*) FILTER(WHERE backend_type='client backend'),'activeClients',count(*) FILTER(WHERE backend_type='client backend' AND state='active'),'waitingActiveClients',count(*) FILTER(WHERE backend_type='client backend' AND state='active' AND wait_event_type IS NOT NULL),'includesThisProbe',true,'deadlocks',(SELECT deadlocks FROM pg_stat_database WHERE datname=current_database())) FROM pg_stat_activity;`], { encoding: 'utf8', timeout: 10000 });
  stats.resources.push({ database: JSON.parse(dbOutput.trim()), at: new Date().toISOString(), phase, generator: { ...process.resourceUsage(), currentMemoryBytes: process.memoryUsage() }, memoryPressure: readFileSync('/proc/pressure/memory', 'utf8').trim(), ioPressure: readFileSync('/proc/pressure/io', 'utf8').trim(), workers: workerResources(), ...capacity,
    containers: rows.map(row => ({ name: row.Name, cpu: row.CPUPerc, memory: row.MemUsage, memoryPercent: row.MemPerc, network: row.NetIO, processes: row.PIDs })) });
}
function pumpClients(now, allowRoundActions = true, allowIntentPulses = true) {
for (const event of expectedHints) if (!event.closed && !event.timeout && event.expected.size && now - event.created > 10000) expireExpectedHint(event, 'EXPECTED_HINT_NOT_RECEIVED_WITHIN_10S');
    for (const actor of actors) if (allowRoundActions && !actor.busy && now >= actor.nextJoinAttempt && joinEligible(actor)) schedule(actor, () => explicitJoinRound(actor), 'round-boundary-join');
    for (const actor of actors) if (now >= actor.nextHeartbeat) {
      actor.nextHeartbeat = now + 30000;
      if (!actor.busy) schedule(actor, () => heartbeat(actor), 'presence');
    }
    for (const room of activeRooms) if (allowIntentPulses && now >= room.nextPulse && !room.owner.busy) {
      room.nextPulse = now + 120000; room.pulse += 1;
      schedule(room.owner, () => roomCommand(room.owner, { type: 'setIntent', ...presence(room.owner), intent: room.pulse % 2 ? 'reading' : 'practice' }), 'intent-pulse');
    }
    for (const conn of connections) {
      if (conn.secondary && now >= conn.nextSecondaryPoll) {
        conn.nextSecondaryPoll = now + 30000;
        conn.secondaryJob = (conn.ui.live() ? conn.ui.refreshKnown('secondary-poll') : conn.ui.refresh('secondary-poll'))
          .catch(error => fail('secondary-poll', error.code ?? 'SECONDARY_POLL_FAILED', error.status));
      }
      if (conn.clock && conn.ui.live()) {
        const clockNow = conn.clock.serverMs + now - conn.clock.monotonic;
        const current = projectedPhase(conn.run, clockNow);
        if (current.key !== conn.phaseKey) {
          conn.phaseBoundaryServerMs = conn.phaseEndsAt ?? clockNow;
          conn.phaseKey = current.key; conn.phaseBoundary = conn.clock.monotonic + conn.phaseBoundaryServerMs - conn.clock.serverMs;
          conn.phaseEndsAt = current.end;
          boundaryDiagnostics.event(boundaryConnectionKey(conn), { type: 'virtual-phase-detected', expectedBoundaryMs: conn.phaseBoundaryServerMs,
            anchorServerMs: conn.clock.serverMs, anchorMonotonicMs: conn.clock.monotonic,
            anchorAgeMs: now - conn.clock.monotonic, anchorRevision: conn.ui.me?.revision, phaseKey: current.key });
        }
      }
      if (conn.faultUntil > 0 && now >= conn.faultUntil && !conn.refreshing && connections.filter(item => item.refreshing).length < 10) {
        conn.faultUntil = -1; conn.refreshing = true; stats.realtime.reconnects += 1;
        conn.job = connect(conn).catch(error => grantFailed(conn, error, 'reconnect')).finally(() => { conn.refreshing = false; conn.faultUntil = 0; });
      } else if (!conn.faultUntil && !conn.refreshing && !conn.grantDenied && now >= conn.nextGrantAt) {
        conn.refreshing = true;
        conn.job = grant(conn).then(async value => {
          if (conn.status === 'CLOSED' || !conn.client) await connect(conn, value);
          else await conn.client.setAuth(value.token);
          stats.realtime.grantRefreshes += 1;
        }).catch(error => grantFailed(conn, error, 'grant-refresh')).finally(() => { conn.refreshing = false; });
      }

    }
}
function trafficCounters() { return { httpRequests: stats.http.requests, httpBytesIn: stats.http.bytesIn, httpBytesOut: stats.http.bytesOut, wireFramesIn: stats.realtime.wireFramesIn, wireFramesOut: stats.realtime.wireFramesOut, wireBytesIn: stats.realtime.wireBytesIn, wireBytesOut: stats.realtime.wireBytesOut, deliveredHints: stats.realtime.deliveredHints, distinctReceivedRoomVersions: hintVersions.size }; }
async function runPhase(name, seconds) {
  phase = name; measuring = true; phaseStart = performance.now();
  const dbBefore = await databaseCounter(`${name}:before`);
  const record = { name, startedAt: new Date().toISOString(), requestedSeconds: seconds, rooms: activeRooms.length, membershipsPerRoom: activeRooms[0].actors.length,
    minTransports: 100, minAuthorized: 100, secondsAt100Transports: 0, secondsAt100Authorized: 0, expectedDeficitSeconds: 0, plannedFault: null, countersAtStart: trafficCounters() };
  stats.phases.push(record);
  for (const room of activeRooms) room.nextPulse = performance.now() + (probe ? Math.min(30000, seconds * 1000 / 3) : 120000);
  let lastSample = performance.now(), nextSample = lastSample, nextProbe = lastSample, nextResources = lastSample, faultDone = false;
  while (!stop && performance.now() - phaseStart < seconds * 1000) {
    const now = performance.now(), elapsed = (now - phaseStart) / 1000;
    pumpClients(now);
    // A labeled real transport disconnect; HTTP presence continues, so no fictional lost time or seat.
    if (name === 'varied' && !faultDone && elapsed > Math.min(60, seconds / 3)) {
      faultDone = true; const targets = [...connections];
      record.plannedFault = { type: 'all-100-transports-disconnected-and-reconnected-in-batches-of-10', durationSeconds: 15, elapsedSeconds: Math.round(elapsed), httpPresenceContinues: true };
      for (const conn of targets) conn.faultUntil = now + 15000;
      await pool(targets, 10, disconnect);
    }
    if (now >= nextSample) {
      const dt = (now - lastSample) / 1000; lastSample = now; nextSample = now + 1000;
      const authorized = connections.filter(conn => conn.status === 'SUBSCRIBED').length, expected = connections.filter(conn => !conn.faultUntil).length;
      totalConnectionSeconds += aliveSockets.size * dt; authorizedConnectionSeconds += authorized * dt;
      record.minTransports = Math.min(record.minTransports, aliveSockets.size); record.minAuthorized = Math.min(record.minAuthorized, authorized);
      if (aliveSockets.size === 100) record.secondsAt100Transports += dt;
      if (authorized === 100) record.secondsAt100Authorized += dt;
      if (authorized < expected) record.expectedDeficitSeconds += dt;
      if (Math.floor(elapsed) % 10 === 0) stats.samples.push({ phase, elapsedSeconds: Math.round(elapsed), transportConnections: aliveSockets.size, authorizedSubscriptions: authorized, expectedAuthorized: expected });
    }
    if (now >= nextProbe) { capacityGuard(); nextProbe = now + 60000; await ledgerProbe(); save(); console.log(JSON.stringify({ phase, elapsedSeconds: Math.round(elapsed), connections: aliveSockets.size, authorized: connections.filter(conn => conn.status === 'SUBSCRIBED').length, failures: failureCount })); }
    if (now >= nextResources) { nextResources = now + 60000; await resources(); }
    await delay(200);
  }
  const opportunityEndedAt = Date.now();
  await Promise.allSettled(actors.map(actor => actor.job));
  await Promise.allSettled(connections.flatMap(conn => [conn.job, conn.snapshotJob, conn.secondaryJob]));
  await dispatchJob;
  await drainConnections();
  await drainExpectedHints();
  for (const room of activeRooms) for (let round = 1; round <= 4; round++) {
    const startsAt = Date.parse(room.run.startedAt) + (round - 1) * 1800000;
    if (opportunityEndedAt - startsAt < 5000) continue;
    const accepted = room.actors.filter(actor => actor.acceptedRounds.has(`${room.run.id}:${round}`)).length;
    stats.roundParticipation.push({ phase: name, roomIndex: allRooms.indexOf(room), round, expected: room.actors.length, accepted, minimumOpportunitySeconds: 5 });
    if (!stop && accepted !== room.actors.length) fail('participation', 'DECLARED_ROUND_CHOICES_MISSING');
  }
  record.finalTransportConnections = aliveSockets.size; record.finalAuthorizedSubscriptions = connections.filter(conn => conn.status === 'SUBSCRIBED').length;
  record.outstandingFaults = connections.filter(conn => conn.faultUntil || conn.refreshing).length;
  if (!stop && (record.finalTransportConnections !== 100 || record.finalAuthorizedSubscriptions !== 100 || record.outstandingFaults)) fail('connections', 'FINAL_CONNECTION_STATE_INCOMPLETE');
  record.actualSeconds = (performance.now() - phaseStart) / 1000; record.endedAt = new Date().toISOString();
  record.traffic = Object.fromEntries(Object.entries(trafficCounters()).map(([key, value]) => [key, value - record.countersAtStart[key]]));
  delete record.countersAtStart;
  record.observedHintDeliveriesPerHour = record.traffic.deliveredHints / record.actualSeconds * 3600;
  record.usageScenario = { assumption: 'Declared current-UI foreground-room cohort repeated30days; not actual user demand or hosted billing', at2HoursPerDay: { applicationHintDeliveries: record.observedHintDeliveriesPerHour * 60, apiRequests: record.traffic.httpRequests / record.actualSeconds * 3600 * 60 }, at6HoursPerDay: { applicationHintDeliveries: record.observedHintDeliveriesPerHour * 180, apiRequests: record.traffic.httpRequests / record.actualSeconds * 3600 * 180 }, excludes: 'HTML/assets, cookie-auth shell startup, other routes/users, provider-specific message accounting and unseen publisher retries' };
  if (!stop && record.expectedDeficitSeconds > 5) fail('connections', 'UNPLANNED_AUTHORIZED_CONNECTION_DEFICIT');
  await databaseWindow(dbBefore, name);
  measuring = false; save();
}
async function drainConnections() {
  const deadline = performance.now() + 30000;
  while (!stop && performance.now() < deadline) {
    if (connections.length === 100 && aliveSockets.size === 100 && connections.every(conn => conn.status === 'SUBSCRIBED' && !conn.faultUntil && !conn.refreshing)) return;
    for (const conn of connections) {
      if (conn.refreshing || (conn.faultUntil > 0 && performance.now() < conn.faultUntil) || (conn.status === 'SUBSCRIBED' && !conn.faultUntil) || connections.filter(item => item.refreshing).length >= 10) continue;
      conn.refreshing = true; conn.faultUntil = -1;
      conn.job = disconnect(conn).then(() => connect(conn)).catch(error => fail('final-reconnect', error.code ?? 'FINAL_RECONNECT_FAILED', error.status))
        .finally(() => { conn.refreshing = false; conn.faultUntil = 0; });
    }
    await delay(100);
  }
  if (!stop) fail('connections', 'FINAL_100_AUTHORIZED_CONNECTIONS_NOT_RESTORED');
  await Promise.allSettled(connections.map(conn => conn.job));
}
async function drainExpectedHints() {
  const deadline = performance.now() + 10000;
  while (!stop && expectedHints.some(event => !event.closed && event.expected.size) && performance.now() < deadline) await delay(100);
  for (const event of expectedHints) if (!stop && !event.closed && event.expected.size) {
    expireExpectedHint(event, 'FINAL_EXPECTED_HINT_DELIVERY_MISSING', 'final-drain'); event.closed = true;
  }
}
async function releaseDistribution() {
  for (const conn of connections) { conn.desired = false; conn.ui.close(); boundaryDiagnostics.close(boundaryConnectionKey(conn)); }
  await Promise.allSettled(connections.map(conn => conn.ui.settle()));
  await pool(connections, 10, disconnect); connections.length = 0;
  await pool(actors, 5, async actor => {
    await loadActor(actor, actor.room?.id);
    if (actor.me.membership) await roomCommand(actor, { type: 'leave', ...presence(actor), expectedTimeRevision: actor.time.revision,
      fromSessionId: actor.time.active?.id ?? null, timeControlVersion: actor.time.active?.controlVersion ?? null });
    else if (actor.time.active) {
      const active = actor.time.active, interval = actor.time.intervals.find(item => item.sessionId === active.id && item.endAt === null);
      const result = await api(actor, 'time', 'POST', { type: 'finish', operationId: randomUUID(), expectedRevision: actor.time.revision,
        sessionId: active.id, deviceId: actor.deviceId, controlVersion: active.controlVersion, intervalId: interval?.id ?? null }); actor.time = result.data;
    }
    actor.joinedRound = null;
  });
}
async function cleanup() {
  measuring = false;
  await Promise.allSettled(actors.map(actor => actor.job));
  await Promise.allSettled(connections.flatMap(conn => [conn.job, conn.snapshotJob, conn.secondaryJob]));
  for (const conn of connections) { conn.desired = false; conn.ui.close(); boundaryDiagnostics.close(boundaryConnectionKey(conn)); }
  await Promise.allSettled(connections.map(conn => conn.ui.settle()));
  await pool(connections, 10, conn => disconnect(conn).catch(() => { stats.cleanup.push({ type: 'transport', status: 'failed' }); }));
  await pool(actors, 5, async actor => {
    try {
      if (!actor.me) { stats.cleanup.push({ type: 'account', index: actor.index, status: 'no-membership-created' }); return; }
      await loadActor(actor, actor.room?.id);
      if (actor.me.membership) await roomCommand(actor, { type: 'leave', ...presence(actor), expectedTimeRevision: actor.time.revision,
        fromSessionId: actor.time.active?.id ?? null, timeControlVersion: actor.time.active?.controlVersion ?? null });
      else if (actor.time.active?.status !== 'needsReview' && actor.time.active) {
        const active = actor.time.active, interval = actor.time.intervals.find(item => item.sessionId === active.id && item.endAt === null);
        await api(actor, 'time', 'POST', { type: 'finish', operationId: randomUUID(), expectedRevision: actor.time.revision, sessionId: active.id,
          deviceId: actor.deviceId, controlVersion: active.controlVersion, intervalId: interval?.id ?? null });
      }
      stats.cleanup.push({ type: 'account', index: actor.index, status: 'released' });
    } catch (error) { stats.cleanup.push({ type: 'account', index: actor.index, status: 'failed', code: error.code ?? 'CLEANUP_FAILED' }); }
  });
  for (const room of allRooms) {
    try {
      await loadActor(room.owner, room.id); const current = (await api(null, `rooms/${room.id}`)).data;
      if (current.status === 'open') await roomCommand(room.owner, { type: 'close', roomId: room.id, roomVersion: current.version });
      stats.cleanup.push({ type: 'room', status: 'closed-to-new-joins' });
    } catch (error) { stats.cleanup.push({ type: 'room', status: 'failed', code: error.code ?? 'CLEANUP_FAILED' }); }
  }
}
try {
  stats.dispatcher.baseline = { ...(await serviceRpc('time_job_status')), ...(await serviceRpc('room_job_status')) };
  stats.capacityPolicy = { minSourceFilesystemFreeBytes: 64 * 1024 * 1024, minHostMemAvailableKB: 256 * 1024, initial: capacityGuard() };
  await delay(1100);
  stats.databaseDiagnostics.baseline = await databaseCounter('run:before');
  startDispatcher();
  console.log(JSON.stringify({ mode: stats.mode, requestedSeconds: duration, variedSeconds: variedDuration, artifact: output }));
  // Tenant config is read-only evidence, not a claim about hosted free-tier limits.
  stats.localRealtimeTenant = JSON.parse(execFileSync('docker', ['exec', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
    `SELECT json_build_object('maxConcurrentUsers',max_concurrent_users,'maxChannelsPerClient',max_channels_per_client,'maxEventsPerSecond',max_events_per_second) FROM _realtime.tenants WHERE external_id='realtime-dev';`], { encoding: 'utf8' }).trim());
  checkpoint('before-account-bootstrap');
  await pool(Array.from({ length: 80 }, (_, i) => i), 5, async index => { capacityGuard(); if (!stop) await createActor(index); }); actors.sort((a, b) => a.index - b.index);
  checkpoint('after-account-bootstrap');
  if (!stop) { await setupDistribution(4); await runPhase('steady-4x20', duration); }
  if (!stop) { phase = 'redistribution'; await releaseDistribution(); await setupDistribution(8); await runPhase('varied', variedDuration); }
  if (!stop) {
    for (const operation of ['rooms.join', 'rooms.startRun', 'rooms.joinRound']) {
      if (percentile(operationMetrics[operation]?.values ?? [], .95) > 2000) fail('latency', `${operation}_P95_EXCEEDS_2S`);
      if ((operationMetrics[operation]?.timing.total?.length ?? 0) !== (operationMetrics[operation]?.values.length ?? 0)) fail('diagnostics', `${operation}_LOCAL_TIMING_MISSING`);
    }
    // Keep distributions separate: a fast window must not conceal a slow one.
    // Empty groups have no percentile and are not applicable, never zero latency.
    for (const [group, operations] of Object.entries(operationGroups)) for (const operation of ['rooms.join', 'rooms.startRun', 'rooms.joinRound']) {
      const values = operations[operation]?.values ?? [];
      if (values.length && percentile(values, .95) > 2000) fail('latency', `${group}.${operation}_P95_EXCEEDS_2S`);
    }
    if (stats.phaseAgreementMs.some(value => value > 2000)) fail('phase-agreement', 'PHASE_AGREEMENT_EXCEEDS_2S');
    if (!probe && stats.phaseAgreementMs.length < 600) fail('phase-agreement', 'INSUFFICIENT_REAL_BOUNDARY_COVERAGE');
    if (!probe && stats.http.authRefreshes < 80) fail('auth', 'INSUFFICIENT_REAL_EXPIRY_REFRESH_COVERAGE');
    phase = 'done';
  }
} catch (error) { fail('runner', error.code ?? 'RUNNER_FAILED', error.status); phase = 'failed'; }
finally { if (dispatchTimer) globalThis.clearInterval(dispatchTimer); const resultPhase = phase; phase = 'cleanup'; await dispatchJob; await cleanup(); await drainOwnJobs(); await finalizeDatabaseDiagnostics(); phase = resultPhase; save(true); }
console.log(JSON.stringify({ artifact: output, mode: stats.mode, completed: phase === 'done' && !interrupted, failures: failureCount, acceptanceEligible: summary(true).acceptanceEligible, credentialsPrinted: false }));
if (failureCount || stats.http.errors || interrupted || stats.cleanup.some(item => item.status === 'failed')) process.exitCode = 1;
