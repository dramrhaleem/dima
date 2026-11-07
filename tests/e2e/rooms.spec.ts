import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningData, PublicRoom, RoomCommand, RoomCommandResponse, RoomMe, RoomSnapshot, TimeData } from '../../packages/contracts/src/index';
import { ageSyntheticRoomRun, ageSyntheticRoomLease, republishSyntheticRoomHint } from '../helpers/room-fixture.mjs';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
type RoomInput<C = RoomCommand> = C extends RoomCommand ? Omit<C, 'expectedRevision' | 'operationId'> : never;
test.setTimeout(180000);

async function setup(context: BrowserContext, name = 'Morgan Rooms') {
  const email = `b5-${randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = Date.now();
    const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/rooms' } });
    if (sent.status() === 429 && attempt < 19) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status()).toBe(200);
    const token = await waitForLocalOtp(email, { after }).catch(reason => {
      if (!(reason instanceof Error) || reason.name !== 'TimeoutError') throw reason;
      return waitForLocalOtp(email, { after }); // One bounded retry of the same synthetic mail read; no new OTP request.
    });
    const verified = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/rooms' } });
    expect(verified.status()).toBe(200); break;
  }
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  const saved = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: name, timezone: 'Africa/Cairo', intent: 'work', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } });
  expect(saved.status()).toBe(200);
  return { accountId: account.accountId, email };
}
async function own(context: BrowserContext, roomId?: string): Promise<RoomMe> {
  const response = await context.request.get(`${base}/api/v1/rooms/me${roomId ? `?roomId=${roomId}` : ''}`);
  expect(response.status()).toBe(200); return (await response.json()).data;
}
async function time(context: BrowserContext): Promise<TimeData> {
  const response = await context.request.get(`${base}/api/v1/time`); expect(response.status()).toBe(200); return (await response.json()).data;
}
async function publicRoom(request: APIRequestContext, roomId: string): Promise<PublicRoom> {
  const response = await request.get(`${base}/api/v1/rooms/${roomId}`); expect(response.status()).toBe(200); return (await response.json()).data;
}
async function act(context: BrowserContext, action: RoomInput): Promise<RoomCommandResponse> {
  const state = await own(context);
  const response = await context.request.post(`${base}/api/v1/rooms`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: { ...action, expectedRevision: state.revision, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200); return response.json();
}
async function create(context: BrowserContext, title = `Quiet practice ${randomUUID().slice(0, 8)}`) {
  const response = await act(context, { type: 'create', deviceId: randomUUID(), title, description: 'A quiet place for useful practice.', language: 'en', topic: 'Practice', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
  return response.receipt.roomId!;
}
async function startRun(context: BrowserContext, roomId: string) {
  const state = await own(context); const room = await publicRoom(context.request, roomId);
  return act(context, { type: 'startRun', roomId, deviceId: state.membership!.deviceId, controlVersion: state.membership!.controlVersion, roomVersion: room.version });
}
async function join(page: Page, roomId: string, switching = false) {
  await page.goto(`/app/rooms/${roomId}`);
  await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
  if (switching) await page.getByRole('checkbox', { name: /Finish my current session and leave its room/ }).check();
  await page.getByRole('button', { name: switching ? 'Leave and join this room' : 'Enter room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'People in this room', exact: true })).toBeVisible();
}
async function capture(page: Page, name: string, width: number, height = 920, fullPage = true) {
  await page.setViewportSize({ width, height });
  await expect(page.locator('.rooms-root')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('.impeccable/review', { recursive: true });
  await page.screenshot({ path: `.impeccable/review/b5-${name}.png`, fullPage });
}

test('public room preserves auth destination, requires explicit visibility consent and starts no personal time on membership or host Start', async ({ browser, page, context }) => {
  const hostContext = await browser.newContext();
  try {
    await setup(hostContext, 'Host identity stays private');
    const roomId = await create(hostContext);
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByText('Host identity stays private', { exact: true })).toHaveCount(0);
    expect(JSON.stringify(await publicRoom(context.request, roomId))).not.toContain('Host identity stays private');
    await capture(page, 'public-desktop', 1280);
    await page.getByRole('link', { name: 'Sign in to join', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/app/rooms/${roomId}`);
    await setup(context, 'Guest room viewer');
    await page.reload();
    await expect(page).toHaveURL(`${base}/app/rooms/${roomId}`);
    await expect(page.getByRole('button', { name: 'Enter room', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).not.toBeChecked();
    expect((await own(context)).membership).toBeNull(); expect((await time(context)).active).toBeNull();
    await capture(page, 'consent-mobile', 375);
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    await page.getByRole('button', { name: 'Enter room', exact: true }).click();
    await expect(page.locator('.room-members')).toContainText('Host identity stays private');
    expect((await time(context)).sessions).toHaveLength(0);
    await startRun(hostContext, roomId);
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    expect((await time(context)).active).toBeNull(); expect((await time(hostContext)).active).toBeNull();
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    await expect(page.locator('.room-members li').filter({ hasText: 'Guest room viewer (you)' })).toContainText('Focusing');
    const session = (await time(context)).active!;
    expect(session.mode).toBe('room'); expect(session.roomId).toBe(roomId);
    await capture(page, 'focus-mobile', 375); await capture(page, 'focus-small', 320); await capture(page, 'focus-tablet', 768); await capture(page, 'focus-desktop', 1280);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('id', 'workspace-title');
    for (const width of [375, 320, 768]) {
      await capture(page, `focus-fold-${width}`, width, 812, false);
      const clock = await page.locator('.room-personal-column .focus-clock').boundingBox();
      const actions = await page.locator('.room-personal-column .focus-active > .focus-actions').boundingBox();
      const bottomNav = await page.locator('.workspace-mobile-nav').boundingBox();
      await expect(page.locator('.focus-session-strip')).toBeHidden();
      expect(clock!.y).toBeGreaterThanOrEqual(0);
      expect(clock!.y + clock!.height, `Personal clock above navigation at ${width}px`).toBeLessThanOrEqual(bottomNav!.y - 8);
      expect(actions!.y + actions!.height, `Primary actions above navigation at ${width}px`).toBeLessThanOrEqual(bottomNav!.y - 8);
    }
    await page.getByRole('link', { name: 'Back to rooms', exact: false }).click();
    await expect(page.getByRole('complementary', { name: 'Current focus session', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'View session', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    await page.locator('.room-personal-column').getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Paused');
    expect((await publicRoom(context.request, roomId)).phase.kind).toBe('focus');
    await page.locator('.room-personal-column').getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const resumed = await time(context); expect(resumed.active?.id).toBe(session.id); expect(resumed.intervals).toHaveLength(2);
    expect(new Set(resumed.intervals.map(value => Date.parse(value.boundaryAt))).size).toBe(1);
  } finally { await hostContext.close(); }
});

test('creation previews only public fields, keeps failed input, and owner can edit or close after leaving without seeing roster', async ({ page, context }) => {
  await setup(context, 'Room owner');
  const firstOwnRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/rooms/me' && response.status() === 200);
  await page.goto('/app/rooms');
  expect((await (await firstOwnRead).json()).data.membership).toBeNull();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'Study together.', exact: true })).toBeVisible();
  await page.locator('.rooms-intro').getByRole('link', { name: 'Create a room', exact: true }).click();
  await page.getByLabel('Room title', { exact: true }).fill('https://not-allowed.example');
  await page.getByLabel('Topic', { exact: true }).fill('Thoughtful work');
  await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
  await page.getByRole('button', { name: 'Preview public details', exact: true }).click();
  await page.getByRole('button', { name: 'Create and enter room', exact: true }).click();
  await expect(page.locator('.rooms-root').getByRole('alert')).toContainText('plain text');
  await expect(page.getByLabel('Room title', { exact: true })).toHaveValue('https://not-allowed.example');
  await page.getByLabel('Room title', { exact: true }).fill('A useful shared rhythm');
  await page.getByRole('button', { name: 'Preview public details', exact: true }).click();
  await capture(page, 'create-desktop', 1280);
  await page.getByRole('button', { name: 'Create and enter room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start shared cycle', exact: true })).toBeEnabled();
  const member = (await own(context)).membership!;
  expect((await time(context)).active).toBeNull(); expect((await publicRoom(context.request, member.roomId)).run).toBeNull();
  await page.locator('.room-exit-actions').getByRole('button', { name: 'Leave room', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.locator('.room-members')).toHaveCount(0);
  await page.getByText('Room options', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit details / next preset', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Room title', { exact: true }).fill('A clearer room title');
  await page.getByRole('button', { name: 'Save room details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clearer room title', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close new admissions', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await publicRoom(context.request, member.roomId)).status).toBe('closed');
});

test('room-to-solo switch keeps the existing ledger and performs no switch before explicit start', async ({ page, context }) => {
  await setup(context); const roomId = await create(context);
  await page.goto(`/app/rooms/${roomId}`);
  await page.getByRole('button', { name: 'Take room control on this tab', exact: true }).click();
  await page.getByRole('button', { name: 'Start shared cycle', exact: true }).click();
  await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
  await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
  const old = (await time(context)).active!;
  await page.getByRole('link', { name: 'Set up solo focus', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/focus?switch=solo`);
  await page.getByRole('radio', { name: 'Open focus', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Finish room focus and start solo', exact: true })).toBeDisabled();
  expect((await time(context)).active?.id).toBe(old.id);
  await page.getByRole('checkbox', { name: /Finish my current room focus and start this solo session/ }).check();
  await page.getByRole('button', { name: 'Finish room focus and start solo', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/focus`);
  await expect(page.locator('.focus-active .focus-status')).toHaveText('Focusing');
  const after = await time(context); expect(after.active?.mode).toBe('open'); expect(after.active?.id).not.toBe(old.id);
  const previous = after.intervals.find(value => value.sessionId === old.id)!;
  const next = after.intervals.find(value => value.sessionId === after.active!.id)!;
  expect(Date.parse(previous.endAt!)).toBe(Date.parse(next.startAt));
  expect((await own(context)).membership?.status).not.toBe('active');
});

test('an in-flight old-room snapshot cannot block or overwrite an atomic switch to a new room', async ({ browser, page, context }) => {
  const hostA = await browser.newContext(); const hostB = await browser.newContext();
  try {
    await setup(hostA, 'First room host'); const a = await create(hostA);
    await setup(hostB, 'Second room host'); const b = await create(hostB);
    await setup(context, 'Switching member'); await join(page, a);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let captured!: () => void; const ready = new Promise<void>(resolve => { captured = resolve; });
    let intercepted = false;
    await page.route(`**/api/v1/rooms/${a}/snapshot`, async route => {
      if (intercepted) { await route.continue(); return; }
      intercepted = true; const response = await route.fetch(); captured(); await held; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click(); await ready;
    await join(page, b, true);
    await expect(page.locator('.room-members')).toContainText('Second room host');
    expect((await own(context)).membership?.roomId).toBe(b);
    release(); await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('.room-members')).not.toContainText('First room host');
    expect((await context.request.get(`${base}/api/v1/rooms/${a}/snapshot`)).status()).toBe(403);
  } finally { await hostA.close(); await hostB.close(); }
});

test('a delayed pre-block snapshot cannot restore hidden identities after a newer permission snapshot', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  try {
    await setup(host, 'Identity to hide'); const roomId = await create(host);
    const startupReads = new Set<import('@playwright/test').Request>();
    let startupReadCount = 0; let lastStartupActivity = Date.now();
    const started = (request: import('@playwright/test').Request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && (path === '/api/v1/rooms/me' || path === `/api/v1/rooms/${roomId}/snapshot`)) {
        startupReads.add(request); startupReadCount++; lastStartupActivity = Date.now();
      }
    };
    const finished = (request: import('@playwright/test').Request) => { if (startupReads.delete(request)) lastStartupActivity = Date.now(); };
    page.on('request', started); page.on('requestfinished', finished); page.on('requestfailed', finished);
    await setup(context, 'Blocked viewer'); await join(page, roomId);
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    lastStartupActivity = Date.now();
    await expect.poll(() => startupReads.size === 0 && Date.now() - lastStartupActivity >= 300, { timeout: 15000 }).toBe(true);
    await test.info().attach('startup-read-settlement', { body: JSON.stringify({ startupReadCount, pending: startupReads.size, quietMs: Date.now() - lastStartupActivity }), contentType: 'application/json' });
    page.off('request', started); page.off('requestfinished', finished); page.off('requestfailed', finished);
    const viewer = (await own(context)).membership!;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let captured!: () => void; const ready = new Promise<void>(resolve => { captured = resolve; });
    let intercepted = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (intercepted) { await route.continue(); return; }
      intercepted = true; const response = await route.fetch(); captured(); await held; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click(); await ready;
    await act(host, { type: 'block', roomId, targetMembershipId: viewer.id });
    await expect(page.locator('.room-members')).toContainText('Blocked viewer');
    await expect(page.locator('.room-members')).not.toContainText('Identity to hide');
    release(); await page.unrouteAll({ behavior: 'wait' });
    await expect(page.locator('.room-members')).toContainText('Blocked viewer');
    await expect(page.locator('.room-members')).not.toContainText('Identity to hide');
    const response = await context.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`);
    const snapshot = (await response.json()).data as RoomSnapshot;
    expect(snapshot.participants.some(value => value.displayName === 'Identity to hide')).toBe(false);
  } finally { await host.close(); }
});

test('host transfer needs acceptance, host departure leaves run active, and reporting confirms submission only', async ({ browser, page, context }) => {
  const guestContext = await browser.newContext();
  try {
    await setup(context, 'Original host'); const roomId = await create(context);
    await page.goto(`/app/rooms/${roomId}`);
    await page.getByRole('button', { name: 'Take room control on this tab', exact: true }).click();
    await setup(guestContext, 'Volunteer host'); const guestPage = await guestContext.newPage();
    await join(guestPage, roomId);
    await expect(page.locator('.room-members')).toContainText('Volunteer host');
    const row = page.locator('.room-members li').filter({ hasText: 'Volunteer host' });
    await row.locator('summary').click(); await row.getByRole('button', { name: 'Offer moderation role', exact: true }).click();
    await page.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
    await expect(guestPage.getByRole('button', { name: 'Accept moderation role', exact: true })).toBeEnabled();
    expect((await own(context)).membership?.isHost).toBe(true);
    expect((await own(guestContext)).membership?.isHost).toBe(false);
    await guestPage.getByRole('button', { name: 'Accept moderation role', exact: true }).click();
    await expect(guestPage.getByRole('button', { name: 'Start shared cycle', exact: true })).toBeEnabled();
    expect((await own(context)).membership?.isHost).toBe(false);
    expect((await own(guestContext)).membership?.isOwner).toBe(false);
    await guestPage.getByRole('button', { name: 'Start shared cycle', exact: true }).click();
    await expect(guestPage.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    await guestPage.locator('.room-exit-actions').getByRole('button', { name: 'Leave room', exact: true }).click();
    await guestPage.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
    expect((await publicRoom(context.request, roomId)).run?.status).toBe('active');
    expect((await time(context)).active).toBeNull(); expect((await time(guestContext)).active).toBeNull();
    await page.getByText('Room options', { exact: true }).click();
    await page.getByRole('button', { name: 'Report room', exact: true }).click();
    await page.getByRole('dialog').getByRole('combobox', { name: 'Reason', exact: true }).selectOption('privacy');
    await page.getByRole('dialog').getByLabel('Additional details', { exact: false }).fill('Synthetic test report; no real participant allegation.');
    await page.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit report', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('submission, not a completed review');
    await capture(page, 'report-mobile', 375);
  } finally { await guestContext.close(); }
});

test('private course context stays out of room projections and finishing room time never completes its activity', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  try {
    await setup(host, 'Shared room host'); const roomId = await create(host);
    const identity = await setup(context, 'Private learner');
    let learning = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data as LearningData;
    const draftId = `private-${randomUUID()}`;
    const commands = [
      { type: 'saveDraft', draft: { id: draftId, title: 'Private curriculum marker', sourceUrl: 'https://example.com', courses: [{ id: 'course', title: 'Private curriculum marker', position: 0, modules: [{ id: 'module', title: 'Practice', position: 0, tasks: [{ id: 'practice', title: 'Private task marker', position: 0, kind: 'assignment', requirement: 'required', minutes: 30, estimateSource: 'user', sourceUrl: 'https://example.com/practice', prerequisiteIds: [] }] }] }] } },
      { type: 'enroll', offeringId: draftId, taskIds: ['practice'], priorTaskIds: [], targetDate: learning.localDay, estimates: {} },
    ];
    for (const command of commands) {
      const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': identity.accountId }, data: { ...command, expectedRevision: learning.state.revision, operationId: randomUUID() } });
      expect(response.status()).toBe(200); learning = (await response.json()).data;
    }
    const enrollment = learning.state.enrollments[0];
    await page.goto(`/app/courses/${enrollment.id}/people`);
    await expect(page.getByText(/Its title is not published to rooms/)).toBeVisible();
    await join(page, roomId); await startRun(host, roomId);
    await page.getByRole('radio', { name: 'Learning', exact: true }).check();
    await page.getByRole('combobox', { name: 'Private activity optional', exact: true }).selectOption(JSON.stringify([enrollment.id, 'practice']));
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    expect((await time(context)).active?.taskId).toBe('practice');
    const otherSnapshot = await host.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`);
    expect(otherSnapshot.status()).toBe(200);
    const otherBody = await otherSnapshot.text();
    expect(otherBody).not.toContain('Private curriculum marker'); expect(otherBody).not.toContain('Private task marker'); expect(otherBody).not.toContain(enrollment.id);
    expect(JSON.stringify(await publicRoom(context.request, roomId))).not.toContain('Private task marker');
    await page.locator('.room-personal-column').getByRole('button', { name: 'Finish session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What happened with your activity?', exact: true })).toBeVisible();
    learning = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data;
    expect(learning.state.enrollments[0].completions).toHaveLength(0); expect(learning.state.workEvents ?? []).toHaveLength(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.focus-root').getByRole('link', { name: 'Return to room', exact: true })).toHaveAttribute('href', `/app/rooms/${roomId}`);
    await page.getByRole('link', { name: 'Back to activity', exact: true }).click();
    await expect(page.locator('.focus-history-list')).toContainText('Room focus');

    // A late successful response must not pull the user away from a new route.
    await page.goto(`/app/rooms/${roomId}`);
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const secondSession = (await time(context)).active!.id;
    let releaseFinish!: () => void; let finishSeen!: () => void;
    const finishGate = new Promise<void>(resolve => { releaseFinish = resolve; });
    const finishRequest = new Promise<void>(resolve => { finishSeen = resolve; });
    await page.route('**/api/v1/time', async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON()?.type !== 'finish') { await route.continue(); return; }
      const response = await route.fetch(); expect(response.status()).toBe(200); finishSeen();
      await finishGate; await route.fulfill({ response }).catch(() => {});
    });
    try {
      await page.locator('.room-personal-column').getByRole('button', { name: 'Finish session', exact: true }).click();
      await finishRequest;
      await page.locator('.workspace-sidebar').getByRole('link', { name: 'Today', exact: true }).click();
      await expect(page).toHaveURL(`${base}/app/today`);
      const delivered = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/time');
      releaseFinish(); await (await delivered).finished();
      await expect(page.getByRole('complementary', { name: 'Saved focus session', exact: true }).getByRole('link', { name: 'View summary', exact: true })).toHaveAttribute('href', `/app/progress/activity/${secondSession}`);
      await expect(page).toHaveURL(`${base}/app/today`);
      expect((await time(context)).sessions.find(session => session.id === secondSession)?.status).toBe('finalized');
    } finally { releaseFinish(); await page.unrouteAll({ behavior: 'wait' }); }
  } finally { await host.close(); }
});

