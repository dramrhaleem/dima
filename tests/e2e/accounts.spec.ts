import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AccountData, AccountProfile } from '../../packages/contracts/src/account';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);
const email = (tag: string) => `b1-${tag}-${randomUUID()}@example.test`;

async function signInApi(context: BrowserContext, recipient: string) {
  // Use the real Auth + loopback SMTP flow, including its resend throttle.
  for (let attempt = 0; attempt < 19; attempt++) {
    const after = Date.now();
    const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email: recipient, next: '/app/today' } });
    if (sent.status() === 429 && attempt < 18) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status(), 'Real OTP request should succeed').toBe(200);
    const token = await waitForLocalOtp(recipient, { after });
    const verified = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email: recipient, token, next: '/app/today' } });
    expect(verified.status(), 'Real OTP verification should succeed').toBe(200);
    return;
  }
  throw new Error('Real OTP resend limit did not clear within the test window');
}
async function account(context: BrowserContext): Promise<AccountData> {
  const response = await context.request.get(`${base}/api/v1/me`);
  expect(response.status()).toBe(200);
  return (await response.json()).data as AccountData;
}
async function saveProfile(context: BrowserContext, values: Partial<AccountProfile>) {
  const current = await account(context);
  const draft = { displayName: 'Test member', timezone: 'UTC', intent: 'work', appearance: 'light', reducedMotion: false, onboarded: true, ...current.profile, ...values };
  const { displayName, timezone, intent, appearance, reducedMotion, onboarded } = draft;
  const response = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': current.accountId }, data: { displayName, timezone, intent, appearance, reducedMotion, onboarded, expectedRevision: current.profile?.revision ?? 0, operationId: randomUUID() } });
  expect(response.status()).toBe(200);
  return (await response.json()).data as AccountData;
}
async function signInUi(page: Page, recipient: string, next = '/app/today') {
  await page.goto(`/auth?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole('heading', { name: 'Welcome to Dima' })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(recipient);
  const after = Date.now();
  await page.getByRole('button', { name: 'Send email code', exact: true }).click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email code', { exact: true })).toBeFocused();
  const token = await waitForLocalOtp(recipient, { after });
  await page.getByLabel('Email code', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
}
async function screenshot(page: Page, name: string, width: number, height = 920) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`).toBe(true);
  mkdirSync('.impeccable/review', { recursive: true });
  await page.screenshot({ path: `.impeccable/review/b1-${name}.png`, fullPage: true });
}

test('real email journey, resumable work onboarding, deep link, settings and two-device conflict', async ({ page, context, browser }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const recipient = email('journey');
  const room = '/app/rooms/test?tab=about';
  await page.goto(`/auth?next=${encodeURIComponent(room)}`);
  await expect(page.getByRole('heading', { name: 'Welcome to Dima' })).toBeVisible();
  const providers = (await (await page.request.get('/api/v1/auth/session')).json()).data.providers;
  if (providers.google) await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  else await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await screenshot(page, 'auth-desktop', 1280);
  await screenshot(page, 'auth-mobile', 375);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 920 });
  await signInUi(page, recipient, room);
  await expect(page).toHaveURL(/\/onboarding\?/);
  await page.getByLabel('What should we call you?', { exact: true }).fill('Avery Test');
  await page.getByLabel('Your time zone', { exact: true }).fill('Africa/Cairo');
  await page.getByRole('radio', { name: /Track work/ }).check();
  await page.getByRole('button', { name: 'Save draft for later' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Avery Test');
  await expect(page.getByRole('radio', { name: /Track work/ })).toBeChecked();
  await screenshot(page, 'onboarding-mobile', 375);
  await page.getByRole('button', { name: 'Continue to my space' }).click();
  await expect(page).toHaveURL(`${base}${room}`);
  await expect(page.getByRole('heading', { name: 'Study rooms', exact: true })).toBeVisible();
  await expect(page.getByText('Viewing a room never joins it or starts a timer.', { exact: true })).toBeVisible();
  expect((await (await context.request.get(`${base}/api/v1/rooms/me`)).json()).data.membership).toBeNull();
  expect((await (await context.request.get(`${base}/api/v1/time`)).json()).data.active).toBeNull();
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'Ready for a work session?' })).toBeVisible();
  await expect(page.getByText('Start a focus timer for your work. You don’t need to add a course or make a study plan.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start work session', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start focus|Start work session|Add a course/i })).toHaveCount(0);
  await screenshot(page, 'today-desktop', 1280);
  await screenshot(page, 'today-mobile', 375);
  await screenshot(page, 'today-small', 320);
  await page.goto('/app/settings');
  await page.getByLabel('What should we call you?', { exact: true }).fill('Avery Saved');
  await page.getByLabel('Your time zone', { exact: true }).fill('Europe/London');
  await expect(page.getByLabel('Appearance', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Reduce motion/ }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await page.reload();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Avery Saved');
  await expect(page.getByLabel('Your time zone', { exact: true })).toHaveValue('Europe/London');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await screenshot(page, 'settings-mobile-light', 375);
  await screenshot(page, 'settings-desktop-light', 1280);

  // The second device has an independent cookie jar and authenticates with its own real OTP.
  const second = await browser.newContext({ baseURL: base });
  try {
    await signInApi(second, recipient);
    expect((await account(second)).profile?.displayName).toBe('Avery Saved');
    await page.getByLabel('What should we call you?', { exact: true }).fill('Avery unsaved first-device draft');
    await saveProfile(second, { displayName: 'Avery second device' });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'changed on another device' })).toBeVisible();
    await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Avery unsaved first-device draft');
    await page.getByRole('button', { name: 'Review latest version' }).click();
    await expect(page.getByRole('definition').filter({ hasText: 'Avery second device' })).toBeVisible();
    await page.getByRole('button', { name: 'Use latest saved settings' }).click();
    await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Avery second device');
  } finally { await second.close(); }

  await page.getByLabel('What should we call you?', { exact: true }).fill('Private draft belongs only to Avery');
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Welcome to Dima' })).toBeVisible();
  await signInUi(page, email('switch'));
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('');
  await page.getByLabel('What should we call you?', { exact: true }).fill('Blair Test');
  await page.getByRole('button', { name: 'Choose my first course' }).click();
  await expect(page).toHaveURL(`${base}/app/library`);
  await expect(page.getByRole('heading', { name: 'Find a course to add.' })).toBeVisible();
  await expect(page.getByText(/Avery|Private draft belongs only/)).toHaveCount(0);
  expect((await account(context)).profile?.displayName).toBe('Blair Test');
  expect(failures).toEqual([]);
});

