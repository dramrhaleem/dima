import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningData, PublicationData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
async function signIn(context: BrowserContext, role: string) {
  const email = `publication-ui-${role}-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: { Origin: base }, data: { email, next: '/app/courses' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: { Origin: base }, data: { email, token, next: '/app/courses' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { Origin: base, 'X-Dima-Account-Id': account.accountId }, data: { displayName: `Publication ${role}`, timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  return { id: account.accountId, email };
}

test('private course requests show pending status, revise safely, and publish only after admin review', async ({ page, context, browser }) => {
  test.setTimeout(120000);
  const owner = await signIn(context, 'author');
  const draftId = `private-${randomUUID()}`, title = `Publication journey ${randomUUID().slice(0, 8)}`;
  const data = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data as LearningData;
  const saved = await context.request.post(`${base}/api/v1/learning`, { headers: { Origin: base, 'X-Dima-Account-Id': owner.id }, data: { type: 'saveDraft', operationId: randomUUID(), expectedRevision: data.state.revision, draft: { id: draftId, title, sourceUrl: 'https://example.edu/course', courses: [{ id: 'course', title, position: 0, modules: [{ id: 'module', title: 'First steps', position: 0, tasks: [{ id: 'task', title: 'Learn the essentials', kind: 'reading', position: 0, minutes: 15, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] }] }] }] } } });
  expect(saved.status()).toBe(200);
  await page.goto(`/app/contributions?draft=${draftId}`);
  await expect(page.getByRole('heading', { name: 'Request library publication', exact: true })).toBeVisible();
  await page.getByLabel('Original provider or author', { exact: true }).fill('Synthetic curriculum author');
  await page.getByLabel('What this course covers', { exact: true }).fill('A small original curriculum for learning the essentials.');
  await page.getByLabel('Sources and permission to share', { exact: true }).fill('Original synthetic outline written for this test.');
  const attest = page.getByRole('checkbox', { name: /I have the right to share/ });
  await expect(page.getByRole('button', { name: 'Send to admin for review', exact: true })).toBeDisabled();
  await attest.check();
  await page.getByRole('button', { name: 'Send to admin for review', exact: true }).click();
  await expect(page.getByText('Request sent to the admin.', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting admin review', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Awaiting admin review', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to admin for review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw request', exact: true }).click();
  await expect(page.getByText('Request withdrawn', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Prepare revised request', exact: true }).click();
  await expect(page.getByLabel('Original provider or author', { exact: true })).toHaveValue('Synthetic curriculum author');
  await expect(attest).not.toBeChecked();
  await attest.check();
  await page.getByRole('button', { name: 'Send to admin for review', exact: true }).click();
  await expect(page.getByText('Awaiting admin review', { exact: true })).toBeVisible();
  const requests = (await (await context.request.get(`${base}/api/v1/publication-requests?draft=${draftId}`)).json()).data as PublicationData;
  expect(requests.requests.every(request => request.draftId === draftId)).toBe(true);
  expect(requests.requests.map(request => request.status)).toEqual(['pending', 'withdrawn']);
  const older = (await (await context.request.get(`${base}/api/v1/publication-requests?draft=${draftId}&cursor=${requests.requests[0].id}`)).json()).data as PublicationData;
  expect(older.requests.map(request => request.id)).toEqual([requests.requests[1].id]);
  const pending = requests.requests.find(request => request.status === 'pending')!;
  expect(pending.snapshot).not.toHaveProperty('completions');
  expect(pending.snapshot).not.toHaveProperty('workEvents');
  expect((await context.request.get(`${base}/api/v1/catalog/${pending.offeringId}`)).status()).toBe(404);
  expect((await context.request.get(`${base}/api/v1/admin/reviews`)).status()).toBe(403);
  const adminContext = await browser.newContext();
  try {
    const reviewer = await signIn(adminContext, 'reviewer');
    expect(reviewer.id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(reviewer.email).toMatch(/^publication-ui-reviewer-[a-f0-9-]+@example\.test$/);
    const db = spawnSync('docker', ['inspect', 'dima-b0-db', '--format', '{{index .Config.Labels "com.docker.compose.project"}}'], { encoding: 'utf8' });
    expect(db.status).toBe(0);
    expect(db.stdout.trim()).toBe('dima-b0');
    // Only an exact newly-created synthetic reviewer can receive this local fixture role.
    const grant = spawnSync('docker', ['exec', '-i', 'dima-b0-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { encoding: 'utf8', input: `DO $fixture$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${reviewer.id}' AND email='${reviewer.email}') THEN RAISE EXCEPTION 'Synthetic reviewer required'; END IF; INSERT INTO public.account_roles(user_id,role) VALUES('${reviewer.id}','admin'); END $fixture$;` });
    expect(grant.status).toBe(0);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${base}/app/admin`);
    const card = adminPage.locator('article.community-section').filter({ has: adminPage.getByRole('heading', { name: title, exact: true }) });
    await expect(card).toHaveCount(1);
    await card.getByLabel('Decision reason', { exact: true }).fill('Reviewed synthetic source and original outline.');
    await card.getByRole('button', { name: 'Approve and publish', exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Approved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send to admin for review', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'View library listing', exact: true }).click();
    await expect(page).toHaveURL(`${base}/app/library/${pending.offeringId}`);
    await expect(page.getByRole('heading', { name: title, exact: true, level: 2 })).toBeVisible();
    expect((await context.request.get(`${base}/api/v1/catalog/${pending.offeringId}`)).status()).toBe(200);
    await page.goto(`/app/contributions?draft=${draftId}`);
    mkdirSync('.impeccable/review', { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 920 });
      await expect(page.getByText('Approved', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.impeccable/review/publication-flow-${width}.png`, fullPage: true });
    }
  } finally { await adminContext.close(); }
});
