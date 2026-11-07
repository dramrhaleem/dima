import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AccountData } from '../../packages/contracts/src/account';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(150000);
async function prepare(context: BrowserContext, appearance: 'light' | 'dark' = 'light') {
  const email = `performance-${randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = Date.now();
    const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/today' } });
    if (sent.status() === 429 && attempt < 19) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status()).toBe(200);
    const token = await waitForLocalOtp(email, { after });
    const verified = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/today' } });
    expect(verified.status()).toBe(200);
    break;
  }
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  const saved = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Continuity Test', timezone: 'Africa/Cairo', intent: 'learning', appearance, reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } });
  expect(saved.status()).toBe(200);
}
async function visibilityBurst(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    for (let n = 0; n < 5; n++) {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    }
  });
}

test('background revalidation preserves mounted workspace and unsaved draft through a focus burst', async ({ page, context }) => {
  await prepare(context);
  await page.goto('/app/settings');
  const name = page.getByLabel('What should we call you?', { exact: true });
  await expect(name).toHaveValue('Continuity Test');
  await name.fill('Unsaved focus draft');
  const shell = await page.locator('.workspace').elementHandle();
  const field = await name.elementHandle();
  await page.clock.install();
  await page.clock.fastForward(61000);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let sessionRequests = 0; let profileRequests = 0;
  const settled: Array<Promise<void>> = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/v1/auth/session') sessionRequests++; });
  await page.route('**/api/v1/me', route => {
    profileRequests++;
    const pending = (async () => { const response = await route.fetch(); await held; await route.fulfill({ response }).catch(() => {}); })();
    settled.push(pending); return pending;
  });
  try {
    await visibilityBurst(page);
    await page.clock.runFor(500);
    await expect(page.locator('.workspace'), 'Background refresh must not replace the workspace with a full-page loader').toBeVisible();
    await expect(name).toBeVisible();
    await expect(name).toHaveValue('Unsaved focus draft');
    expect(await field!.evaluate(element => element.isConnected)).toBe(true);
    expect(await shell!.evaluate(element => element.isConnected)).toBe(true);
    expect(profileRequests, 'Focus and visibility events coalesce into one pending identity request').toBe(1);
    expect(sessionRequests, 'Background revalidation should not fetch both account and session').toBe(0);
    release();
    await Promise.all(settled);
    await expect.poll(() => profileRequests).toBe(1);
    await expect(name).toHaveValue('Unsaved focus draft');
    expect(sessionRequests).toBe(0);
    // A temporary network failure on a later tab return must preserve the same draft too.
    await page.unroute('**/api/v1/me');
    await page.route('**/api/v1/me', route => route.abort('internetdisconnected'));
    await page.clock.fastForward(61000);
    const failed = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === '/api/v1/me' });
    await visibilityBurst(page); await failed; await page.clock.runFor(500);
    await expect(name).toBeVisible();
    await expect(name).toHaveValue('Unsaved focus draft');
    expect(await field!.evaluate(element => element.isConnected)).toBe(true);
    expect(await shell!.evaluate(element => element.isConnected)).toBe(true);
  } finally { release(); await page.unroute('**/api/v1/me'); }
});

test('workspace navigation keeps the document and shell while supporting back and offering queries', async ({ page, context }, testInfo) => {
  await prepare(context);
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Choose what you want to learn.', exact: true })).toBeVisible();
  const shell = await page.locator('.workspace').elementHandle();
  const sentinel = randomUUID();
  await page.evaluate(value => { (window as Window & { continuitySentinel?: string }).continuitySentinel = value; }, sentinel);
  let documents = 0;
  const apiRequests = { session: 0, me: 0, catalog: 0 };
  const timings: Array<{ route: string; observedMs: number }> = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') documents++;
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/session') apiRequests.session++;
    if (path === '/api/v1/me') apiRequests.me++;
    if (path === '/api/v1/catalog') apiRequests.catalog++;
  });
  const entries = [['My Courses', '/app/courses'], ['My Plan', '/app/plan'], ['Library', '/app/library'], ['Settings', '/app/settings'], ['Today', '/app/today']] as const;
  async function sameShell() {
    expect(await page.evaluate(() => (window as Window & { continuitySentinel?: string }).continuitySentinel)).toBe(sentinel);
    expect(await shell!.evaluate(element => element === document.querySelector('.workspace'))).toBe(true);
    expect(documents).toBe(0);
  }
  for (const [label, path] of entries) {
    const started = Date.now();
    await page.locator('.workspace-sidebar').getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(`${base}${path}`);
    await expect(page.locator('#workspace-title')).toHaveText(label);
    await expect(page.locator('#workspace-title')).toBeFocused();
    timings.push({ route: path, observedMs: Date.now() - started });
    await sameShell();
  }
  await page.goBack();
  await expect(page).toHaveURL(`${base}/app/settings`);
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Continuity Test');
  await sameShell();
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByLabel('Find a course', { exact: true }).fill('CS50');
  await expect(page).toHaveURL(`${base}/app/library?q=CS50`);
  await page.getByRole('link', { name: 'CS50 Business', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/library/cs50-business`);
  await expect(page.locator('#workspace-title')).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  // Dispatch without Playwright scrolling the top-of-page link into view first.
  await page.getByRole('link', { name: '← All courses', exact: true }).dispatchEvent('click');
  await expect(page).toHaveURL(`${base}/app/library`);
  await expect(page.getByLabel('Find a course', { exact: true })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await expect(page.locator('#workspace-title')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(`${base}/app/library/cs50-business`);
  await expect(page.getByRole('heading', { name: 'CS50 Business', exact: true })).toBeVisible();
  await expect(page.locator('#workspace-title')).toBeFocused();
  await sameShell();
  await page.getByRole('link', { name: 'Personalize this course', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app/courses/add?offering=cs50-business`);
  await expect(page.getByRole('heading', { name: 'Choose your starting point.', exact: true })).toBeVisible();
  await expect(page.getByText('CS50 Business', { exact: true })).toBeVisible();
  await sameShell();
  expect(apiRequests).toEqual({ session: 0, me: 0, catalog: 1 });
  const report = '.impeccable/review/performance-navigation.json';
  mkdirSync('.impeccable/review', { recursive: true });
  writeFileSync(report, JSON.stringify({ environment: 'Local Workers preview, headless Chrome; observed test interaction duration, not a production benchmark', timings, documents, apiRequests }, null, 2));
  await testInfo.attach('navigation-observations', { path: report, contentType: 'application/json' });
});

test('light-only UI ignores a legacy dark preference and a dark operating system', async ({ page, context }) => {
  await prepare(context, 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/app/settings');
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Continuity Test');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveCount(0);
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe('light');
  await page.getByLabel('What should we call you?', { exact: true }).fill('Light preference retained');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await page.reload();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Light preference retained');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('confirmed session loss clears private settings and redirects to sign-in', async ({ page, context }) => {
  await prepare(context);
  await page.goto('/app/settings');
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Continuity Test');
  await page.clock.install();
  await page.clock.fastForward(61000);
  await context.clearCookies();
  await visibilityBurst(page);
  await page.clock.runFor(500);
  await expect(page).toHaveURL(/\/auth\?next=/);
  await expect(page.getByRole('heading', { name: 'Welcome to Dima', exact: true })).toBeVisible();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Continuity Test', { exact: true })).toHaveCount(0);
});