test('late room entry records only the remaining phase, settles at its boundary and never auto-joins the next round', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  try {
    const owner = await setup(host, 'Boundary host'); const roomId = await create(host); await startRun(host, roomId);
    await ageSyntheticRoomRun(owner.accountId, roomId, 18 * 60);
    await setup(context, 'Late participant'); await join(page, roomId);
    await page.getByRole('button', { name: 'Wait for next round', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toHaveCount(0);
    expect((await time(context)).active).toBeNull();
    await page.getByRole('button', { name: 'Show join option', exact: true }).click();
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const joined = await time(context); const sessionId = joined.active!.id;
    const accepted = joined.intervals.find(value => value.sessionId === sessionId)!;
    const available = (Date.parse(accepted.boundaryAt) - Date.parse(accepted.startAt)) / 1000;
    expect(available).toBeGreaterThan(360); expect(available).toBeLessThanOrEqual(420);
    await ageSyntheticRoomRun(owner.accountId, roomId, 7 * 60 + 3);
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Short break · round 1 of 4/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toHaveCount(0);
    const settled = await time(context); expect(settled.active).toBeNull(); expect(settled.sessions).toHaveLength(1);
    expect(settled.totals.eligibleSeconds).toBeGreaterThan(360); expect(settled.totals.eligibleSeconds).toBeLessThanOrEqual(420);
    expect(Date.parse(settled.intervals[0].endAt!)).toBe(Date.parse(settled.intervals[0].boundaryAt));
    await expect(page.locator('.room-personal-column .focus-active')).toHaveCount(0);
    await capture(page, 'break-mobile', 375);
    await ageSyntheticRoomRun(owner.accountId, roomId, 5 * 60 + 2);
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Focus · round 2 of 4/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    expect((await time(context)).active).toBeNull(); expect((await time(context)).sessions).toHaveLength(1);
  } finally { await host.close(); }
});

test('expired presence hides roster but preserves own accepted time, and rejoin never regains a transferred host role or duplicates the session', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  try {
    const owner = await setup(host, 'Original room owner'); const roomId = await create(host); await startRun(host, roomId);
    const guest = await setup(context, 'Returning participant'); await join(page, roomId);
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const acceptedId = (await time(context)).active!.id;
    await ageSyntheticRoomLease(owner.accountId, roomId, owner.accountId, 121);
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await page.getByText('Room moderation', { exact: true }).click();
    await page.getByRole('button', { name: 'Become room moderator', exact: true }).click();
    expect((await own(context)).membership?.isHost).toBe(true);
    await context.setOffline(true);
    await ageSyntheticRoomLease(owner.accountId, roomId, guest.accountId, 181);
    await context.setOffline(false); await page.reload();
    await expect(page.getByRole('heading', { name: 'Your seat was released.', exact: true })).toBeVisible();
    await expect(page.locator('.room-members')).toHaveCount(0);
    expect((await context.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`)).status()).toBe(403);
    expect((await time(context)).active?.id).toBe(acceptedId);
    let original = await own(host);
    await act(host, { type: 'renewPresence', roomId, deviceId: original.membership!.deviceId, controlVersion: original.membership!.controlVersion });
    original = await own(host);
    await act(host, { type: 'claimHost', roomId, deviceId: original.membership!.deviceId, controlVersion: original.membership!.controlVersion });
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    await page.getByRole('button', { name: 'Rejoin room', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People in this room', exact: true })).toBeVisible();
    expect((await own(context)).membership?.isHost).toBe(false);
    expect((await time(context)).active?.id).toBe(acceptedId); expect((await time(context)).sessions).toHaveLength(1);
  } finally { await host.close(); }
});

test('a full room does not reclaim an expired seat, while the accepted session can explicitly switch to solo', async ({ browser, page, context }) => {
  test.setTimeout(300000);
  const host = await browser.newContext(); const seats: BrowserContext[] = [];
  try {
    const owner = await setup(host, 'Capacity owner'); const roomId = await create(host); await startRun(host, roomId);
    const guest = await setup(context, 'Returning to a full room'); await join(page, roomId);
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const priorSessionId = (await time(context)).active!.id;
    await context.setOffline(true); await ageSyntheticRoomLease(owner.accountId, roomId, guest.accountId, 181);
    await own(context); // APIRequestContext is independent of the page's offline emulation.
    for (let index = 0; index < 19; index++) {
      const seat = await browser.newContext(); seats.push(seat); await setup(seat, `Seat member ${index + 1}`);
      await act(seat, { type: 'join', roomId, deviceId: randomUUID(), acknowledgeVisibility: true, visibilityVersion: 1 });
    }
    expect((await publicRoom(host.request, roomId)).reservedCount).toBe(20);
    await context.setOffline(false); await page.reload();
    await expect(page.getByRole('button', { name: 'Room full', exact: true })).toBeDisabled();
    await expect(page.locator('.room-members')).toHaveCount(0);
    expect((await time(context)).active?.id).toBe(priorSessionId);
    await capture(page, 'full-mobile', 375);
    await page.getByRole('link', { name: 'Finish and start solo', exact: true }).click();
    const takeControl = page.locator('.focus-session-strip').getByRole('button', { name: 'Take control on this tab', exact: true });
    if (await takeControl.isVisible()) await takeControl.click();
    await page.getByRole('radio', { name: 'Open focus', exact: true }).check();
    await page.getByRole('checkbox', { name: /Finish my current room focus and start this solo session/ }).check();
    await page.getByRole('button', { name: 'Finish room focus and start solo', exact: true }).click();
    await expect(page).toHaveURL(`${base}/app/focus`);
    const after = await time(context); expect(after.active?.mode).toBe('open');
    expect(after.intervals.some(value => value.sessionId === priorSessionId && value.endAt)).toBe(true);
    expect((await own(context)).membership?.status).not.toBe('active');
    expect((await publicRoom(host.request, roomId)).reservedCount).toBe(20);
  } finally { await host.close(); for (const seat of seats) await seat.close(); }
});

test('room takeover shares the one time ledger, and an offline stop reconciles only its interval before explicit same-round re-entry', async ({ browser, page, context }) => {
  await setup(context); const roomId = await create(context);
  await page.goto(`/app/rooms/${roomId}`);
  await page.getByRole('button', { name: 'Take room control on this tab', exact: true }).click();
  await page.getByRole('button', { name: 'Start shared cycle', exact: true }).click();
  await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
  await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
  const before = await time(context); const previousPresence = (await own(context)).membership!;
  const second = await context.newPage(); const peer = await browser.newContext();
  try {
    await setup(peer, 'Pending stop peer');
    await act(peer, { type: 'join', roomId, deviceId: randomUUID(), acknowledgeVisibility: true, visibilityVersion: 1 });
    await second.goto(`/app/rooms/${roomId}`);
    await second.getByRole('button', { name: 'Take room control on this tab', exact: true }).click();
    await expect(second.locator('.focus-active').getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    const controlled = await time(context); const latestPresence = await own(context);
    expect(controlled.active?.id).toBe(before.active!.id);
    expect(controlled.active?.controlVersion).toBe(latestPresence.membership!.controlVersion);
    expect(controlled.active?.controlVersion).toBeGreaterThan(before.active!.controlVersion);
    const currentInterval = controlled.intervals.find(value => value.endAt === null)!;
    const earlier = controlled.intervals.find(value => value.id !== currentInterval.id)!;
    expect(Date.parse(earlier.endAt!)).toBe(Date.parse(currentInterval.startAt));
    const stale = await context.request.post(`${base}/api/v1/rooms`, { headers: { ...origin, 'X-Dima-Account-Id': latestPresence.accountId }, data: { type: 'setIntent', roomId, deviceId: previousPresence.deviceId, controlVersion: previousPresence.controlVersion, intent: 'reading', expectedRevision: latestPresence.revision, operationId: randomUUID() } });
    expect(stale.status()).toBe(409); expect((await stale.json()).error.code).toBe('CONTROL_LOST');
    await expect(page.getByRole('button', { name: 'Take room control on this tab', exact: true })).toBeEnabled();
    await second.waitForTimeout(1200);
    await context.setOffline(true);
    await second.locator('.focus-active').getByRole('button', { name: 'Stop on this device', exact: true }).click();
    await expect(second.getByText('Saved on this device. Waiting to sync with your account.', { exact: true })).toBeVisible();
    const stopped = await second.locator('.focus-active [role=timer]').textContent();
    await second.waitForTimeout(1200);
    await expect(second.locator('.focus-active [role=timer]')).toHaveText(stopped!);
    await capture(second, 'offline-mobile', 375);
    await context.setOffline(false); await second.reload();
    await expect(second.getByRole('button', { name: 'Sync personal stop', exact: true })).toBeVisible();
    await second.getByText('Room options', { exact: true }).click();
    await second.getByRole('button', { name: 'Report room', exact: true }).click();
    await second.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
    await second.getByRole('dialog').getByRole('button', { name: 'Submit report', exact: true }).click();
    await expect(second.getByRole('dialog')).toContainText('submission, not a completed review');
    await second.getByRole('button', { name: 'Done', exact: true }).click();
    const peerRow = second.locator('.room-members li').filter({ hasText: 'Pending stop peer' });
    await peerRow.locator('summary').click(); await peerRow.getByRole('button', { name: 'Block', exact: true }).click();
    await second.getByRole('dialog').getByRole('checkbox', { name: 'I understand this action.', exact: true }).check();
    await second.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
    await expect(second.locator('.room-members')).not.toContainText('Pending stop peer');
    expect((await time(context)).active?.id).toBe(before.active!.id);
    expect((await publicRoom(context.request, roomId)).reservedCount).toBe(2);
    await expect(second.getByRole('heading', { name: 'Your stop is waiting to sync', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Sync personal stop', exact: true }).click();
    await expect(second.getByRole('heading', { name: 'Your stop is waiting to sync', exact: true })).toHaveCount(0);
    const resolved = await time(context); expect(resolved.active).toBeNull(); expect(resolved.sessions).toHaveLength(1);
    expect(resolved.intervals.find(value => value.id === currentInterval.id)?.eligibility).toBe('personal');
    expect(resolved.intervals.find(value => value.id === earlier.id)?.eligibility).toBe('eligible');
    expect((await own(context)).membership?.status).toBe('active'); expect((await publicRoom(context.request, roomId)).phase.kind).toBe('focus');
    await expect(second.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    await second.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(second.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const reentered = await time(context); expect(reentered.sessions).toHaveLength(2);
    expect(reentered.active!.id).not.toBe(before.active!.id);
    expect(reentered.active!.participationId).toBe(before.active!.participationId);
    expect(Date.parse(reentered.active!.roomDeadlineAt!)).toBe(Date.parse(before.active!.roomDeadlineAt!));
  } finally { await context.setOffline(false); await second.close(); await peer.close(); }
});

test('an older initial private snapshot retries promptly after a newer me response without Realtime', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await setup(context, 'HTTP fallback member');
  const title = `HTTP fallback ${randomUUID().slice(0, 8)}`; const roomId = await create(context, title);
  let releaseMe = () => {}; let releaseSnapshot = () => {};
  let initialSeen = () => {}; let snapshotSeen = () => {};
  const initialRequest = new Promise<void>(resolve => { initialSeen = resolve; });
  const snapshotRequest = new Promise<void>(resolve => { snapshotSeen = resolve; });
  const meGate = new Promise<void>(resolve => { releaseMe = resolve; });
  const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  let heldMe = false; let heldSnapshot = false;
  let snapshotReads = 0;
  await page.route('**/api/v1/rooms/*/realtime', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }) }));
  await page.route('**/api/v1/rooms/me', async route => {
    if (heldMe) { await route.continue(); return; }
    heldMe = true; initialSeen(); await meGate;
    const response = await route.fetch(); await route.fulfill({ response }).catch(() => {});
  });
  await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
    snapshotReads++;
    if (heldSnapshot) { await route.continue(); return; }
    heldSnapshot = true; const response = await route.fetch(); snapshotSeen(); await snapshotGate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.goto('/app/today'); await initialRequest;
    await page.locator('.workspace-sidebar').getByRole('link', { name: 'Focus', exact: true }).click();
    await page.getByRole('navigation', { name: 'Focus mode', exact: true }).getByRole('link', { name: 'Study rooms', exact: true }).click();
    await page.getByLabel('Find a room', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.locator(`.room-card h3 a[href="/app/rooms/${roomId}"]`).click();
    await snapshotRequest;
    const delivered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/rooms/me' && !new URL(response.url()).search);
    releaseMe(); await (await delivered).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    releaseSnapshot();
    await expect(page.locator('.room-members'), 'HTTP fallback must recover without waiting for the 30-second heartbeat').toBeVisible({ timeout: 5000 });
    await expect(page.locator('.room-members')).toContainText('HTTP fallback member');
    expect(snapshotReads).toBeGreaterThanOrEqual(2); expect(snapshotReads).toBeLessThanOrEqual(3);
    expect(pageErrors).toEqual([]);
  } finally { releaseMe(); releaseSnapshot(); await page.unrouteAll({ behavior: 'wait' }); await test.info().attach('browser-errors', { body: JSON.stringify(pageErrors), contentType: 'application/json' }); }
});

test('mobile room filters preserve draft values and apply explicit URL state while desktop keeps inline controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 920 }); await page.goto('/rooms');
  const toggle = page.getByRole('button', { name: /^Filters/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveCount(0);
  await page.getByLabel('Find a room', { exact: true }).fill('no-match-mobile-filter-check');
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await capture(page, 'filters-keyboard-mobile', 375);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('en');
  await toggle.click(); await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\?q=no-match-mobile-filter-check&language=en$/);
  await expect(page.getByRole('heading', { name: 'No rooms match yet.', exact: true })).toBeVisible();
  await expect(toggle).toHaveText('Filters · 1 active'); await toggle.click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('fr');
  await toggle.click(); await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('fr');
  expect(new URL(page.url()).searchParams.get('language')).toBe('en');
  await toggle.click(); await page.setViewportSize({ width: 1280, height: 920 });
  await expect(toggle).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('fr');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/language=fr$/);
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Find a room', { exact: true })).toHaveValue('');
  await expect(page.getByText('Finding rooms…', { exact: true })).toHaveCount(0);
  await capture(page, 'directory-final-mobile', 375); await capture(page, 'directory-final-desktop', 1280);
});

function receivedRoomHints(page: Page) {
  let count = 0; const versions = new Set<number>();
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const message = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString());
      const event = Array.isArray(message) ? message[3] : message.event;
      const payload = Array.isArray(message) ? message[4] : message.payload;
      if (event === 'broadcast' && payload?.event === 'invalidate') {
        count++; if (Number.isSafeInteger(payload.payload?.version)) versions.add(payload.payload.version);
      }
    } catch { /* Ignore non-JSON transport frames; no synthetic hints are injected. */ }
  }));
  return Object.assign(() => count, { versions });
}
async function setHostIntent(context: BrowserContext, roomId: string, intent: 'reading' | 'practice' | 'project' | 'work') {
  const member = (await own(context)).membership!;
  return act(context, { type: 'setIntent', roomId, deviceId: member.deviceId, controlVersion: member.controlVersion, intent });
}

test('several real hints during a held private snapshot produce one trailing refresh and preserve block filtering', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  let release = () => {};
  const hints = receivedRoomHints(page);
  try {
    await setup(host, 'Burst host identity'); const roomId = await create(host);
    await setup(context, 'Burst observer'); await join(page, roomId);
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    await page.waitForTimeout(500); // Let the initial subscription refresh settle before measuring a new burst.
    const viewer = (await own(context)).membership!;
    let snapshotReads = 0; let meReads = 0; let activeReads = 0; let maximumReads = 0;
    const tracked = new Set<import('@playwright/test').Request>();
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' || !(url.pathname === `/api/v1/rooms/${roomId}/snapshot` || url.pathname === '/api/v1/rooms/me' && url.searchParams.get('roomId') === roomId)) return;
      if (url.pathname.endsWith('/snapshot')) snapshotReads++; else meReads++;
      tracked.add(request); activeReads++; maximumReads = Math.max(maximumReads, activeReads);
    });
    const finished = (request: import('@playwright/test').Request) => { if (tracked.delete(request)) activeReads--; };
    page.on('requestfinished', finished); page.on('requestfailed', finished);
    let captured = () => {}; const ready = new Promise<void>(resolve => { captured = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (held) { await route.continue(); return; }
      held = true; const response = await route.fetch(); expect(response.status()).toBe(200); captured();
      await gate; await route.fulfill({ response }).catch(() => {});
    });
    const before = hints();
    const firstHint = await setHostIntent(host, roomId, 'reading'); await ready;
    await expect.poll(() => hints.versions.has(firstHint.data.room!.hintVersion)).toBe(true);
    for (const intent of ['practice', 'project'] as const) {
      const changed = await setHostIntent(host, roomId, intent);
      await expect.poll(() => hints.versions.has(changed.data.room!.hintVersion)).toBe(true);
    }
    const blocked = await act(host, { type: 'block', roomId, targetMembershipId: viewer.id });
    await expect.poll(() => hints.versions.has(blocked.data.room!.hintVersion)).toBe(true);
    await expect.poll(hints).toBeGreaterThanOrEqual(before + 4);
    await page.waitForTimeout(300); // More than the 120ms coalescing window while the first snapshot is held.
    expect(meReads).toBe(0); expect(snapshotReads).toBe(1); expect(maximumReads).toBe(1);
    release();
    await expect(page.locator('.room-members')).toContainText('Burst observer');
    await expect(page.locator('.room-members')).not.toContainText('Burst host identity');
    await expect.poll(() => snapshotReads).toBe(2);
    await page.waitForTimeout(300);
    expect(meReads).toBe(0); expect(snapshotReads).toBe(2); expect(maximumReads).toBe(1);
    const authoritative = (await (await context.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`)).json()).data as RoomSnapshot;
    expect(authoritative.participants.some(person => person.displayName === 'Burst host identity')).toBe(false);
    await test.info().attach('invalidation-read-counts', { body: JSON.stringify({ hints: hints() - before, meReads, snapshotReads, maximumReads }), contentType: 'application/json' });
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await host.close(); }
});

