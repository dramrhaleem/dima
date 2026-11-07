import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
async function learner(context: BrowserContext, displayName: string) {
  const email = `friends-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: { Origin: base }, data: { email, next: '/app/progress/circle' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: { Origin: base }, data: { email, token, next: '/app/progress/circle' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data;
  const headers = { Origin: base, 'X-Dima-Account-Id': account.accountId };
  expect((await context.request.patch(`${base}/api/v1/me`, { headers, data: { displayName, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  // These scenarios exercise saved opt-outs and re-enabling requests, not new-account defaults.
  const sharing = (await (await context.request.get(`${base}/api/v1/sharing`)).json()).data;
  expect((await context.request.post(`${base}/api/v1/sharing`, { headers, data: { type: 'setSharing', publicProfile: false, allowFollow: false, bio: '', weeklyTime: false, courseProgress: false, expectedRevision: sharing.revision, operationId: randomUUID() } })).status()).toBe(200);
  return { id: account.accountId as string, headers };
}

test('friends can exchange profile links, accept and follow back without silently sharing progress', async ({ page, context, browser }) => {
  test.setTimeout(100000);
  const other = await browser.newContext({ baseURL: base });
  try {
    const alex = await learner(context, 'Alex Study Partner');
    const sam = await learner(other, 'Sam Study Partner');
    const samPage = await other.newPage();
    await page.goto('/app/progress/circle');
    const invite = `https://dima.study/app/progress/members/${alex.id}`;
    await expect(page.getByRole('textbox', { name: 'Your personal link', exact: true })).toHaveValue(invite);
    expect((await (await context.request.get(`${base}/api/v1/sharing`)).json()).data.publicProfile).toBe(false);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard denied'); } } }));
    await page.getByRole('button', { name: 'Enable requests & copy link', exact: true }).click();
    await expect(page.getByText('Your link is ready. Select the field above and copy it manually.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy my friend link', exact: true })).toBeVisible();
    expect((await (await context.request.get(`${base}/api/v1/sharing`)).json()).data).toMatchObject({ publicProfile: true, allowFollow: true, weeklyTime: false, courseProgress: false });
    await page.getByRole('textbox', { name: 'Dima profile link or username', exact: true }).fill(invite);
    await page.getByRole('button', { name: 'Request to follow', exact: true }).click();
    await expect(page.getByText(/That’s your own link/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Dima profile link or username', exact: true }).fill('');
    // The friend explicitly allows requests too; otherwise follow-back must not override their choice.
    const samSharing = (await (await other.request.get(`${base}/api/v1/sharing`)).json()).data;
    expect((await other.request.post(`${base}/api/v1/sharing`, { headers: sam.headers, data: { type: 'setSharing', publicProfile: true, allowFollow: true, bio: '', weeklyTime: false, courseProgress: false, expectedRevision: samSharing.revision, operationId: randomUUID() } })).status()).toBe(200);
    const visitor = await browser.newContext({ baseURL: base });
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto(`/app/progress/members/${alex.id}`);
      await expect(visitorPage).toHaveURL(new RegExp('/auth\\?next='));
      expect(new URL(visitorPage.url()).searchParams.get('next')).toBe(`/app/progress/members/${alex.id}`);
    } finally { await visitor.close(); }
    await samPage.goto(`/app/progress/circle?invite=${alex.id}`);
    await expect(samPage.getByRole('textbox', { name: 'Dima profile link or username', exact: true })).toHaveValue(alex.id);
    expect((await (await other.request.get(`${base}/api/v1/circle`)).json()).data.outgoing).toHaveLength(0);
    await samPage.goto(`/app/progress/members/${alex.id}`);
    await samPage.getByRole('button', { name: 'Request to follow', exact: true }).click();
    await expect(samPage.getByText('Follow request sent. You can manage it in Friends.', { exact: true })).toBeVisible();
    await samPage.goto('/app/progress/circle');
    await expect(samPage.getByRole('button', { name: 'Cancel request', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh friends', exact: true }).click();
    await page.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Follow back', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Follow back', exact: true }).click();
    await samPage.reload();
    await samPage.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(samPage.getByText('You follow each other', { exact: true })).toBeVisible();
    await expect(samPage.getByRole('link', { name: 'Alex Study Partner', exact: true })).toHaveCount(1);
    await samPage.setViewportSize({ width: 1280, height: 920 });
    await samPage.screenshot({ path: '.impeccable/review/friends-refined-desktop.png', fullPage: true });
    await samPage.setViewportSize({ width: 390, height: 844 });
    expect(await samPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await samPage.screenshot({ path: '.impeccable/review/friends-refined-compact.png', fullPage: true });
    await samPage.goto(`/app/progress/members/${alex.id}`);
    await expect(samPage.getByText('No progress shared with you yet. Each person chooses what accepted followers can see.', { exact: true })).toBeVisible();
    await page.goto('/app/progress/sharing');
    await page.getByLabel('Share my weekly time summary with accepted followers', { exact: true }).check();
    await page.getByRole('button', { name: 'Save sharing choices', exact: true }).click();
    await expect(page.getByText('Sharing choices saved.', { exact: true })).toBeVisible();
    await samPage.reload();
    await expect(samPage.getByText('Shared weekly time:', { exact: false })).toBeVisible();
    const shared = (await (await other.request.get(`${base}/api/v1/profiles/${alex.id}/shared`)).json()).data;
    expect(shared.weeklyTimeSeconds).toBe(0);
    expect(shared.courses).toBeUndefined();
  } finally { await other.close(); }
});


