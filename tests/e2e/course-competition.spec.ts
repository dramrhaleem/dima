import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
test('course competition shows comparable coverage, tied ranks, own place and safe navigation', async ({ page, context }) => {
  test.setTimeout(90000);
  // Real local login, synthetic score snapshots: this tests presentation, not score computation.
  const email = `b6-course-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: { Origin: base }, data: { email, next: '/app/progress' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: { Origin: base }, data: { email, token, next: '/app/progress' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { Origin: base, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Course Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  const enrollment = randomUUID(), privateProfile = randomUUID();
  const scope = { id: 'course-test-scope', offeringId: 'google-project-management', title: 'Google Project Management' };
  const snapshot = { scope: scope.id, scoringVersion: 'test', window: null, calculatedAt: new Date().toISOString(), generation: 'test', correctedAt: null, unit: 'weight', requiredWeight: 80, participation: { enabled: true, revision: 0, canParticipate: true }, scopes: [scope], rows: [
    { profileId: privateProfile, displayName: 'Private Profile Learner', rank: 1, score: 40, profileVisible: false },
    { profileId: account.accountId, displayName: 'Course Learner', rank: 1, score: 40, profileVisible: true },
    { profileId: randomUUID(), displayName: 'Next Learner', rank: 3, score: 20, profileVisible: true },
  ] };
  await page.route('**/api/v1/leaderboards/time?**', route => route.fulfill({ json: { data: snapshot } }));
  let courseRequests = 0;
  await page.route('**/api/v1/leaderboards/course/**', route => { courseRequests++; return route.fulfill({ json: { data: snapshot } }); });
  await page.clock.install();
  await page.goto(`/app/progress/leaderboards?offering=${scope.offeringId}&return=${enrollment}`);
  await expect(page.getByRole('heading', { name: scope.title, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Window', exact: true })).toHaveValue('overall');
  await expect(page.getByRole('link', { name: /Back to course$/ })).toHaveAttribute('href', `/app/courses/${enrollment}`);
  await expect(page.locator('.community-your-position')).toContainText('Your place: #1 · 50% completed');
  await expect(page.getByText('Joint lead', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('progressbar', { name: 'Course Learner: course progress', exact: true })).toHaveAttribute('value', '50');
  await expect(page.getByRole('link', { name: 'Private Profile Learner', exact: true })).toHaveCount(0);
  await expect(page.getByText('Private Profile Learner', { exact: true })).toBeVisible();
  await expect(page.locator('[data-advanced]')).toHaveCount(0);
  await expect(page.getByText('Updates every 20 seconds while this page is open', {exact:true})).toBeVisible();
  await expect(page.getByRole('link', {name:'See classmates in the outline', exact:true})).toHaveAttribute('href', `/app/courses/${enrollment}#course-companions`);
  // A new observed score earns feedback; corrections and a fresh filter do not.
  snapshot.calculatedAt = new Date(Date.parse(snapshot.calculatedAt) + 1000).toISOString();
  snapshot.rows[1].score = 60;
  snapshot.rows[0].rank = 2;
  snapshot.rows = [snapshot.rows[1], snapshot.rows[0], snapshot.rows[2]];
  const requestsBeforeTick = courseRequests;
  await page.clock.fastForward(20000);
  await expect(page.locator('.community-your-position')).toContainText('75% completed');
  expect(courseRequests).toBeGreaterThan(requestsBeforeTick);
  const ownRow = page.locator(`[data-profile="${account.accountId}"]`);
  await expect(ownRow).toHaveAttribute('data-advanced','true');
  await expect(ownRow.locator('.community-score-gain')).toHaveText('+25% of course');
  await expect(page.locator('.community-motion-announcement')).toContainText('Course Learner added 25% of course');
  // The saved reduce-motion preference leaves a static gain label, with no burst.
  await expect(ownRow.locator('.community-score-burst i').first()).toHaveCSS('display','none');
  snapshot.calculatedAt = new Date(Date.parse(snapshot.calculatedAt) + 1000).toISOString();
  snapshot.rows[0].score = 40;
  snapshot.rows[1].rank = 1;
  await page.getByRole('button', {name:'Refresh results', exact:true}).click();
  await expect(page.locator('.community-your-position')).toContainText('50% completed');
  await expect(page.locator('[data-advanced]')).toHaveCount(0);
  mkdirSync('.impeccable/review', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 920 });
  await page.screenshot({ path: '.impeccable/review/course-competition-1280.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.impeccable/review/course-competition-390.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Window', exact: true }).selectOption('week');
  await expect(page.locator('.community-your-position')).toContainText('50% added this week');
  await expect(page.locator('[data-advanced]')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Course Learner: course progress added this week', exact: true })).toBeVisible();
  await page.goto(`/app/progress/leaderboards?offering=${scope.offeringId}&return=https://evil.test`);
  await expect(page.getByRole('link', { name: /Back to course$/ })).toHaveCount(0);
  await expect(page.locator('.community-board-back')).toHaveAttribute('href', `/app/library/${scope.offeringId}`);
});
