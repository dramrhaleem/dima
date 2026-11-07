import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { MilestoneData, MilestoneCommand } from '../../packages/client/src/milestones';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';

test('milestones keep one course row, preview sharing in place and preserve explicit consent', async ({ page, context }) => {
  test.setTimeout(90000);
  const email = `milestones-ui-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: { Origin: base }, data: { email, next: '/app/progress/milestones' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: { Origin: base }, data: { email, token, next: '/app/progress/milestones' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { Origin: base, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Alex Milestone', timezone: 'UTC', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  // Controlled milestone snapshots verify presentation and commands; server permission tests remain separate.
  let state: MilestoneData = { candidates: [], mine: [], feed: [], verifiedAt: new Date().toISOString() };
  const writes: MilestoneCommand[] = [];
  const scopeId = 'course-version-one', milestoneId = randomUUID(), friendMilestone = randomUUID();
  let holdRefresh: Promise<void> | null = null;
  await page.route('**/api/v1/shared-milestones**', async route => {
    const request = route.request();
    if (request.url().endsWith('/preview')) return route.fulfill({ json: { data: { scopeId, title: 'Project essentials', displayName: 'Alex Milestone', audience: 'accepted-followers', revision: 1, workspaceRevision: 2, previewToken: 'a'.repeat(32), followerCount: 0 } } });
    if (request.method() === 'POST') {
      const command = request.postDataJSON() as MilestoneCommand;
      writes.push(command);
      if (command.type === 'publish') {
        state.candidates[0].published = true;
        state.candidates[0].milestoneId = milestoneId;
        state.mine = [{ id: milestoneId, scopeId, title: 'Project essentials', revision: 1, publishedAt: new Date().toISOString(), revokedAt: null, eligible: true }];
        state.feed.push({ id: milestoneId, profileId: account.accountId, displayName: 'Alex Milestone', title: 'Project essentials', publishedAt: new Date().toISOString(), encouragements: 0, encouraged: false });
      } else if (command.type === 'revoke') {
        state.candidates[0].published = false;
        state.candidates[0].milestoneId = null;
        state.mine[0].revokedAt = new Date().toISOString();
        state.feed = state.feed.filter(item => item.id !== milestoneId);
      } else {
        state.feed[0].encouraged = true;
        state.feed[0].encouragements++;
      }
    } else if (holdRefresh) await holdRefresh;
    return route.fulfill({ json: { data: state } });
  });
  await page.goto('/app/progress/milestones');
  await expect(page.getByRole('link', { name: 'Continue a course', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find your friends', exact: true })).toBeVisible();
  await expect(page.getByText('No milestones shared with you yet.', { exact: true })).toBeVisible();
  state = {
    ...state,
    candidates: [{ scopeId, title: 'Project essentials', revision: 1, milestoneId: null, published: false }],
    feed: [{ id: friendMilestone, profileId: randomUUID(), displayName: 'Sam Learning', title: 'Thinking in systems', publishedAt: '2026-11-01T12:00:00Z', encouragements: 2, encouraged: false }],
  };
  await page.getByRole('button', { name: 'Refresh milestones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project essentials', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Preview sharing', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Milestone sharing preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'Your milestone preview', exact: true })).toBeFocused();
  await expect(preview.getByText(/You have no accepted followers yet/)).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Share milestone', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview sharing', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Preview sharing', exact: true }).click();
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: 'Share milestone', exact: true }).click();
  await expect(page.getByText('Shared with your accepted followers.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project essentials', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toHaveCount(1);
  expect(writes[0]).toMatchObject({ type: 'publish', scopeId, audience: 'accepted-followers', acknowledgeSharing: true });
  // Revalidation leaves the existing feed in place and disables duplicate manual refreshes.
  let release!: () => void;
  holdRefresh = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Refresh milestones', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Thinking in systems', exact: true })).toBeVisible();
  release(); holdRefresh = null;
  await expect(page.getByRole('button', { name: 'Refresh milestones', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Keep going!', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encouragement sent', exact: true })).toBeDisabled();
  await expect(page.getByText('3 encouragements', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.screenshot({ path: '.impeccable/review/milestones-refined-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/milestones-refined-compact.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(page.getByText('Milestone sharing withdrawn.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview sharing', exact: true })).toBeVisible();
  expect(writes.at(-1)).toMatchObject({ type: 'revoke', milestoneId, expectedRevision: 1 });
});
