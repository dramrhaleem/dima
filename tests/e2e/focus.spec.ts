import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningData, TimeData, TimeCommand } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { ageSyntheticTimeSession } from '../helpers/time-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(150000);
async function signIn(context: BrowserContext, email: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = Date.now();
    const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/focus' } });
    if (sent.status() === 429 && attempt < 19) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status()).toBe(200);
    const token = await waitForLocalOtp(email, { after });
    const verified = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/focus' } });
    expect(verified.status()).toBe(200);
    return;
  }
  throw new Error('OTP throttle did not clear.');
}
async function setup(context: BrowserContext, email = `b4-${randomUUID()}@example.test`, intent: 'work' | 'learning' = 'work') {
  await signIn(context, email);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  const response = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Casey Focus', timezone: 'Africa/Cairo', intent, appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } });
  expect(response.status()).toBe(200);
  return { email, accountId: account.accountId };
}
async function time(context: BrowserContext): Promise<TimeData> {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function send(context: BrowserContext, state: TimeData, command: TimeCommand) {
  return context.request.post(`${base}/api/v1/time`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: command });
}
async function startOpen(page: Page) {
  await page.goto('/app/focus');
  await page.getByRole('radio', { name: 'Open focus', exact: true }).check();
  await page.getByText('Add session details',{exact:false}).click();
  await page.getByLabel('Session title', { exact: false }).fill('A useful stretch of work');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active').getByRole('heading', { name: 'A useful stretch of work', exact: true })).toBeVisible();
}
async function capture(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: 920 });
  await expect(page.locator('.focus-root')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('.impeccable/review', { recursive: true });
  await page.screenshot({ path: `.impeccable/review/b4-${name}.png`, fullPage: true });
}
async function pendingRows(page: Page) {
  return page.evaluate(() => new Promise<Array<{ accountId: string; command: { operationId: string }; phase: string }>>((resolve, reject) => {
    const request = indexedDB.open('dima-focus-outbox', 1);
    request.onsuccess = () => { const db = request.result; const transaction = db.transaction('stops', 'readonly'); const rows = transaction.objectStore('stops').getAll(); rows.onsuccess = () => resolve(rows.result); rows.onerror = () => reject(rows.error); transaction.oncomplete = () => db.close(); };
    request.onerror = () => reject(request.error);
  }));
}
async function localDate(page: Page, iso: string) {
  return page.evaluate(value => {
    const date = new Date(value);
    const input = document.createElement('input'); input.type = 'datetime-local'; input.step = '1';
    input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    // Chromium omits optional zero seconds; preserve its canonical value for Playwright.fill.
    return input.value;
  }, iso);
}