test('revocation and account unmount discard a dirty trailing refresh and a held old-owner snapshot', async ({ browser, page, context }) => {
  const host = await browser.newContext();
  let release = () => {};
  const hints = receivedRoomHints(page);
  try {
    await setup(host, 'Revocation host identity'); const roomId = await create(host);
    const first = await setup(context, 'Queued observer A'); await join(page, roomId);
    await startRun(host, roomId);
    await expect(page.getByRole('heading', { name: 'Focus · round 1 of 4', exact: true })).toBeVisible();
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const viewer = (await own(context)).membership!;
    let oldOwnerReads = 0;
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.startsWith('/api/v1/rooms') && request.headers()['x-dima-account-id'] === first.accountId) oldOwnerReads++;
    });
    let captured = () => {}; const ready = new Promise<void>(resolve => { captured = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (held) { await route.continue(); return; }
      held = true; const response = await route.fetch(); expect(response.status()).toBe(200); captured();
      await gate; await route.fulfill({ response }).catch(() => {});
    });
    const before = hints();
    const firstHint = await setHostIntent(host, roomId, 'reading'); await ready;
    await expect.poll(() => hints.versions.has(firstHint.data.room!.hintVersion)).toBe(true);
    const changed = await setHostIntent(host, roomId, 'practice');
    await expect.poll(() => hints.versions.has(changed.data.room!.hintVersion)).toBe(true);
    await expect.poll(hints).toBeGreaterThanOrEqual(before + 2);
    const hostMember = (await own(host)).membership!;
    await act(host, { type: 'remove', roomId, deviceId: hostMember.deviceId, controlVersion: hostMember.controlVersion, targetMembershipId: viewer.id, reason: 'other' });
    expect((await context.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`)).status()).toBe(403);
    await page.locator('.workspace-sidebar').getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('dialog', { name: 'Your room presence', exact: true }).getByRole('button', { name: 'Sign out and stop presence updates', exact: true }).click();
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
    const countAfterUnmount = oldOwnerReads;
    const second = await setup(context, 'Fresh observer B');
    release(); await page.goto('/app/rooms');
    await expect(page.getByRole('heading', { name: 'Study together.', exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    expect(oldOwnerReads).toBe(countAfterUnmount);
    await expect(page.locator('.room-members')).toHaveCount(0);
    await expect(page.getByText('Queued observer A', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Revocation host identity', { exact: true })).toHaveCount(0);
    const fresh = await own(context); expect(fresh.accountId).toBe(second.accountId); expect(fresh.membership).toBeNull();
    await test.info().attach('old-owner-read-counts', { body: JSON.stringify({ countAfterUnmount, final: oldOwnerReads }), contentType: 'application/json' });
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await host.close(); }
});

function trackPrivateRoomReads(page: Page, roomId: string) {
  const pending = new Set<import('@playwright/test').Request>();
  let last = Date.now(); let snapshots = 0; let me = 0;
  const started = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' || !['/api/v1/rooms/me', `/api/v1/rooms/${roomId}/snapshot`].includes(path)) return;
    pending.add(request); last = Date.now();
    if (path.endsWith('/snapshot')) snapshots++; else me++;
  };
  const finished = (request: import('@playwright/test').Request) => { if (pending.delete(request)) last = Date.now(); };
  page.on('request', started); page.on('requestfinished', finished); page.on('requestfailed', finished);
  return {
    get snapshots() { return snapshots; }, get me() { return me; },
    async quiet() { await expect.poll(() => pending.size === 0 && Date.now() - last >= 400, { timeout: 15000 }).toBe(true); },
    reset() { expect(pending.size).toBe(0); snapshots = 0; me = 0; last = Date.now(); },
    stop() { page.off('request', started); page.off('requestfinished', finished); page.off('requestfailed', finished); },
  };
}

test('duplicate and older real room hints cause no extra reads while an uncovered failed version still retries', async ({ browser, page, context }) => {
  const host = await browser.newContext(); const hints = receivedRoomHints(page);
  let tracker: ReturnType<typeof trackPrivateRoomReads> | undefined;
  try {
    const hostAccount = await setup(host, 'Versioned host'); const roomId = await create(host);
    await setup(context, 'Versioned observer'); tracker = trackPrivateRoomReads(page, roomId);
    await join(page, roomId);
    await expect(page.getByText('Live room updates connected', { exact: true })).toBeVisible();
    await tracker.quiet(); tracker.reset();
    const current = await publicRoom(host.request, roomId); const before = hints();
    await republishSyntheticRoomHint(hostAccount.accountId, roomId, current.hintVersion);
    await republishSyntheticRoomHint(hostAccount.accountId, roomId, Math.max(0, current.hintVersion - 1));
    await republishSyntheticRoomHint(hostAccount.accountId, roomId, current.hintVersion);
    await expect.poll(hints).toBeGreaterThanOrEqual(before + 3); await tracker.quiet();
    expect(tracker.snapshots).toBe(0); expect(tracker.me).toBe(0);

    let failed = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      if (failed) { await route.continue(); return; }
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
    });
    // Isolate the coalescer's retry from the normal 30s renew→snapshot recovery.
    await page.route('**/api/v1/rooms', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.type === 'renewPresence') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
      } else await route.continue();
    });
    await setHostIntent(host, roomId, 'reading');
    await expect.poll(() => failed).toBe(true); await tracker.quiet();
    expect(tracker.snapshots).toBe(1);
    const changed = await publicRoom(host.request, roomId); const afterFailure = hints();
    await republishSyntheticRoomHint(hostAccount.accountId, roomId, changed.hintVersion);
    await republishSyntheticRoomHint(hostAccount.accountId, roomId, changed.hintVersion - 1);
    await expect.poll(hints).toBeGreaterThanOrEqual(afterFailure + 2);
    await tracker.quiet(); expect(tracker.snapshots).toBe(1);
    await expect(page.locator('.room-members li').filter({ hasText: 'Versioned host' })).toContainText('Reading', { timeout: 35000 });
    await tracker.quiet(); expect(tracker.snapshots).toBe(2); expect(tracker.me).toBe(0);
    await test.info().attach('versioned-refresh-reads', { body: JSON.stringify({ snapshots: tracker.snapshots, me: tracker.me, deliveredHints: hints() - before }), contentType: 'application/json' });
  } finally { tracker?.stop(); await page.unrouteAll({ behavior: 'wait' }); await host.close(); }
});

test('a known-room secondary poll reconciles a changed controller once when realtime is unavailable', async ({ page, context }) => {
  await setup(context, 'Controller observer'); const roomId = await create(context);
  await page.route(`**/api/v1/rooms/${roomId}/realtime`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }));
  const tracker = trackPrivateRoomReads(page, roomId);
  try {
    await page.goto(`/app/rooms/${roomId}`);
    await expect(page.locator('.room-members')).toContainText('Controller observer'); await tracker.quiet();
    const previous = (await own(context)).membership!;
    await act(context, { type: 'takeControl', roomId, deviceId: randomUUID(), controlVersion: previous.controlVersion });
    tracker.reset();
    await expect.poll(() => tracker.me, { timeout: 40000 }).toBe(1); await tracker.quiet();
    expect(tracker.snapshots).toBe(2); expect(tracker.me).toBe(1);
    await expect(page.locator('.room-members')).toContainText('Controller observer');
    await expect(page.getByRole('button', { name: 'Take room control on this tab', exact: true })).toBeEnabled();
    expect((await own(context)).membership!.controlVersion).toBeGreaterThan(previous.controlVersion);
  } finally { tracker.stop(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('a held changed-generation snapshot cannot launch membership fallback after account replacement', async ({ browser, page, context }) => {
  const host = await browser.newContext(); let release = () => {};
  let tracker: ReturnType<typeof trackPrivateRoomReads> | undefined;
  try {
    await setup(host, 'Former generation host'); const roomId = await create(host);
    const first = await setup(context, 'Former generation observer');
    await page.route(`**/api/v1/rooms/${roomId}/realtime`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }));
    tracker = trackPrivateRoomReads(page, roomId);
    await act(context, { type: 'join', roomId, deviceId: randomUUID(), acknowledgeVisibility: true, visibilityVersion: 1 });
    await page.goto(`/app/rooms/${roomId}`);
    await expect(page.locator('.room-members')).toContainText('Former generation observer'); await tracker.quiet();
    const previous = (await own(context)).membership!;
    await act(context, { type: 'takeControl', roomId, deviceId: randomUUID(), controlVersion: previous.controlVersion });
    const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      const response = await route.fetch(); const payload = await response.json();
      expect(payload.data.access.generation).toBeGreaterThan(previous.controlVersion); held = true;
      await gate; await route.fulfill({ response }).catch(() => {});
    });
    let oldOwnerReads = 0;
    page.on('request', request => {
      if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/v1/rooms') && request.headers()['x-dima-account-id'] === first.accountId) oldOwnerReads++;
    });
    await expect.poll(() => held, { timeout: 40000 }).toBe(true);
    await page.locator('.workspace-sidebar').getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('dialog', { name: 'Your room presence', exact: true }).getByRole('button', { name: 'Sign out and stop presence updates', exact: true }).click();
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/); const afterUnmount = oldOwnerReads;
    const next = await setup(context, 'Next account observer'); release();
    await page.goto('/app/rooms');
    await expect(page.getByRole('heading', { name: 'Study together.', exact: true })).toBeVisible();
    await tracker.quiet(); expect(oldOwnerReads).toBe(afterUnmount);
    expect((await own(context)).accountId).toBe(next.accountId);
    await expect(page.locator('.room-members')).toHaveCount(0);
    await expect(page.getByText('Former generation host', { exact: true })).toHaveCount(0);
  } finally { release(); tracker?.stop(); await page.unrouteAll({ behavior: 'wait' }); await host.close(); }
});

test('accepted room time can pause and finish while post-Join snapshots are still held', async ({ browser, page, context }, info) => {
  const host = await browser.newContext();
  let roomId = '', joinPosts = 0, heldResponses = 0, released = false;
  let activeHandlers = 0, deliveredResponses = 0, abandonedResponses = 0;
  const routeErrors: string[] = [];
  const checkpoints: { stage: string; heldResponses: number; released: boolean }[] = [];
  function checkpoint(stage: string) {
    const row = { stage, heldResponses, released }; checkpoints.push(row);
    console.log(JSON.stringify({ heldJoinCheckpoint: row }));
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = () => { released = true; resolve(); }; });
  const timeCommand = (type: string) => page.waitForResponse(response => {
    const request = response.request();
    return new URL(request.url()).pathname === '/api/v1/time' && request.method() === 'POST' && request.postDataJSON()?.type === type;
  }, { timeout: 15000 });
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/rooms' && request.method() === 'POST' && request.postDataJSON()?.type === 'joinRound') joinPosts++;
  });
  try {
    checkpoint('setup');
    await setup(host, 'Pending snapshot host'); await setup(context, 'Immediate personal controls');
    roomId = await create(host);
    await join(page, roomId); await startRun(host, roomId);
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    await page.route(`**/api/v1/rooms/${roomId}/snapshot`, async route => {
      activeHandlers++;
      try {
        const response = await route.fetch({ timeout: 10000 });
        expect(response.status()).toBe(200);
        // Materialize the response before holding it; do not retain a live API
        // response body across navigation and route-handler removal.
        const body = await response.body();
        heldResponses++;
        await gate;
        try {
          await route.fulfill({ status: 200, contentType: 'application/json', body });
          deliveredResponses++;
        } catch { abandonedResponses++; } // Finish may abandon an older read.
      } catch {
        routeErrors.push('SNAPSHOT_ROUTE_FAILED');
        await route.abort().catch(() => {});
      } finally { activeHandlers--; }
    });
    checkpoint('join-ready');
    const accepted = page.waitForResponse(response => {
      const request = response.request();
      return new URL(request.url()).pathname === '/api/v1/rooms' && request.method() === 'POST' && request.postDataJSON()?.type === 'joinRound';
    }, { timeout: 15000 });
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    const response = await accepted;
    expect(response.status()).toBe(200);
    const result = await response.json() as RoomCommandResponse;
    const sessionId = result.time!.active!.id;
    expect(result.receipt.sessionId).toBe(sessionId);
    expect(result.time!.active!.roomId).toBe(roomId);
    checkpoint('join-accepted');
    await expect.poll(() => heldResponses).toBeGreaterThan(0);
    expect(released).toBe(false);
    const personal = page.locator('.room-personal-column');
    await expect(personal.locator('.focus-status')).toHaveText('Focusing');
    await expect(personal.locator('.focus-clock')).toBeVisible();
    await expect(personal.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(personal.getByRole('button', { name: 'Finish session', exact: true })).toBeEnabled();
    await expect(page.getByRole('complementary', { name: 'Current focus session', exact: true })).toBeVisible();
    // Confirms the room action is still reconciling while personal controls work.
    await expect(page.getByRole('button', { name: 'Refresh room', exact: true })).toBeDisabled();
    checkpoint('personal-controls-enabled-before-release');
    const paused = timeCommand('pause');
    await personal.getByRole('button', { name: 'Pause', exact: true }).click();
    expect((await paused).status()).toBe(200);
    await expect(personal.locator('.focus-status')).toHaveText('Paused');
    const pausedTime = await time(context);
    expect(pausedTime.active?.id).toBe(sessionId); expect(pausedTime.active?.status).toBe('paused');
    expect(released).toBe(false);
    checkpoint('same-session-paused-before-release');
    const finished = timeCommand('finish');
    await personal.getByRole('button', { name: 'Finish session', exact: true }).click();
    expect((await finished).status()).toBe(200);
    await expect(page).toHaveURL(`${base}/app/progress/activity/${sessionId}`);
    await expect(page.getByText('saved focus time', { exact: true })).toBeVisible();
    expect(released).toBe(false);
    checkpoint('same-session-saved-before-release');
    await test.step('release held snapshots without waiting indefinitely on abandoned routes', async () => {
      release();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await expect.poll(() => activeHandlers, { timeout: 12000 }).toBe(0);
      expect(routeErrors).toEqual([]);
      expect(deliveredResponses + abandonedResponses).toBe(heldResponses);
      checkpoint('held-responses-settled');
    }, { timeout: 15000 });
    await test.step('return to room after all held reads settle', async () => {
      await page.locator('.focus-root').getByRole('link', { name: 'Return to room', exact: true }).click();
      await expect(page).toHaveURL(`${base}/app/rooms/${roomId}`);
      checkpoint('returned-to-room');
    }, { timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveCount(0);
    const saved = await time(context);
    expect(saved.active).toBeNull(); expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].id).toBe(sessionId); expect(saved.sessions[0].status).toBe('finalized');
    expect(saved.intervals).toHaveLength(1); expect(saved.intervals[0].endAt).not.toBeNull();
    expect(joinPosts).toBe(1);
    await info.attach('held-post-join-controls', { contentType: 'application/json', body: JSON.stringify({
      heldResponses, deliveredResponses, abandonedResponses, acceptedJoinPosts: joinPosts, personalControlsBeforeRelease: ['pause', 'finish'],
      sameSessionFinalized: true, returnedWithoutResurrection: true, syntheticClockAging: false,
    }) });
    checkpoint('same-session-no-resurrection-verified');
  } finally {
    release(); await page.unrouteAll({ behavior: 'ignoreErrors' });
    await info.attach('held-post-join-checkpoints', { contentType: 'application/json', body: JSON.stringify({
      checkpoints, activeHandlers, heldResponses, deliveredResponses, abandonedResponses, routeErrors, joinPosts, released,
    }) });
    try {
      if (roomId) {
        for (const account of [context, host]) {
          const me = await own(account), current = await time(account), member = me.membership;
          if (member?.status === 'active' && member.roomId === roomId) await act(account, {
            type: 'leave', roomId, deviceId: member.deviceId, controlVersion: member.controlVersion,
            expectedTimeRevision: current.revision, fromSessionId: current.active?.id ?? null,
            timeControlVersion: current.active?.controlVersion ?? null,
          });
        }
        const current = await publicRoom(host.request, roomId);
        if (current.status === 'open') await act(host, { type: 'close', roomId, roomVersion: current.version });
      }
    } finally { await host.close(); }
  }
});

// These accelerated synthetic fixtures exercise rendered boundary behavior only.
// They are not evidence for the real-wall-clock sustained load gate.
async function prepareHttpBoundary(page: Page, context: BrowserContext, host: BrowserContext, fixture: { roomId: string }) {
  const owner = await setup(host, 'HTTP boundary host');
  await setup(context, 'HTTP boundary watcher');
  fixture.roomId = await create(host);
  await page.route('**/api/v1/rooms/*/realtime', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
  }));
  await join(page, fixture.roomId);
  await page.goto('about:blank');
  await startRun(host, fixture.roomId);
  await ageSyntheticRoomRun(owner.accountId, fixture.roomId, 1488);
  const tracker = trackPrivateRoomReads(page, fixture.roomId);
  try {
    await page.goto(`/app/rooms/${fixture.roomId}`);
    await expect(page.getByRole('heading', { name: 'Focus · round 1 of 4', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'People in this room', exact: true })).toBeVisible();
    await tracker.quiet();
  } finally { tracker.stop(); }
  const room = await publicRoom(context.request, fixture.roomId);
  const deadline = Date.parse(room.phase.endsAt!);
  expect(deadline - Date.now(), 'Fixture leaves enough time to install boundary interception').toBeGreaterThan(3000);
  expect((await time(context)).active).toBeNull();
  return deadline;
}
async function cleanupHttpBoundary(page: Page, context: BrowserContext, host: BrowserContext, roomId: string) {
  try {
    await page.goto('about:blank');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    if (roomId) {
      for (const account of [context, host]) {
        const me = await own(account), current = await time(account), member = me.membership;
        if (member?.status === 'active' && member.roomId === roomId) await act(account, {
          type: 'leave', roomId, deviceId: member.deviceId, controlVersion: member.controlVersion,
          expectedTimeRevision: current.revision, fromSessionId: current.active?.id ?? null,
          timeControlVersion: current.active?.controlVersion ?? null,
        });
      }
      const room = await publicRoom(host.request, roomId);
      if (room.status === 'open') await act(host, { type: 'close', roomId, roomVersion: room.version });
    }
  } finally { await host.close(); }
}

test('HTTP boundary bypasses a held preboundary flight and rejects a stale boundary response without a Me pre-read', async ({ browser, page, context }, info) => {
  const host = await browser.newContext(), fixture = { roomId: '' };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false, released = false, oldDelivered = false, requests = 0, meReads = 0;
  let oldBody = '', oldServerTime = 0;
  let tracker: ReturnType<typeof trackPrivateRoomReads> | undefined;
  const routeErrors: string[] = [];
  const countMe = (request: import('@playwright/test').Request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/rooms/me') meReads++;
  };
  try {
    const deadline = await prepareHttpBoundary(page, context, host, fixture);
    tracker = trackPrivateRoomReads(page, fixture.roomId);
    await page.route(`**/api/v1/rooms/${fixture.roomId}/snapshot`, async route => {
      const index = ++requests;
      try {
        if (index === 1) {
          const response = await route.fetch({ timeout: 10000 });
          if (response.status() !== 200) throw new Error('PREBOUNDARY_SNAPSHOT_FAILED');
          oldBody = await response.text();
          oldServerTime = Date.parse((JSON.parse(oldBody).data as RoomSnapshot).serverTime);
          held = true;
          await gate;
          await route.fulfill({ status: 200, contentType: 'application/json', body: oldBody });
          oldDelivered = true;
        } else if (index === 2) {
          // The new boundary request must not accept an HTTP200 body captured
          // before its freshness floor, even though permissions still match.
          await route.fulfill({ status: 200, contentType: 'application/json', body: oldBody });
        } else {
          await route.continue();
        }
      } catch (error) {
        routeErrors.push(error instanceof Error ? error.message : 'ROUTE_FAILED');
        await route.abort().catch(() => {});
      }
    });
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    expect(oldServerTime).toBeLessThan(deadline);
    // Exclude the explicit Refresh button's own Me read. All subsequent reads
    // must come from the automatic boundary path, with no Time session involved.
    page.on('request', countMe);
    await expect(page.getByRole('heading', { name: 'Short break · round 1 of 4', exact: true })).toBeVisible({ timeout: 16000 });
    expect(released).toBe(false); expect(oldDelivered).toBe(false);
    expect(requests).toBe(3); expect(meReads).toBe(0);
    released = true; release();
    await expect.poll(() => oldDelivered).toBe(true);
    await tracker.quiet();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('heading', { name: 'Short break · round 1 of 4', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toHaveCount(0);
    expect((await time(context)).sessions).toHaveLength(0);
    expect(routeErrors).toEqual([]);
    // Existing normal-read freshness handling may issue its one bounded retry
    // after the old response loses the room version/hint race.
    expect(requests).toBeGreaterThanOrEqual(3); expect(requests).toBeLessThanOrEqual(4); expect(meReads).toBe(0);
    await info.attach('http-boundary-held-flight', { contentType: 'application/json', body: JSON.stringify({
      syntheticRunAging: true, loadAcceptance: false, deadline, oldServerTime, requests, meReads,
      freshPhaseBeforeOldRelease: true, noPhaseResurrection: true,
    }) });
  } finally {
    release(); tracker?.stop(); page.off('request', countMe);
    await cleanupHttpBoundary(page, context, host, fixture.roomId);
  }
});

for (const outcome of ['recover', 'exhaust', 'removed'] as const) {
  test(`HTTP boundary retry is bounded and respects ${outcome === 'removed' ? 'membership removal' : outcome === 'exhaust' ? 'persistent failure' : 'transient recovery'}`, async ({ browser, page, context }, info) => {
    const host = await browser.newContext(), fixture = { roomId: '' };
    let reads = 0, meReads = 0;
    const statuses: number[] = [], dispatches: number[] = [];
    let firstFailed = false, releaseRemoval!: () => void;
    const removalGate = new Promise<void>(resolve => { releaseRemoval = resolve; });
    const countMe = (request: import('@playwright/test').Request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/rooms/me') meReads++;
    };
    try {
      const deadline = await prepareHttpBoundary(page, context, host, fixture);
      const member = (await own(context)).membership!;
      page.on('request', countMe);
      await page.route(`**/api/v1/rooms/${fixture.roomId}/snapshot`, async route => {
        reads++; dispatches.push(Date.now());
        if (reads === 1 || outcome === 'exhaust') {
          statuses.push(503);
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
          firstFailed = true;
        } else {
          if (outcome === 'removed') await removalGate;
          const response = await route.fetch({ timeout: 10000 });
          statuses.push(response.status());
          await route.fulfill({ response });
        }
      });
      // Bounded observation of the real browser timer, not a synthetic API call.
      await expect.poll(() => reads, { timeout: 16000 }).toBeGreaterThanOrEqual(1);
      await expect.poll(() => firstFailed).toBe(true);
      expect(dispatches[0]).toBeGreaterThanOrEqual(deadline);
      if (outcome === 'removed') {
        const hostMember = (await own(host)).membership!;
        await act(host, { type: 'remove', roomId: fixture.roomId, deviceId: hostMember.deviceId,
          controlVersion: hostMember.controlVersion, targetMembershipId: member.id, reason: 'other' });
        releaseRemoval();
        await expect(page.locator('.room-members')).toHaveCount(0, { timeout: 5000 });
        await expect.poll(() => statuses.includes(403)).toBe(true);
        expect(meReads).toBeGreaterThanOrEqual(1);
        expect((await own(context)).membership?.status).not.toBe('active');
      } else if (outcome === 'recover') {
        await expect(page.getByRole('heading', { name: 'Short break · round 1 of 4', exact: true })).toBeVisible({ timeout: 5000 });
        expect(statuses).toEqual([503, 200]); expect(meReads).toBe(0);
      } else {
        await expect.poll(() => reads).toBe(2);
        await expect(page.getByText('This phase has ended. Confirming the next phase…', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Short break · round 1 of 4', exact: true })).toHaveCount(0);
        expect(statuses).toEqual([503, 503]); expect(meReads).toBe(0);
      }
      // More than another750ms retry interval: neither success nor failure may
      // turn the one retry into an unbounded poll; removal must stay revoked.
      await page.waitForTimeout(1100);
      expect(reads).toBe(2);
      if (outcome === 'removed') await expect(page.locator('.room-members')).toHaveCount(0);
      expect((await time(context)).sessions).toHaveLength(0);
      await info.attach(`http-boundary-${outcome}`, { contentType: 'application/json', body: JSON.stringify({
        syntheticRunAging: true, loadAcceptance: false, deadline, statuses, dispatches, reads, meReads,
      }) });
    } finally {
      releaseRemoval(); page.off('request', countMe);
      await cleanupHttpBoundary(page, context, host, fixture.roomId);
    }
  });
}

async function prepareTimeReconciliation(page: Page, context: BrowserContext, host: BrowserContext, fixture: { roomId: string }) {
  await setup(host, 'Time reconciliation host');
  const observer = await setup(context, 'Time reconciliation member');
  fixture.roomId = await create(host); await startRun(host, fixture.roomId);
  await page.route('**/api/v1/rooms/*/realtime', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
  }));
  const tracker = trackPrivateRoomReads(page, fixture.roomId);
  try {
    await join(page, fixture.roomId);
    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    await tracker.quiet();
  } finally { tracker.stop(); }
  return { observer, session: (await time(context)).active! };
}
async function announceExternalTime(page: Page, accountId: string) {
  // The supported cross-tab message carries no state; it makes Focus fetch the
  // real current TimeData after an externally accepted command.
  await page.evaluate(owner => {
    const channel = new BroadcastChannel('dima-focus');
    channel.postMessage({ type: 'changed', owner }); channel.close();
  }, accountId);
}

test('Time reconciliation separates held pre-Time reads and rejects a fresh timestamp with an old Time revision', async ({ browser, page, context }, info) => {
  const host = await browser.newContext(), fixture = { roomId: '' };
  let releaseOld!: () => void, releaseFresh!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  const freshGate = new Promise<void>(resolve => { releaseFresh = resolve; });
  let tracker: ReturnType<typeof trackPrivateRoomReads> | undefined;
  let oldHeld = false, freshHeld = false, freshDelivered = false, freshTimeRevision = -1, reads = 0, meReads = 0;
  let oldSnapshot: RoomSnapshot | undefined;
  const statuses: number[] = [];
  const countMe = (request: import('@playwright/test').Request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/rooms/me') meReads++;
  };
  try {
    const { session } = await prepareTimeReconciliation(page, context, host, fixture);
    tracker = trackPrivateRoomReads(page, fixture.roomId);
    await page.route(`**/api/v1/rooms/${fixture.roomId}/snapshot`, async route => {
      const index = ++reads, response = await route.fetch({ timeout: 10000 });
      statuses.push(response.status());
      const payload = await response.json() as { data: RoomSnapshot };
      if (index === 1) {
        oldSnapshot = payload.data; oldHeld = true; await oldGate;
      } else if (index === 2) {
        // Isolate the revision floor: this is a new post-Pause timestamp but an
        // inconsistent old Time revision. It must never enter rendered state.
        payload.data.me.timeRevision = oldSnapshot!.me.timeRevision;
        payload.data.participants = payload.data.participants.map(person => ({ ...person, displayName: 'Stale Time projection' }));
      } else if (index === 3) {
        freshTimeRevision = payload.data.me.timeRevision; freshHeld = true; await freshGate;
      }
      await route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {});
      if (index === 3) freshDelivered = true;
    });
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect.poll(() => oldHeld).toBe(true);
    page.on('request', countMe);
    const paused = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/time' && response.request().postDataJSON()?.type === 'pause', { timeout: 15000 });
    await page.locator('.room-personal-column').getByRole('button', { name: 'Pause', exact: true }).click();
    const accepted = await paused; expect(accepted.status()).toBe(200);
    const acceptedTime = (await accepted.json()).data as TimeData;
    expect(acceptedTime.active?.id).toBe(session.id); expect(acceptedTime.revision).toBeGreaterThan(oldSnapshot!.me.timeRevision);
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Paused');
    await expect.poll(() => freshHeld).toBe(true);
    expect(reads).toBe(3); expect(meReads).toBe(0); expect(freshTimeRevision).toBeGreaterThanOrEqual(acceptedTime.revision);
    await expect(page.getByText('Stale Time projection', { exact: true })).toHaveCount(0);
    await expect(page.locator('.room-personal-column').getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    releaseFresh(); await expect.poll(() => freshDelivered).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.room-members')).toContainText('Time reconciliation host');
    releaseOld(); await tracker.quiet();
    expect(reads).toBeGreaterThanOrEqual(3); expect(reads).toBeLessThanOrEqual(4);
    expect(meReads).toBe(0); expect(statuses.every(status => status === 200)).toBe(true);
    await expect(page.getByText('Stale Time projection', { exact: true })).toHaveCount(0);
    const final = await time(context);
    expect(final.active?.id).toBe(session.id); expect(final.active?.status).toBe('paused'); expect(final.sessions).toHaveLength(1);
    await info.attach('time-reconciliation-held', { contentType: 'application/json', body: JSON.stringify({
      reads, meReads, oldTimeRevision: oldSnapshot!.me.timeRevision, acceptedTimeRevision: acceptedTime.revision,
      acceptedTimePreserved: true, privateStaleProjectionRejected: true, syntheticClockAging: false,
    }) });
  } finally {
    releaseOld(); releaseFresh(); tracker?.stop(); page.off('request', countMe);
    await cleanupHttpBoundary(page, context, host, fixture.roomId);
  }
});

for (const change of ['controller', 'room', 'removed', 'unavailable'] as const) {
  test(`Time reconciliation preserves ${change === 'controller' ? 'external controller changes' : change === 'room' ? 'external room switches' : change === 'removed' ? 'membership revocation' : 'accepted Time during transient room failure'}`, async ({ browser, page, context }, info) => {
    const host = await browser.newContext(), fixture = { roomId: '' };
    let otherHost: BrowserContext | undefined, otherRoom = '';
    let tracker: ReturnType<typeof trackPrivateRoomReads> | undefined;
    let release!: () => void;
    const heldGate = new Promise<void>(resolve => { release = resolve; });
    let firstHeld = false, delivered = false, snapshotReads = 0;
    const statuses: number[] = [], commands: string[] = [];
    const recordCommand = (request: import('@playwright/test').Request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/rooms') commands.push(request.postDataJSON()?.type);
    };
    try {
      if (change === 'room') {
        otherHost = await browser.newContext(); await setup(otherHost, 'External destination host'); otherRoom = await create(otherHost);
      }
      const { observer, session } = await prepareTimeReconciliation(page, context, host, fixture);
      // Hold an ordinary pre-change snapshot to test that it cannot restore an
      // old controller, old room, revoked roster or pre-Pause capabilities.
      await page.route(`**/api/v1/rooms/${fixture.roomId}/snapshot`, async route => {
        const index = ++snapshotReads;
        if (index > 1 && change === 'unavailable') {
          statuses.push(503);
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
          return;
        }
        const response = await route.fetch({ timeout: 10000 });
        let body = await response.body();
        if (index === 1 && change === 'unavailable') {
          const payload = JSON.parse(body.toString()) as { data: RoomSnapshot };
          payload.data.participants = payload.data.participants.map(member => ({ ...member, displayName: 'Rejected pre-Time roster' }));
          body = Buffer.from(JSON.stringify(payload));
        }
        statuses.push(response.status());
        if (index === 1) { firstHeld = true; await heldGate; }
        await route.fulfill({ status: response.status(), contentType: 'application/json', body }).catch(() => {});
        if (index === 1) delivered = true;
      });
      await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
      await expect.poll(() => firstHeld).toBe(true);
      tracker = trackPrivateRoomReads(page, fixture.roomId);
      page.on('request', recordCommand);
      const member = (await own(context)).membership!;
      if (change === 'controller') {
        await act(context, { type: 'takeControl', roomId: fixture.roomId, deviceId: randomUUID(), controlVersion: member.controlVersion });
        await announceExternalTime(page, observer.accountId);
        await expect(page.getByRole('button', { name: 'Take room control on this tab', exact: true })).toBeEnabled();
        expect((await own(context)).membership!.controlVersion).toBeGreaterThan(member.controlVersion);
      } else if (change === 'room') {
        const externalDevice = randomUUID();
        await act(context, { type: 'takeControl', roomId: fixture.roomId, deviceId: externalDevice, controlVersion: member.controlVersion });
        const externalMember = (await own(context)).membership!;
        const current = await time(context);
        await act(context, { type: 'switchToRoom', roomId: otherRoom, fromRoomId: fixture.roomId, deviceId: externalDevice,
          presenceControlVersion: externalMember.controlVersion, expectedTimeRevision: current.revision,
          fromSessionId: current.active!.id, timeControlVersion: current.active!.controlVersion, acknowledgeVisibility: true, visibilityVersion: 1 });
        await announceExternalTime(page, observer.accountId);
        await expect(page.locator('.room-members')).toHaveCount(0);
        expect((await own(context)).membership!.roomId).toBe(otherRoom);
      } else if (change === 'removed') {
        const hostMember = (await own(host)).membership!;
        await act(host, { type: 'remove', roomId: fixture.roomId, deviceId: hostMember.deviceId,
          controlVersion: hostMember.controlVersion, targetMembershipId: member.id, reason: 'other' });
        await announceExternalTime(page, observer.accountId);
        await expect(page.locator('.room-members')).toHaveCount(0);
      } else {
        await page.locator('.room-personal-column').getByRole('button', { name: 'Pause', exact: true }).click();
        await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Paused');
        await expect.poll(() => statuses.includes(503)).toBe(true);
        await expect(page.locator('.room-personal-column').getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
      }
      release(); await expect.poll(() => delivered).toBe(true); await tracker.quiet();
      if (change === 'controller') {
        await expect(page.getByRole('button', { name: 'Take room control on this tab', exact: true })).toBeEnabled();
        expect(tracker.me).toBe(1);
      } else if (change === 'room' || change === 'removed') {
        await expect(page.locator('.room-members')).toHaveCount(0);
        expect(statuses).toContain(403); expect(tracker.me).toBe(1);
      } else {
        expect(tracker.me).toBe(0);
        const accepted = await time(context);
        expect(accepted.active?.id).toBe(session.id); expect(accepted.active?.status).toBe('paused');
        await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Paused');
        await expect(page.getByText('Rejected pre-Time roster', { exact: true })).toHaveCount(0);
        await expect(page.locator('.room-members')).toContainText('Time reconciliation host');
      }
      expect(commands).toEqual([]); // No browser room mutation or automatic rejoin.
      expect((await time(context)).sessions).toHaveLength(1);
      await info.attach(`time-reconciliation-${change}`, { contentType: 'application/json', body: JSON.stringify({
        snapshotReads, statuses, meReads: tracker.me, browserRoomCommands: commands, oldResponseReleased: true,
      }) });
    } finally {
      release(); tracker?.stop(); page.off('request', recordCommand);
      if (otherHost) await cleanupHttpBoundary(page, context, otherHost, otherRoom);
      await cleanupHttpBoundary(page, context, host, fixture.roomId);
    }
  });
}

test('Join waits for initial account Time data but remains usable during a background Time refresh', async ({ browser, page, context }, info) => {
  const host = await browser.newContext();
  let roomId = '', releaseInitial!: () => void, releaseBackground!: () => void;
  const initialGate = new Promise<void>(resolve => { releaseInitial = resolve; });
  const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve; });
  let initialHeld = false, backgroundHeld = false, retryRequested = false, failedReads = 0, successfulReads = 0, joinPosts = 0;
  let roomReads: ReturnType<typeof trackPrivateRoomReads> | undefined;
  const recordJoin = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/rooms' && request.postDataJSON()?.type === 'join') joinPosts++;
  };
  try {
    await setup(host, 'Join readiness host');
    const observer = await setup(context, 'Join readiness member');
    roomId = await create(host);
    roomReads = trackPrivateRoomReads(page, roomId);
    await page.route(/\/api\/v1\/time(?:\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      if (!retryRequested) {
        failedReads++;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
        return;
      }
      const index = ++successfulReads;
      const response = await route.fetch({ timeout: 10000 });
      expect(response.status()).toBe(200);
      expect((await response.json()).data.accountId).toBe(observer.accountId);
      if (index === 1) { initialHeld = true; await initialGate; }
      if (index === 2) { backgroundHeld = true; await backgroundGate; }
      await route.fulfill({ response }).catch(() => {});
    });
    page.on('request', recordJoin);
    const roomMeResponse = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/rooms/me' && response.status() === 200);
    await page.goto(`/app/rooms/${roomId}`);
    expect((await (await roomMeResponse).json()).data.accountId).toBe(observer.accountId);
    await roomReads.quiet(); // Room initialization has settled while Time is unavailable.
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    const joinButton = page.getByRole('button', { name: 'Enter room', exact: true });
    await expect(joinButton).toBeDisabled();
    expect(joinPosts).toBe(0); expect(failedReads).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: 'Load your saved time before joining.' })).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry time', exact: true });
    await expect(retry).toBeEnabled();
    retryRequested = true; await retry.click();
    await expect.poll(() => initialHeld).toBe(true);
    await expect(page.getByRole('button', { name: 'Retrying…', exact: true })).toBeDisabled();
    await expect(joinButton).toBeDisabled();
    await roomReads.quiet(); expect(successfulReads).toBe(1);

    releaseInitial();
    await expect(joinButton).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Retry time', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /saved time before joining/ })).toHaveCount(0);
    await announceExternalTime(page, observer.accountId);
    await expect.poll(() => backgroundHeld).toBe(true);
    await expect(joinButton).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: /saved time before joining/ })).toHaveCount(0);
    const acceptedJoin = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/rooms' && response.request().postDataJSON()?.type === 'join');
    await joinButton.click();
    const response = await acceptedJoin;
    expect(response.status()).toBe(200);
    expect((await response.json()).data.membership.roomId).toBe(roomId);
    await expect(page.locator('.room-members')).toContainText('Join readiness host');
    expect(joinPosts).toBe(1);
    releaseBackground();
    await expect(page.locator('.room-members')).toContainText('Join readiness member');
    expect((await time(context)).sessions).toHaveLength(0);
    await info.attach('join-time-readiness', { contentType: 'application/json', body: JSON.stringify({
      initialTimeFailures: failedReads, explicitRetry: true, coalescedHeldSuccessReads: 1, initialTimeHeld: initialHeld, initialJoinDisabled: true, backgroundTimeHeld: backgroundHeld,
      joinedBeforeBackgroundRelease: true, acceptedJoinPosts: joinPosts, startsPersonalTime: false,
    }) });
  } finally {
    releaseInitial(); releaseBackground(); roomReads?.stop(); page.off('request', recordJoin);
    await cleanupHttpBoundary(page, context, host, roomId);
  }
});

test('Returning watcher waits for initial account Time before JoinRound and can join during background refresh', async ({ browser, page, context }, info) => {
  const host = await browser.newContext();
  let roomId = '', releaseInitial!: () => void, releaseBackground!: () => void;
  const initialGate = new Promise<void>(resolve => { releaseInitial = resolve; });
  const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve; });
  let initialHeld = false, backgroundHeld = false, reads = 0, joinRoundPosts = 0;
  let roomReads: ReturnType<typeof trackPrivateRoomReads> | undefined;
  const recordJoin = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/rooms' && request.postDataJSON()?.type === 'joinRound') joinRoundPosts++;
  };
  try {
    await setup(host, 'Round readiness host');
    const observer = await setup(context, 'Round readiness watcher');
    roomId = await create(host);
    await page.route('**/api/v1/rooms/*/realtime', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
    }));
    const initialSetupTime = page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/time' && response.status() === 200);
    await page.goto(`/app/rooms/${roomId}`);
    expect((await (await initialSetupTime).json()).data.accountId).toBe(observer.accountId);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    await page.getByRole('button', { name: 'Enter room', exact: true }).click();
    await expect(page.locator('.room-members')).toContainText('Round readiness watcher');
    await page.goto('about:blank');
    await startRun(host, roomId);
    expect((await time(context)).active).toBeNull();

    await page.route(/\/api\/v1\/time(?:\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      const index = ++reads;
      const response = await route.fetch({ timeout: 10000 });
      expect(response.status()).toBe(200);
      expect((await response.json()).data.accountId).toBe(observer.accountId);
      if (index === 1) { initialHeld = true; await initialGate; }
      if (index === 2) { backgroundHeld = true; await backgroundGate; }
      await route.fulfill({ response }).catch(() => {});
    });
    roomReads = trackPrivateRoomReads(page, roomId);
    page.on('request', recordJoin);
    await page.goto(`/app/rooms/${roomId}`);
    await expect(page.locator('.room-members')).toContainText('Round readiness watcher');
    await expect.poll(() => initialHeld).toBe(true);
    await roomReads.quiet(); // Current membership and round are confirmed while Time is held.
    const joinButton = page.getByRole('button', { name: 'Join this focus round', exact: true });
    await expect(joinButton).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Checking your saved time before joining…' })).toBeVisible();
    expect(joinRoundPosts).toBe(0);

    releaseInitial();
    await expect(joinButton).toBeEnabled();
    await announceExternalTime(page, observer.accountId);
    await expect.poll(() => backgroundHeld).toBe(true);
    await expect(joinButton).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: /saved time before joining/ })).toHaveCount(0);
    const acceptedJoin = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/rooms' && response.request().postDataJSON()?.type === 'joinRound');
    await joinButton.click();
    const response = await acceptedJoin;
    expect(response.status()).toBe(200);
    const accepted = await response.json() as RoomCommandResponse;
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    expect(joinRoundPosts).toBe(1);
    releaseBackground();
    const current = await time(context);
    expect(current.active?.id).toBe(accepted.receipt.sessionId);
    expect(current.active?.mode).toBe('room'); expect(current.sessions).toHaveLength(1);
    await info.attach('join-round-time-readiness', { contentType: 'application/json', body: JSON.stringify({
      initialTimeHeld: initialHeld, initialJoinDisabled: true, backgroundTimeHeld: backgroundHeld,
      joinedBeforeBackgroundRelease: true, acceptedJoinRoundPosts: joinRoundPosts, onePersonalSession: true,
    }) });
  } finally {
    releaseInitial(); releaseBackground(); roomReads?.stop(); page.off('request', recordJoin);
    await cleanupHttpBoundary(page, context, host, roomId);
  }
});
