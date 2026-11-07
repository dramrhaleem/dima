import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, PublicRoom, RoomCommand, RoomCommandResponse, RoomMe, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
type RoomInput<C = RoomCommand> = C extends RoomCommand ? Omit<C, 'expectedRevision' | 'operationId'> : never;
test.setTimeout(120000);

async function setup(context: BrowserContext) {
  const email = `b5-refinement-${randomUUID()}@example.test`, after = Date.now();
  const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/today' } });
  expect(sent.status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/today' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, {
    headers: { ...origin, 'X-Dima-Account-Id': account.accountId },
    data: { displayName: 'Room refinement learner', timezone: 'Africa/Cairo', intent: 'work', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() },
  })).status()).toBe(200);
}

async function noRecordedTime(context: BrowserContext) {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  const time = (await response.json()).data as TimeData;
  expect(time.active).toBeNull();
  expect(time.sessions).toHaveLength(0);
}

async function own(context: BrowserContext): Promise<RoomMe> {
  const response = await context.request.get(`${base}/api/v1/rooms/me`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function act(context: BrowserContext, action: RoomInput): Promise<RoomCommandResponse> {
  const state = await own(context);
  const response = await context.request.post(`${base}/api/v1/rooms`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: { ...action, expectedRevision: state.revision, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function readRoom(context: BrowserContext, id: string): Promise<PublicRoom> {
  const response = await context.request.get(`${base}/api/v1/rooms/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function createRoom(context: BrowserContext) {
  const result = await act(context, { type: 'create', deviceId: randomUUID(), title: `Room refinement ${randomUUID().slice(0, 8)}`, description: '', language: 'en', topic: 'Practice', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
  return result.receipt.roomId!;
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/rooms-refinement-${name}-${width}.png`, fullPage: true });
  }
}

test('course-room creation previews clearly and host starts only the shared clock', async ({ page, context }) => {
  await setup(context);
  await page.goto('/app/rooms?offeringId=google-project-management');
  await expect(page.locator('.room-applied-filters')).toContainText('Google Project Management');
  await page.locator('.rooms-intro').getByRole('link', { name: 'Create a room', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Shared course', exact: true })).toHaveValue('google-project-management');
  await page.getByRole('textbox', { name: 'Room title', exact: true }).fill('Project management practice');
  await page.getByRole('button', { name: 'Preview public details', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review your room', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Create and enter room', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).not.toBeChecked();
  await capture(page, 'create-preview');
  await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
  await page.getByRole('button', { name: 'Create and enter room', exact: true }).click();
  const start = page.locator('.room-personal-column').getByRole('button', { name: 'Start shared cycle', exact: true });
  await expect(start).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start shared cycle', exact: true })).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).toHaveCount(0);
  await noRecordedTime(context);
  // An invitation opens the public preview; copying it must not start personal time.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard denied'); } } }));
  await page.getByRole('button', { name: 'Copy room invite link', exact: true }).click();
  const roomId = new URL(page.url()).pathname.split('/').at(-1);
  await expect(page.getByRole('textbox', { name: 'Copy this link', exact: true })).toHaveValue(`https://dima.study/rooms/${roomId}`);
  await noRecordedTime(context);
  await expect(page.getByRole('complementary', { name: 'Current room', exact: true })).toHaveCount(0);
  await page.goto('/app/settings');
  await expect(page.getByRole('complementary', { name: 'Current room', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return to room', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Current room', exact: true })).toHaveCount(0);
  await capture(page, 'host-next-action');
  await start.click();
  await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: 'Learning', exact: true })).toBeChecked();
  await noRecordedTime(context);
  await capture(page, 'course-round');
});

test('directory rhythm describes the active run when the next preset changes', async ({ page, context }) => {
  await setup(context);
  const roomId = await createRoom(context);
  const membership = (await own(context)).membership!;
  let room = await readRoom(context, roomId);
  await act(context, { type: 'startRun', roomId, deviceId: membership.deviceId, controlVersion: membership.controlVersion, roomVersion: room.version });
  room = await readRoom(context, roomId);
  await act(context, { type: 'edit', roomId, roomVersion: room.version, title: room.title, description: room.description, language: 'en', topic: 'Practice', offeringId: null, presetId: 'deep' });
  room = await readRoom(context, roomId);
  expect(room.configuredPreset).toBe('deep');
  expect(room.run?.presetId).toBe('classic');
  await page.goto(`/rooms?q=${encodeURIComponent(room.title)}`);
  const card = page.locator('.room-card').filter({ has: page.getByRole('heading', { name: room.title, exact: true }) });
  await expect(card).toContainText('25 min focus / 5 min break');
  await expect(card).not.toContainText('50 min focus / 10 min break');
  await noRecordedTime(context);
});

test('a full public capacity projection offers recovery before any consent or membership write', async ({ page, context, browser }) => {
  const host = await browser.newContext();
  try {
    await setup(host);
    const roomId = await createRoom(host);
    await setup(context);
    let full = true;
    // Only the public capacity projection is simulated. No extra memberships or timers are fabricated.
    await page.route(`**/api/v1/rooms/${roomId}`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (full) body.data = { ...body.data, reservedCount: body.data.capacity, connectedCount: 1 };
      await route.fulfill({ response, json: body });
    });
    await page.goto(`/app/rooms/${roomId}`);
    await expect(page.getByRole('heading', { name: 'This room is full right now.', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Find another room', exact: true })).toHaveAttribute('href', '/app/rooms');
    await capture(page, 'capacity-recovery');
    full = false;
    await page.getByRole('button', { name: 'Check for a seat', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Enter room', exact: true })).toBeDisabled();
    expect((await own(context)).membership).toBeNull();
    await noRecordedTime(context);
  } finally {
    await host.close();
  }
});