test('sharing protects drafts from another device and pausing requests keeps the personal link visible', async ({ page, context }) => {
  test.setTimeout(90000);
  const alex = await learner(context, 'Alex Private');
  await page.goto('/app/progress/sharing');
  await expect(page.getByRole('button', { name: 'Save sharing choices', exact: true })).toBeDisabled();
  await page.getByLabel('Share my weekly time summary with accepted followers', { exact: true }).check();
  const before = (await (await context.request.get(`${base}/api/v1/sharing`)).json()).data;
  expect((await context.request.post(`${base}/api/v1/sharing`, { headers: alex.headers, data: { type: 'setSharing', publicProfile: true, allowFollow: true, bio: 'Saved on another device', weeklyTime: false, courseProgress: false, expectedRevision: before.revision, operationId: randomUUID() } })).status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Your saved choices changed elsewhere.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Share my weekly time summary with accepted followers', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save sharing choices', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.screenshot({ path: '.impeccable/review/sharing-refined-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Use latest sharing choices', exact: true }).click();
  await expect(page.getByLabel('Share my weekly time summary with accepted followers', { exact: true })).not.toBeChecked();
  // A successful save must remain authoritative even if a redundant GET would fail.
  let blockRead = true;
  await page.route('**/api/v1/sharing', route => route.request().method() === 'GET' && blockRead
    ? route.fulfill({ status: 503, json: { error: { code: 'STORAGE_UNAVAILABLE' } } }) : route.continue());
  await page.getByLabel('Allow people to request to follow me', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save sharing choices', exact: true }).click();
  await expect(page.getByText('Sharing choices saved.', { exact: true })).toBeVisible();
  expect((await (await context.request.get(`${base}/api/v1/sharing`)).json()).data).toMatchObject({ allowFollow: false, weeklyTime: false, bio: 'Saved on another device' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/sharing-refined-compact.png', fullPage: true });
  blockRead = false;
  await page.getByRole('link', { name: 'Back to Friends', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your personal link', exact: true })).toHaveValue(`https://dima.study/app/progress/members/${alex.id}`);
  await expect(page.getByRole('button', { name: 'Enable requests & copy link', exact: true })).toBeVisible();
  // Merely viewing the link does not undo the saved opt-out.
  expect((await (await context.request.get(`${base}/api/v1/sharing`)).json()).data.allowFollow).toBe(false);
});