test('a delayed real account-A save cannot overwrite account B after a cookie switch', async ({ page, context }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await signInApi(context, email('late-a'));
  await saveProfile(context, { displayName: 'Late-response Alice' });
  await page.goto('/app/settings');
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Late-response Alice');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let committed!: () => void;
  const actualCommit = new Promise<void>(resolve => { committed = resolve; });
  let fulfilled!: () => void;
  const delivered = new Promise<void>(resolve => { fulfilled = resolve; });
  await page.route('**/api/v1/me', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    const response = await route.fetch(); // Writes to real Postgres; only response timing is controlled.
    expect(response.status()).toBe(200);
    committed();
    await held;
    await route.fulfill({ response });
    fulfilled();
  });
  try {
    await page.getByLabel('What should we call you?', { exact: true }).fill('Alice late private result');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await actualCommit;
    await signInApi(context, email('late-b'));
    await saveProfile(context, { displayName: 'Current-account Blair' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Current-account Blair');
    release(); await delivered;
    // Let the browser consume the delayed response and commit a render before checking isolation.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Current-account Blair');
    await expect(page.getByText(/Late-response Alice|Alice late private result/)).toHaveCount(0);
    expect((await account(context)).profile?.displayName).toBe('Current-account Blair');
    await page.reload();
    await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Current-account Blair');
    expect(failures).toEqual([]);
  } finally { release(); await page.unroute('**/api/v1/me'); }
});

test('failed logout immediately clears private views, survives reload, and retries real revocation', async ({ page, context }) => {
  await signInApi(context, email('logout'));
  await saveProfile(context, { displayName: 'Logout-private Casey' });
  await page.goto('/app/settings');
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveValue('Logout-private Casey');
  await page.getByLabel('What should we call you?', { exact: true }).fill('Casey private unsaved draft');
  await page.route('**/api/v1/auth/logout', route => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your private view is locked.' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'sign-out hasn’t finished' })).toBeVisible();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Logout-private Casey|Casey private unsaved draft/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your private view is locked.' })).toBeVisible();
  await expect(page.getByLabel('What should we call you?', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Retry sign-out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Dima' })).toBeVisible();
  const session = await context.request.get(`${base}/api/v1/auth/session`);
  expect(session.status()).toBe(200);
  expect((await session.json()).data.user).toBeNull();
});

test('settings actions match changes, validation focuses the field and data errors name the right operation', async ({page,context}) => {
  await signInApi(context,email('ux-actions'));
  await saveProfile(context,{displayName:'Clear settings',appearance:'light',onboarded:true,reducedMotion:false});
  await page.goto('/app/settings');
  const name=page.getByLabel('What should we call you?',{exact:true});
  await expect(name).toHaveValue('Clear settings');
  await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await name.fill('Temporary edit');
  await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(name).toHaveValue('Clear settings');
  await name.fill('');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid','true');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.route('**/api/v1/account/export',route=>route.fulfill({status:503,json:{error:{code:'EXPORT_FAILED'}}}));
  await page.getByRole('button',{name:'Download JSON',exact:true}).click();
  await expect(page.locator('.account-data-error')).toContainText('couldn’t download your data');
  await expect(page.locator('.account-data-error')).not.toContainText('deleted');
  await page.unroute('**/api/v1/account/export');
  // Simulate a cleanup failure, never delete this account through the UI.
  await page.route('**/api/v1/account/deletion',route=>route.fulfill({status:503,json:{data:{status:'failed',requestId:randomUUID(),retryable:true}}}));
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await page.getByRole('button',{name:'Email a verification code',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry account deletion',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Request new code',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Hide deletion details',exact:true})).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function(...args) {
      if (this instanceof HTMLElement && this.id === 'account-main') this.dataset.motionRuns = String(Number(this.dataset.motionRuns || 0) + 1);
      return original.apply(this, args);
    };
  });
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Help', exact: true }).click();
  await expect(page.locator('#account-main')).toHaveAttribute('data-motion-runs', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.workspace-sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(name).toBeVisible();
  await expect(page.locator('#account-main')).toHaveAttribute('data-motion-runs', '1');
  await page.goto('/app/unknown-destination');
  await expect(page.getByRole('heading',{name:'We couldn’t find that page.'})).toBeVisible();
  await page.getByRole('link',{name:'Open help',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Choose your next step'})).toBeVisible();
});
