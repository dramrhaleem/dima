import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { AccountData, RoomCommand, RoomCommandResponse, RoomMe, PublicRoom, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { ageSyntheticRoomRun } from '../helpers/room-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
type Input<C = RoomCommand> = C extends RoomCommand ? Omit<C, 'operationId' | 'expectedRevision'> : never;
type Row = { tab: string; phase: string; method: string; kind: string; atMs: number; status: number | 'failed' | null };
test.setTimeout(240000);

async function account(context: BrowserContext, displayName: string) {
  const email = `b5-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/rooms' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/rooms' } })).status()).toBe(200);
  const data = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': data.accountId }, data: { displayName, timezone: 'UTC', intent: 'work', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: data.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  return data.accountId;
}
async function me(context: BrowserContext): Promise<RoomMe> {
  return (await (await context.request.get(`${base}/api/v1/rooms/me`)).json()).data;
}
async function time(context: BrowserContext): Promise<TimeData> {
  return (await (await context.request.get(`${base}/api/v1/time?limit=1`)).json()).data;
}
async function room(context: BrowserContext, id: string): Promise<PublicRoom> {
  return (await (await context.request.get(`${base}/api/v1/rooms/${id}`)).json()).data;
}
async function act(context: BrowserContext, input: Input): Promise<RoomCommandResponse> {
  const own = await me(context);
  const response = await context.request.post(`${base}/api/v1/rooms`, { headers: { ...origin, 'X-Dima-Account-Id': own.accountId }, data: { ...input, expectedRevision: own.revision, operationId: randomUUID() } });
  expect(response.status()).toBe(200); return response.json();
}
function kind(request: Request) {
  const url = new URL(request.url()), path = url.pathname;
  if (!path.startsWith('/api/v1/')) return null;
  if (path === '/api/v1/rooms' && request.method() === 'POST') {
    const type: unknown = request.postDataJSON()?.type;
    const allowed = ['join', 'joinRound', 'renewPresence', 'takeControl', 'leave', 'startRun', 'setIntent'];
    return typeof type === 'string' && allowed.includes(type) ? `rooms.${type}` : 'rooms.command';
  }
  if (path === '/api/v1/rooms/me') return 'rooms.me';
  if (/\/rooms\/[^/]+\/snapshot$/.test(path)) return 'rooms.snapshot';
  if (/\/rooms\/[^/]+\/realtime$/.test(path)) return 'rooms.grant';
  if (/\/rooms\/[^/]+$/.test(path)) return 'rooms.public';
  if (path === '/api/v1/time' && request.method() === 'POST') return request.postDataJSON()?.type === 'renew' ? 'time.renew' : 'time.command';
  if (path === '/api/v1/time') return url.searchParams.has('sessionId') ? 'time.detail' : 'time.compact';
  if (path === '/api/v1/learning') return 'learning';
  if (path === '/api/v1/auth/session') return 'auth.session';
  if (path === '/api/v1/me') return 'account.me';
  return 'other-api';
}

test('sanitized foreground primary/secondary requests match the room workload profile', async ({ browser, page, context }, info) => {
  const host = await browser.newContext(); let secondaryContext: BrowserContext | undefined;
  const rows: Row[] = [], pending = new Set<Request>(), started = Date.now();
  let phase = 'bootstrap', lastNetwork = Date.now(), roomId = '', passed = false;
  let releaseSnapshot = () => {}; let hints = 0; const hintVersions = new Set<number>();
  const details: Record<string, unknown> = {};
  const output = `docs/evidence/B5_UI_WORKLOAD_TRACE_${randomUUID()}.json`;
  function observe(target: Page, tab: string) {
    const map = new Map<Request, Row>();
    target.on('request', request => {
      const requestKind = kind(request); if (!requestKind) return;
      const row: Row = { tab, phase, method: request.method(), kind: requestKind, atMs: Date.now() - started, status: null };
      rows.push(row); map.set(request, row); pending.add(request); lastNetwork = Date.now();
    });
    target.on('response', response => { const row = map.get(response.request()); if (row) row.status = response.status(); });
    const finished = (request: Request) => { if (pending.delete(request)) lastNetwork = Date.now(); };
    target.on('requestfinished', finished);
    target.on('requestfailed', request => { const row = map.get(request); if (row) row.status = 'failed'; finished(request); });
    if (tab === 'primary') target.on('websocket', socket => socket.on('framereceived', frame => {
      try {
        const value = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString());
        const event = Array.isArray(value) ? value[3] : value.event, payload = Array.isArray(value) ? value[4] : value.payload;
        if (event === 'broadcast' && payload?.event === 'invalidate') {
          hints++; if (Number.isSafeInteger(payload.payload?.version)) hintVersions.add(payload.payload.version);
        }
      } catch { /* Only the count of known invalidation frames is retained. */ }
    }));
  }
  async function quiet() { await expect.poll(() => pending.size === 0 && Date.now() - lastNetwork >= 500, { timeout: 20000, intervals: [100] }).toBe(true); }
  const selected = (name: string, tab?: string) => rows.filter(row => row.phase === name && (!tab || row.tab === tab));
  const count = (name: string, requestKind: string, tab?: string) => selected(name, tab).filter(row => row.kind === requestKind).length;
  function step(name: string) { phase = name; console.log(JSON.stringify({ workloadTracePhase: name })); }
  observe(page, 'primary');
  try {
    const hostId = await account(host, 'Trace host'); await account(context, 'Trace participant');
    const created = await act(host, { type: 'create', deviceId: randomUUID(), title: 'Functional request trace', description: 'Synthetic functional request verification only.', language: 'en', topic: 'Practice', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
    roomId = created.receipt.roomId!;
    await page.goto(`/app/rooms/${roomId}`);
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    await page.getByRole('button', { name: 'Enter room', exact: true }).click();
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    secondaryContext = await browser.newContext({ storageState: await context.storageState() });
    const secondary = await secondaryContext.newPage(); observe(secondary, 'secondary');
    await secondary.goto(`/app/rooms/${roomId}`);
    await expect(secondary.getByText('Live room updates connected', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    expect(await secondary.evaluate(() => document.visibilityState)).toBe('visible');
    await quiet();

    step('run-start');
    const own = (await me(host)).membership!;
    await act(host, { type: 'startRun', roomId, deviceId: own.deviceId, controlVersion: own.controlVersion, roomVersion: (await room(host, roomId)).version });
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    await expect(secondary.getByRole('button', { name: 'Join this focus round', exact: true })).toBeDisabled();
    await quiet();
    expect(count('run-start', 'learning', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('run-start', 'learning', 'secondary')).toBeGreaterThanOrEqual(1);

    step('join-click');
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    await expect(secondary.locator('.room-personal-column .focus-status')).toHaveText('Focusing'); await quiet();
    const joinRows = selected('join-click', 'primary'), joinIndex = joinRows.findIndex(row => row.kind === 'rooms.joinRound');
    expect(joinIndex).toBeGreaterThanOrEqual(0);
    expect(joinRows.slice(0, joinIndex).filter(row => ['time.compact', 'rooms.me'].includes(row.kind))).toHaveLength(0);
    expect(count('join-click', 'rooms.snapshot', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('join-click', 'time.compact', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('join-click', 'time.compact', 'secondary')).toBeGreaterThanOrEqual(1);

    step('heartbeat');
    await expect.poll(() => count('heartbeat', 'rooms.renewPresence', 'primary'), { timeout: 40000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => count('heartbeat', 'rooms.snapshot', 'secondary'), { timeout: 40000 }).toBeGreaterThanOrEqual(1);
    await quiet();
    expect(count('heartbeat', 'rooms.snapshot', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('heartbeat', 'rooms.snapshot', 'secondary')).toBeGreaterThanOrEqual(1);
    expect(count('heartbeat', 'time.renew')).toBe(0);
    expect(count('heartbeat', 'rooms.me', 'secondary')).toBe(0);

    step('held-hints');
    let ready = () => {}; const captured = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { releaseSnapshot = resolve; }); let held = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (held) { await route.continue(); return; }
      held = true; const response = await route.fetch(); expect(response.status()).toBe(200); ready();
      await gate; await route.fulfill({ response });
    });
    const beforeHints = hints;
    for (const intent of ['reading', 'practice', 'project'] as const) {
      const member = (await me(host)).membership!;
      const changed = await act(host, { type: 'setIntent', roomId, deviceId: member.deviceId, controlVersion: member.controlVersion, intent });
      if (intent === 'reading') await captured;
      await expect.poll(() => hintVersions.has(changed.data.room!.hintVersion), { timeout: 10000 }).toBe(true);
    }
    await expect.poll(() => hints, { timeout: 10000 }).toBeGreaterThanOrEqual(beforeHints + 3);
    expect(count('held-hints', 'rooms.me', 'primary')).toBe(0); expect(count('held-hints', 'rooms.snapshot', 'primary')).toBe(1);
    releaseSnapshot(); await quiet(); await page.unrouteAll({ behavior: 'wait' });
    expect(count('held-hints', 'rooms.me', 'primary')).toBe(0); expect(count('held-hints', 'rooms.snapshot', 'primary')).toBe(2);

    step('boundary-bootstrap');
    await ageSyntheticRoomRun(hostId, roomId, Math.floor((await room(host, roomId)).phase.secondsRemaining) - 15);
    await Promise.all([page.reload(), secondary.reload()]);
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    await expect(secondary.locator('.room-personal-column .focus-status')).toHaveText('Focusing'); await quiet();
    step('personal-boundary');
    await expect(page.getByRole('heading', { name: /Short break · round 1 of 4/ })).toBeVisible({ timeout: 22000 });
    await expect(secondary.getByRole('heading', { name: /Short break · round 1 of 4/ })).toBeVisible({ timeout: 22000 }); await quiet();
    expect(count('personal-boundary', 'time.compact', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('personal-boundary', 'time.compact', 'secondary')).toBeGreaterThanOrEqual(1);
    expect(count('personal-boundary', 'rooms.joinRound')).toBe(0);

    step('next-round-bootstrap');
    await ageSyntheticRoomRun(hostId, roomId, Math.floor((await room(host, roomId)).phase.secondsRemaining) - 15);
    await Promise.all([page.reload(), secondary.reload()]);
    await expect(page.getByRole('heading', { name: /Short break · round 1 of 4/ })).toBeVisible();
    await expect(secondary.getByRole('heading', { name: /Short break · round 1 of 4/ })).toBeVisible();
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    await expect(secondary.getByText('Live room updates connected', { exact: true })).toBeVisible(); await quiet();
    step('next-round');
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled({ timeout: 22000 });
    await expect(secondary.getByRole('heading', { name: /Focus · round 2 of 4/ })).toBeVisible({ timeout: 22000 }); await quiet();
    expect(count('next-round', 'learning', 'primary')).toBeGreaterThanOrEqual(1);
    expect(count('next-round', 'learning', 'secondary')).toBeGreaterThanOrEqual(1);
    expect(count('next-round', 'rooms.joinRound')).toBe(0);
    expect(count('next-round', 'auth.session')).toBe(0);
    expect(count('next-round', 'rooms.public')).toBe(0);

    step('grant-failure');
    let grantRequests = 0;
    await page.route(`**/api/v1/rooms/${roomId}/realtime`, async route => {
      if (++grantRequests === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }) });
      else await route.continue();
    });
    await page.reload(); await expect(page.locator('.room-members')).toContainText('Trace participant');
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible({ timeout: 40000 }); await quiet();
    const grants = selected('grant-failure', 'primary').filter(row => row.kind === 'rooms.grant');
    expect(grants).toHaveLength(2); expect(grants[0].status).toBe(503); expect(grants[1].status).toBe(200);
    details.grantRetryDelayMs = grants[1].atMs - grants[0].atMs; expect(Number(details.grantRetryDelayMs)).toBeGreaterThanOrEqual(29500);
    await page.unrouteAll({ behavior: 'wait' });

    step('accepted-join-snapshot-failure');
    let failedSnapshot = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (!failedSnapshot) { failedSnapshot = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }) }); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing'); await quiet();
    expect(count('accepted-join-snapshot-failure', 'rooms.joinRound', 'primary')).toBe(1);
    expect(selected('accepted-join-snapshot-failure', 'primary').some(row => row.kind === 'rooms.snapshot' && row.status === 503)).toBe(true);
    expect((await time(context)).active?.roundIndex).toBe(2);
    passed = true;
  } finally {
    releaseSnapshot(); await page.unrouteAll({ behavior: 'ignoreErrors' }); step('cleanup');
    try {
      if (roomId) {
        const own = await me(context), current = await time(context);
        if (own.membership?.status === 'active') await act(context, { type: 'leave', roomId, deviceId: own.membership.deviceId, controlVersion: own.membership.controlVersion, expectedTimeRevision: current.revision, fromSessionId: current.active?.id ?? null, timeControlVersion: current.active?.controlVersion ?? null });
        await act(host, { type: 'close', roomId, roomVersion: (await room(host, roomId)).version });
        details.cleanup = 'own member left and owner closed room';
      }
    } catch { passed = false; details.cleanup = 'failed'; }
    await quiet(); await page.close(); await secondaryContext?.close(); await host.close();
    const counts = Object.fromEntries([...new Set(rows.map(row => row.phase))].map(name => [name, Object.fromEntries(['primary', 'secondary'].map(tab => [tab, selected(name, tab).reduce<Record<string, number>>((result, row) => { result[`${row.method} ${row.kind} ${row.status}`] = (result[`${row.method} ${row.kind} ${row.status}`] ?? 0) + 1; return result; }, {})]))]));
    const evidence = { passed, functionalTraceOnly: true, syntheticRunAging: true, loadAcceptance: false, sanitized: 'method, fixed path kind, status, relative timing and counts only; no IDs, headers, credentials or payloads', details, counts, requests: rows };
    writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    await info.attach('sanitized-request-trace', { path: output, contentType: 'application/json' });
    console.log(JSON.stringify({ workloadTraceArtifact: output, passed }));
  }
  expect(passed).toBe(true);
});
