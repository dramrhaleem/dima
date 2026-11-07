import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const artifacts = process.env.DIMA_APPEARANCE_ARTIFACTS ?? '/media/amro/Data2/dima-artifacts/dark-launch-2026-11-02';
const appearance = (page: Page) => page.getByRole('button', { name: 'Dark mode', exact: true }).first();
const memberId = 'f7e7b388-5d3d-4a03-8b64-6f3f4cef9f56';

async function mockMember(context: BrowserContext) {
  // Synthetic read-only account fixtures: no production/local account is changed.
  await context.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, json: { error: { code: 'READ_ONLY_TEST' } } });
      return;
    }
    const common = { accountId: memberId, revision: 1, serverTime: new Date().toISOString() };
    const values: Record<string, unknown> = {
      '/api/v1/auth/session': { user: { id: memberId, email: 'appearance@example.test' }, providers: { google: true, email: true } },
      '/api/v1/me': { accountId: memberId, role: 'member', profile: { displayName: 'Appearance Preview', timezone: 'UTC', intent: 'work', appearance: 'light', reducedMotion: false, onboarded: true, revision: 1, avatarUrl: null, avatarMode: 'none', avatarRevision: 0, googleAvatarUrl: null } },
      '/api/v1/time': { ...common, active: null, sessions: [], intervals: [], corrections: [], totals: { eligibleSeconds: 0, personalSeconds: 0, pendingSeconds: 0 }, nextCursor: null },
      '/api/v1/rooms/me': { ...common, membership: null, room: null, requestedAccess: null, timeRevision: 1, activeTimeSessionId: null, canModerate: false },
      '/api/v1/learning': { ...common, state: { enrollments: [] } },
    };
    await route.fulfill(path in values ? { json: { data: values[path] } } : { status: 404, json: { error: { code: 'TEST_NOT_FOUND' } } });
  });
}

async function capture(page: Page, surface: string) {
  mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${surface} overflow at ${width}`).toBe(true);
    if (surface === 'landing-dark' && width === 375) await expect(page.locator('.site-header .session-link')).toBeHidden();
    await page.screenshot({ path: `${artifacts}/${surface}-${width}.png`, fullPage: true });
  }
}

test('light is default; explicit choice preserves the demo and survives public navigation', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(appearance(page)).toHaveAttribute('aria-pressed', 'false');
  const task = page.getByRole('checkbox', { name: /Explore the project life cycle/ });
  await task.check();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await appearance(page).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(appearance(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(task).toBeChecked();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(await page.evaluate(() => localStorage.getItem('dima-appearance-v1'))).toBe('dark');
  await capture(page, 'landing-dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/privacy');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Your privacy and sharing.' })).toBeVisible();
  await capture(page, 'privacy-dark');
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'Welcome to Dima' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture(page, 'auth-dark');
  await appearance(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('choice synchronizes between tabs without navigation or replacing page state', async ({ page, context }) => {
  await page.goto('/');
  const peer = await context.newPage();
  await peer.goto('/privacy');
  const peerOrigin = await peer.evaluate(() => performance.timeOrigin);
  await appearance(page).click();
  await expect(peer.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(appearance(peer)).toHaveAttribute('aria-pressed', 'true');
  await appearance(peer).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await peer.evaluate(() => performance.timeOrigin)).toBe(peerOrigin);
});

test('blocked storage and reduced motion still allow an explicit in-page choice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked for test', 'SecurityError'); } });
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(appearance(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-dima-motion-allowed', 'false');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await appearance(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('workspace appearance preserves unsaved profile and focus setup state', async ({ page, context }) => {
  await mockMember(context);
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto('/app/settings');
  const name = page.getByLabel('What should we call you?', { exact: true });
  await expect(name).toHaveValue('Appearance Preview');
  await name.fill('Unsaved appearance draft');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await appearance(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(name).toHaveValue('Unsaved appearance draft');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  await capture(page, 'settings-dark');
  await page.goto('/app/focus');
  const preset = page.getByRole('combobox', { name: 'Focus and break preset', exact: true });
  await expect(preset).toHaveValue('25');
  await preset.selectOption('50');
  await appearance(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(preset).toHaveValue('50');
  await appearance(page).click();
  await capture(page, 'focus-dark');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