test('Work-only starts real focus, keeps one session across navigation, pauses background time and records manual time separately', async ({ page, context }) => {
  await setup(context);
  await page.clock.install();
  await page.goto('/app/today');
  await page.getByRole('link', { name: 'Start work session', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Work', exact: true })).toBeChecked();
  await capture(page, 'setup-desktop', 1280);
  await page.getByRole('radio', { name: 'Open focus', exact: true }).check();
  await page.getByText('Add session details',{exact:false}).click();
  await page.getByLabel('Session title', { exact: false }).fill('Draft a useful proposal');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active')).toBeVisible();
  let state = await time(context);
  expect(state.active?.category).toBe('work'); expect(state.active?.enrollmentId).toBeNull();
  const id = state.active!.id;
  const documentMarker = randomUUID();
  await page.evaluate(value => { (window as Window & { marker?: string }).marker = value; }, documentMarker);
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Progress', exact: true }).click();
  await page.getByRole('navigation', { name: 'Progress sections' }).getByRole('link', { name: 'Activity', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show activity', exact: true }).selectOption('learning');
  await expect(page.getByRole('heading', { name: 'No learning sessions match this view.', exact: true })).toBeVisible();
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Current focus session' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { marker?: string }).marker)).toBe(documentMarker);
  await page.locator('.focus-session-strip').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.focus-session-strip')).toContainText('Paused');
  state = await time(context);
  const pausedEnds = state.intervals.map(interval => interval.endAt);
  await page.clock.fastForward(120000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  state = await time(context); expect(state.active?.status).toBe('paused'); expect(state.intervals.map(interval => interval.endAt)).toEqual(pausedEnds);
  await page.locator('.focus-session-strip').getByRole('link', { name: 'View session', exact: true }).click();
  await page.locator('.focus-active').getByRole('button', { name: /Resume|Take control on this tab/ }).click();
  if ((await time(context)).active?.status === 'paused') await page.locator('.focus-active').getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('.focus-active .focus-status')).toHaveText('Focusing');
  await expect.poll(async () => (await time(context)).intervals.length).toBe(2);
  await capture(page, 'active-tablet', 768);
  const primaryControls = page.locator('.focus-active > .focus-actions');
  const dock = page.locator('.focus-session-strip');
  await primaryControls.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(dock).toBeHidden();
  // A shorter viewport puts the primary controls below the initial fold.
  await page.setViewportSize({ width: 768, height: 480 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(primaryControls).not.toBeInViewport();
  await expect(dock).toBeVisible();
  const stripBox = await dock.boundingBox();
  const navigationBox = await page.locator('.workspace-mobile-nav').boundingBox();
  expect(stripBox!.y + stripBox!.height).toBeLessThanOrEqual(navigationBox!.y);
  await expect.poll(async () => {
    const main = await page.locator('.focus-active [role=timer]').textContent();
    const strip = await page.locator('.focus-strip-time').textContent();
    const seconds = (value: string) => value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    return main !== null && strip !== null && Math.abs(seconds(main) - seconds(strip)) <= 1;
  }).toBe(true);
  const dockPause = dock.getByRole('button', { name: 'Pause', exact: true });
  await expect(dockPause).toBeEnabled();
  await dockPause.focus();
  await primaryControls.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(primaryControls).toBeInViewport({ ratio: 1 });
  await expect(dockPause).toBeFocused();
  await expect(dock).toBeVisible();
  await primaryControls.getByRole('button', { name: 'Pause', exact: true }).focus();
  await expect(dock).toBeHidden();
  await capture(page, 'active-mobile', 375); await capture(page, 'active-small', 320);
  await page.locator('.focus-active').getByRole('button', { name: 'Finish session', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/progress/activity/${id}`);
  await expect(page.getByText('Time details and corrections', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Intervals and source', exact: true })).not.toBeVisible();
  await page.getByText('Time details and corrections', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Intervals and source', exact: true })).toBeVisible();
  state = await time(context); expect(state.active).toBeNull(); expect(state.sessions).toHaveLength(1); expect(state.sessions[0].status).toBe('finalized');
  await page.getByRole('link', { name: 'Back to activity', exact: true }).click();
  await page.getByRole('button', { name: 'Add manual time', exact: true }).click();
  const manual = page.locator('.focus-manual');
  await expect(manual).toContainText('browser timezone');
  const original = state.intervals[0];
  await manual.getByLabel('Start time', { exact: true }).fill(await localDate(page, new Date(Date.parse(original.startAt) - 60000).toISOString()));
  await manual.getByLabel('End time', { exact: true }).fill(await localDate(page, state.serverTime));
  await manual.getByRole('button', { name: 'Save personal time', exact: true }).click();
  await expect(manual.getByRole('alert')).toContainText('not saved');
  await expect(manual.getByLabel('Start time', { exact: true })).not.toHaveValue('');
  await manual.getByLabel('Start time', { exact: true }).fill(await localDate(page, new Date(Date.parse(state.serverTime) - 7200000).toISOString()));
  await manual.getByLabel('End time', { exact: true }).fill(await localDate(page, new Date(Date.parse(state.serverTime) - 5400000).toISOString()));
  await manual.getByRole('button', { name: 'Save personal time', exact: true }).click();
  await expect(page.getByText('Manual personal entry', { exact: false })).toBeVisible();
  state = await time(context); expect(state.sessions).toHaveLength(2); expect(state.totals.personalSeconds).toBe(1800);
  expect(state.intervals.filter(interval => interval.source === 'manual').every(interval => interval.eligibility === 'personal')).toBe(true);
});

test('Pomodoro ends at the saved boundary with a separate break and never starts another round automatically', async ({ page, context }) => {
  const identity = await setup(context);
  await page.clock.install();
  await page.goto('/app/focus');
  await page.getByRole('combobox', { name: 'Focus and break preset', exact: true }).selectOption('custom');
  await page.getByLabel('Focus minutes', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active')).toBeVisible();
  let state = await time(context); const id = state.active!.id;
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('What should we call you?', { exact: true }).fill('An unsaved focus draft');
  const shell = await page.locator('.workspace').elementHandle();
  const aged = await ageSyntheticTimeSession(identity.accountId, id, 302);
  const settled = await time(context);
  const manual = await send(context, settled, { type: 'manual', operationId: randomUUID(), expectedRevision: settled.revision, category: 'work', title: 'Newer manual record', startAt: new Date(Date.parse(settled.serverTime) - 1800000).toISOString(), endAt: new Date(Date.parse(settled.serverTime) - 1740000).toISOString() });
  expect(manual.status()).toBe(200);
  let explicitSummaryReads = 0;
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/v1/time' && url.searchParams.get('sessionId') === id) explicitSummaryReads++; });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('complementary', { name: 'Saved focus session', exact: true })).toBeVisible();
  await expect.poll(() => explicitSummaryReads).toBeGreaterThan(0);
  await expect(page).toHaveURL(`${base}/app/settings`);
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('An unsaved focus draft');
  expect(await shell!.evaluate(element => element.isConnected)).toBe(true);
  await page.getByRole('link', { name: 'View summary', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/progress/activity/${id}`);
  await expect(page.getByRole('complementary', { name: 'Saved focus session', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Short break', exact: true })).toBeVisible();
  state = await time(context); expect(state.active).toBeNull(); expect(Date.parse(state.intervals.find(interval => interval.id === aged.intervalId)!.endAt!)).toBe(Date.parse(aged.boundaryAt)); expect(state.totals.eligibleSeconds).toBe(300);
  await capture(page, 'summary-desktop', 1280); await capture(page, 'summary-mobile', 375);
  await page.getByRole('button', { name: 'Hide break countdown', exact: true }).click();
  await expect(page.getByText('The break is over. Nothing starts automatically.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Break countdown hidden/)).toBeVisible();
  await page.getByRole('button', { name: 'Show break countdown', exact: true }).click();
  await expect(page.getByRole('timer', { name: 'Break time remaining' })).toBeVisible();
  await page.clock.fastForward(360000);
  await expect(page.getByText('The break is over. Nothing starts automatically.', { exact: true })).toBeVisible();
  state = await time(context); expect(state.sessions).toHaveLength(2); expect(state.active).toBeNull();
  await page.getByRole('link', { name: 'Set up next round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeEnabled();
  expect((await time(context)).active).toBeNull();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.locator('.focus-active')).toContainText('Round 2');
  expect((await time(context)).active?.roundIndex).toBe(2);
});

test('a second tab explicitly takes control and the stale controller cannot mutate the session', async ({ page, context }) => {
  await setup(context); await startOpen(page);
  const original = await time(context);
  const second = await context.newPage();
  try {
    await second.goto('/app/focus');
    await expect(second.locator('.focus-active').getByRole('button', { name: 'Take control on this tab', exact: true })).toBeEnabled();
    await expect(second.getByRole('button', { name: 'Start focus', exact: true })).toHaveCount(0);
    await second.locator('.focus-active').getByRole('button', { name: 'Take control on this tab', exact: true }).click();
    await expect(second.locator('.focus-active').getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    const latest = await time(context);
    expect(latest.active?.id).toBe(original.active?.id); expect(latest.active?.controlVersion).toBe(original.active!.controlVersion + 1);
    const stale = await send(context, latest, { type: 'pause', operationId: randomUUID(), expectedRevision: latest.revision, sessionId: original.active!.id, deviceId: original.active!.deviceId, controlVersion: original.active!.controlVersion, intervalId: latest.intervals.find(interval => !interval.endAt)!.id });
    expect(stale.status()).toBe(409); expect((await stale.json()).error.code).toBe('CONTROL_LOST');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.focus-active').getByRole('button', { name: 'Take control on this tab', exact: true })).toBeEnabled();
    await capture(second, 'takeover-desktop', 1280);
  } finally { await second.close(); }
});

test('a committed Finish with a lost response recovers its receipt after reload without personal correction or duplication', async ({ page, context }) => {
  await setup(context); await startOpen(page);
  let operation = '';
  let intercepted!: () => void;
  const interceptionFinished = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/api/v1/time/receipts', route => route.abort('failed'));
  await page.route('**/api/v1/time', async route => {
    const command = route.request().postDataJSON() as TimeCommand | null;
    if (route.request().method() === 'POST' && command?.type === 'finish') {
      operation = command.operationId; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); intercepted();
    } else await route.continue();
  });
  await page.locator('.focus-active').getByRole('button', { name: 'Finish session', exact: true }).click();
  await interceptionFinished;
  await expect(page.locator('.focus-root').getByRole('alert')).toContainText('Stop has not been confirmed');
  await expect(page.getByRole('heading', { name: 'Your stop is waiting to sync', exact: true })).toBeVisible();
  await expect.poll(async () => (await pendingRows(page)).length).toBe(1);
  expect((await pendingRows(page))[0].command.operationId).toBe(operation);
  await page.unroute('**/api/v1/time'); await page.unroute('**/api/v1/time/receipts');
  await page.reload();
  await expect.poll(async () => (await pendingRows(page)).length).toBe(0);
  const state = await time(context); expect(state.sessions).toHaveLength(1); expect(state.active).toBeNull(); expect(state.corrections).toHaveLength(0);
  expect(state.intervals.every(interval => interval.eligibility === 'eligible')).toBe(true);
});

test('offline stop survives reload and sign-out, stays isolated from another account, then syncs as personal time', async ({ page, context }) => {
  const first = await setup(context); await startOpen(page);
  const original = await time(context);
  await ageSyntheticTimeSession(first.accountId, original.active!.id, 95);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.focus-active').getByRole('button', { name: 'Take control on this tab', exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.locator('.focus-active').getByRole('button', { name: 'Stop on this device', exact: true })).toBeEnabled();
  await page.locator('.focus-active').getByRole('button', { name: 'Stop on this device', exact: true }).click();
  await expect(page.getByText('Saved on this device. Waiting to sync with your account.', { exact: true })).toBeVisible();
  expect((await pendingRows(page))[0].accountId).toBe(first.accountId);
  const stoppedClock = await page.locator('.focus-active [role=timer]').textContent();
  // Observe a full clock tick: a queued local stop must hold its own interval display.
  await page.waitForTimeout(1200);
  await expect(page.locator('.focus-active [role=timer]')).toHaveText(stoppedClock!);
  await expect(page.locator('.focus-active').getByRole('button', { name: 'Take control on this tab', exact: true })).toHaveCount(0);
  await context.setOffline(false); await page.reload();
  await expect(page.getByRole('button', { name: 'Sync personal stop', exact: true })).toBeVisible();
  await capture(page, 'pending-mobile', 375);
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Preserve saved requests and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
  expect((await (await context.request.get(`${base}/api/v1/auth/session`)).json()).data.user).toBeNull();
  const second = await setup(context);
  let leaked = false;
  page.on('request', request => { if (request.url().includes('/api/v1/time') && request.method() === 'POST' && request.headers()['x-dima-account-id'] === first.accountId) leaked = true; });
  await page.goto('/app/focus');
  await expect(page.getByRole('button', { name: 'Start focus', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your stop is waiting to sync', exact: true })).toHaveCount(0);
  expect((await time(context)).accountId).toBe(second.accountId); expect((await time(context)).sessions).toHaveLength(0); expect(leaked).toBe(false);
  expect((await pendingRows(page)).some(entry => entry.accountId === first.accountId)).toBe(true);
  await page.locator('.workspace-sidebar').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
  expect((await (await context.request.get(`${base}/api/v1/auth/session`)).json()).data.user).toBeNull();
  await signIn(context, first.email); await page.goto('/app/focus');
  await page.getByRole('button', { name: 'Sync personal stop', exact: true }).click();
  await expect.poll(async () => (await pendingRows(page)).length).toBe(0);
  const saved = await time(context); expect(saved.active).toBeNull(); expect(saved.sessions).toHaveLength(1); expect(saved.sessions[0].id).toBe(original.active!.id);
  expect(saved.corrections).toHaveLength(1); expect(saved.intervals[0].eligibility).toBe('personal'); expect(saved.totals.eligibleSeconds).toBe(0);
});

test('blocked IndexedDB never claims a durable save and still permits online Finish', async ({ page, context }) => {
  await setup(context);
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: () => { throw new DOMException('Storage blocked for test', 'SecurityError'); } } }); });
  await startOpen(page);
  await context.setOffline(true);
  await page.locator('.focus-active').getByRole('button', { name: 'Stop on this device', exact: true }).click();
  await expect(page.getByText('Not saved on this device. Held in memory only; keep this page open.', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this device. Waiting to sync with your account.', { exact: true })).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync personal stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your stop is waiting to sync', exact: true })).toHaveCount(0);
  await page.goto('/app/focus');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active')).toBeVisible();
  await page.locator('.focus-active').getByRole('button', { name: 'Finish session', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/progress\/activity\//);
  expect((await time(context)).active).toBeNull();
});

test('open-focus cap asks for review before another session can start', async ({ page, context }) => {
  const identity = await setup(context); await startOpen(page);
  let state = await time(context); const id = state.active!.id;
  await ageSyntheticTimeSession(identity.accountId, id, 14402);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.focus-active .focus-status')).toHaveText('Needs review');
  await page.locator('.focus-active').getByRole('link', { name: 'Review this session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept reviewed session', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Take control on this tab', exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'I reviewed the recorded time up to its saved boundary.', exact: true }).check();
  await page.getByRole('button', { name: 'Accept reviewed session', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Set up another session', exact: true })).toBeVisible();
  state = await time(context); expect(state.active).toBeNull(); expect(state.sessions[0].status).toBe('finalized'); expect(state.totals.eligibleSeconds).toBe(14400);
});

test('a linked learning session leaves progress untouched and offers explicit separate outcome actions', async ({ page, context }) => {
  const identity = await setup(context, undefined, 'learning');
  let learning = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data as LearningData;
  const draftId = `private-${randomUUID()}`;
  const drafts = [
    { type: 'saveDraft', draft: { id: draftId, title: 'Focused practice', sourceUrl: 'https://example.com', courses: [{ id: 'course', title: 'Focused practice', position: 0, modules: [{ id: 'module', title: 'Practice', position: 0, tasks: [{ id: 'practice', title: 'Practice a real skill', position: 0, kind: 'assignment', requirement: 'required', minutes: 30, estimateSource: 'user', sourceUrl: 'https://example.com/practice', prerequisiteIds: [] }] }] }] } },
    { type: 'enroll', offeringId: draftId, taskIds: ['practice'], priorTaskIds: [], targetDate: learning.localDay, estimates: {} },
  ];
  for (const command of drafts) {
    const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': identity.accountId }, data: { ...command, expectedRevision: learning.state.revision, operationId: randomUUID() } });
    expect(response.status()).toBe(200); learning = (await response.json()).data;
  }
  const enrollment = learning.state.enrollments[0];
  await page.goto(`/app/courses/${enrollment.id}/tasks/practice`);
  await expect(page.getByRole('link', { name: 'Start focus', exact: true })).toBeVisible();
  await page.route('**/api/v1/learning', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }));
  await page.getByRole('link', { name: 'Start focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry activities' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start focus', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/learning');
  await page.getByRole('button', { name: 'Retry activities' }).click();
  await expect(page.getByRole('button', { name: 'Start focus', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Link a course activity', { exact: false })).toHaveValue(JSON.stringify([enrollment.id, 'practice']));
  await expect(page.getByRole('radio', { name: 'Learning', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Open focus', exact: true }).check();
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active')).toBeVisible();
  await page.locator('.focus-active').getByRole('button', { name: 'Finish session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What happened with your activity?', exact: true })).toBeVisible();
  learning = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data;
  expect(learning.state.enrollments[0].completions).toHaveLength(0); expect(learning.state.workEvents ?? []).toHaveLength(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Record partial work', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Keep the work you did.', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(((await (await context.request.get(`${base}/api/v1/learning`)).json()).data as LearningData).state.enrollments[0].completions).toHaveLength(0);
});
