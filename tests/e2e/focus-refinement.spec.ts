import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, TimeData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { ageSyntheticTimeSession } from '../helpers/time-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);

async function setup(context: BrowserContext) {
  const email = `b4-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/focus' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/focus' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Sam Focus', timezone: 'Africa/Cairo', intent: 'work', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  return account.accountId;
}
async function time(context: BrowserContext): Promise<TimeData> {
  const response = await context.request.get(`${base}/api/v1/time`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/focus-refined-${name}-${width}.png`, fullPage: true });
  }
}

test('small preset supports pause, explicit finish, optional break and a clean repeat setup without auto-start', async ({ page, context }) => {
  await setup(context);
  await page.clock.install();
  await page.goto('/app/focus');
  const preset = page.getByRole('combobox', { name: 'Focus and break preset', exact: true });
  await expect(preset).toHaveValue('25');
  await expect(page.getByLabel('Session title', { exact: false })).toBeHidden();
  await preset.selectOption('15');
  await capture(page, 'setup');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  const active = page.getByRole('region', { name: 'Your focus session', exact: true });
  await expect(active).toBeVisible();
  const progress = active.getByRole('progressbar', { name: 'Focus round progress', exact: true });
  await expect(progress).toHaveAttribute('max', '900');
  await expect(active.getByRole('button', { name: 'Pause', exact: true })).not.toHaveClass(/secondary/);
  await expect(active.getByRole('button', { name: 'Finish session', exact: true })).toHaveClass(/secondary/);
  let state = await time(context);
  const id = state.active!.id;
  expect(state.active!.settings).toEqual({ focusMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 15, longBreakAfter: 4 });
  await capture(page, 'active');
  await active.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(active.locator('.focus-status')).toHaveText('Paused');
  const paused = await active.getByRole('timer').textContent();
  await page.clock.fastForward(5000);
  await expect(active.getByRole('timer')).toHaveText(paused!);
  await expect(active).toContainText('this pause won’t count');
  await active.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(active.locator('.focus-status')).toHaveText('Focusing');
  await active.getByRole('button', { name: 'Finish session', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/progress/activity/${id}`);
  await page.getByRole('button', { name: 'Take a 3 min break', exact: true }).click();
  await expect(page.getByRole('timer', { name: 'Break time remaining', exact: true })).toBeVisible();
  await capture(page, 'break');
  await expect(page.getByRole('link', { name: 'Done for now', exact: true })).toHaveAttribute('href', '/app/today');
  state = await time(context); expect(state.active).toBeNull(); expect(state.sessions).toHaveLength(1);
  await page.getByRole('link', { name: 'Set up next round', exact: true }).click();
  await expect(preset).toHaveValue('15');
  await expect(page.getByLabel('Focus minutes', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeEnabled();
  expect((await time(context)).active).toBeNull();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(active).toContainText('Round 2');
  expect((await time(context)).active?.roundIndex).toBe(2);
  await active.getByRole('button', { name: 'Finish session', exact: true }).click();
});

test('custom boundaries remain validated and a completed round offers rest without creating focus time', async ({ page, context }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    (window as Window & { soundTones?: number }).soundTones = 0;
    AudioContext.prototype.createOscillator = function () {
      (window as unknown as Window & { soundTones: number }).soundTones++;
      return original.call(this);
    };
  });
  const accountId = await setup(context);
  await page.clock.install();
  await page.goto('/app/focus');
  await page.getByLabel('Session sound settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Enable & test sound', exact: true }).click();
  await expect(page.getByText('Test chime played.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(2);
  await page.getByRole('combobox', { name: 'Focus and break preset', exact: true }).selectOption('custom');
  const minutes = page.getByLabel('Focus minutes', { exact: true });
  await minutes.fill('4');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  expect(await minutes.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  expect((await time(context)).active).toBeNull();
  await minutes.fill('5');
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(page.locator('.focus-active')).toBeVisible();
  const state = await time(context), id = state.active!.id;
  await ageSyntheticTimeSession(accountId, id, 302);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(`${base}/app/progress/activity/${id}`);
  await expect(page.getByRole('heading', { name: 'Short break', exact: true })).toBeVisible();
  const saved = await time(context);
  expect(saved.active).toBeNull(); expect(saved.totals.eligibleSeconds).toBe(300);
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(4);
  await page.getByLabel('Session sound settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  await expect(page.getByText('Sound muted.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide break countdown', exact: true }).click();
  await expect(page.getByRole('timer', { name: 'Break time remaining', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show break countdown', exact: true }).click();
  await expect(page.getByRole('timer', { name: 'Break time remaining', exact: true })).toBeVisible();
  await page.clock.fastForward(360000);
  await expect(page.getByText('The break is over. Nothing starts automatically.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { soundTones: number }).soundTones)).toBe(4);
  const rested = await time(context);
  expect(rested.active).toBeNull(); expect(rested.sessions).toHaveLength(1); expect(rested.totals.eligibleSeconds).toBe(300);
  await page.getByRole('link', { name: 'Set up next round', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Focus and break preset', exact: true })).toHaveValue('custom');
  await expect(page.getByLabel('Focus minutes', { exact: true })).toHaveValue('5');
  expect((await time(context)).active).toBeNull();
});
