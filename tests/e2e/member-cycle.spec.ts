import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, RoomCommand, RoomCommandResponse, RoomMe, RoomSnapshot, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { ageSyntheticRoomRun } from '../helpers/room-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
type RoomInput<C = RoomCommand> = C extends RoomCommand ? Omit<C, 'expectedRevision' | 'operationId'> : never;
test.setTimeout(120000);

async function setup(context: BrowserContext, displayName: string) {
  const email = `b5-member-cycle-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/rooms' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/rooms' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName, timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  return account.accountId;
}
async function own(context: BrowserContext, roomId?: string): Promise<RoomMe> {
  const response = await context.request.get(`${base}/api/v1/rooms/me${roomId ? `?roomId=${roomId}` : ''}`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function time(context: BrowserContext): Promise<TimeData> {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function snapshot(context: BrowserContext, roomId: string): Promise<RoomSnapshot> {
  const response = await context.request.get(`${base}/api/v1/rooms/${roomId}/snapshot`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function act(context: BrowserContext, action: RoomInput): Promise<RoomCommandResponse> {
  const state = await own(context);
  const response = await context.request.post(`${base}/api/v1/rooms`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: { ...action, expectedRevision: state.revision, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/member-cycle-${name}-${width}.png`, fullPage: true });
  }
}

test('a regular member starts the shared cycle after its owner leaves, without gaining moderation or auto-starting personal time', async ({ browser, page, context }) => {
  const creator = await browser.newContext();
  try {
    const ownerId = await setup(creator, 'Cycle owner');
    const created = await act(creator, { type: 'create', deviceId: randomUUID(), title: `Member-led practice ${randomUUID().slice(0, 8)}`, description: 'Start together without waiting for a host.', language: 'en', topic: 'Practice', offeringId: null, presetId: 'classic', acknowledgeVisibility: true, visibilityVersion: 1 });
    const roomId = created.receipt.roomId!;
    await setup(context, 'Independent member');
    await page.addInitScript(() => {
      const original = AudioContext.prototype.createOscillator;
      (window as Window & { soundTones?: number }).soundTones = 0;
      AudioContext.prototype.createOscillator = function () {
        (window as unknown as Window & { soundTones: number }).soundTones++;
        return original.call(this);
      };
    });
    await page.goto(`/app/rooms/${roomId}`);
    await expect(page.getByRole('checkbox', { name: /I understand that room members/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Enter room', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I understand that room members/ }).check();
    await page.getByRole('button', { name: 'Enter room', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People in this room', exact: true })).toBeVisible();
    const before = await snapshot(context, roomId);
    expect(before.me.membership?.isOwner).toBe(false);
    expect(before.me.membership?.isHost).toBe(false);
    expect(before.participants.find(person => person.isOwner)?.displayName).toBe('Cycle owner');
    expect(before.capabilities.canRemove).toBe(false);
    expect(before.capabilities.canTransferHost).toBe(false);
    expect(before.capabilities.canStartRun).toBe(true);
    expect((await time(context)).active).toBeNull();

    const ownerState = await own(creator);
    const ownerTime = await time(creator);
    await act(creator, { type: 'leave', roomId, deviceId: ownerState.membership!.deviceId, controlVersion: ownerState.membership!.controlVersion, expectedTimeRevision: ownerTime.revision, fromSessionId: null, timeControlVersion: null });
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect(page.locator('.room-members')).not.toContainText('Cycle owner');
    await expect(page.getByRole('button', { name: 'Start shared cycle', exact: true })).toBeEnabled();
    await capture(page, 'ready-without-owner');
    await page.getByLabel('Session sound settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Enable & test sound', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(2);
    await page.getByLabel('Session sound settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Start shared cycle', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    const started = await snapshot(context, roomId);
    expect(started.room.run?.status).toBe('active');
    expect(started.room.phase.kind).toBe('focus');
    expect(started.me.membership?.isOwner).toBe(false);
    expect(started.me.membership?.isHost).toBe(false);
    expect(started.capabilities.canRemove).toBe(false);
    expect(started.capabilities.canTransferHost).toBe(false);
    expect((await own(creator, roomId)).requestedAccess?.isOwner).toBe(true);
    expect((await time(context)).active).toBeNull();
    expect((await time(context)).sessions).toHaveLength(0);
    expect((await time(creator)).active).toBeNull();
    const rounds = page.getByRole('list', { name: 'Shared cycle rounds', exact: true });
    await expect(rounds.getByRole('listitem')).toHaveCount(4);
    await expect(rounds.locator('[aria-current="step"]')).toContainText('Round 1');
    await expect(rounds.locator('[aria-current="step"]')).toContainText('Focus');
    await capture(page, 'shared-cycle-started');
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(4);

    await page.getByRole('button', { name: 'Join this focus round', exact: true }).click();
    await expect(page.locator('.room-personal-column .focus-status')).toHaveText('Focusing');
    const active = (await time(context)).active!;
    expect(active.mode).toBe('room');
    expect(active.roomId).toBe(roomId);
    // Advance only this guarded synthetic room; no wall-clock wait or production override.
    await ageSyntheticRoomRun(ownerId, roomId, 25 * 60 + 2);
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect(rounds.locator('[aria-current="step"]')).toContainText('Break');
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(6);
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toHaveCount(0);
    expect((await time(context)).active).toBeNull();
    await ageSyntheticRoomRun(ownerId, roomId, 5 * 60 + 2);
    await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
    await expect(rounds.locator('[aria-current="step"]')).toContainText('Round 2');
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(8);
    await expect(rounds.locator('[data-state="done"]')).toContainText('Round 1');
    await expect(page.getByRole('button', { name: 'Join this focus round', exact: true })).toBeEnabled();
    expect((await time(context)).active).toBeNull();
  } finally { await creator.close(); }
});
