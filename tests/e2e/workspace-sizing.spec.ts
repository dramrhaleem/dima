import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { LearningData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const artifacts = process.env.DIMA_SIZING_ARTIFACTS ?? '.impeccable/review/workspace-sizing';

test('workspace stays readable on wide displays and reflows at narrow widths', async ({ page, context }) => {
  test.setTimeout(120000);
  mkdirSync(artifacts, { recursive: true });
  const email = `sizing-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: { Origin: base }, data: { email, next: '/app/library' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: { Origin: base }, data: { email, token, next: '/app/library' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data;
  const headers = { Origin: base, 'X-Dima-Account-Id': account.accountId };
  expect((await context.request.patch(`${base}/api/v1/me`, { headers, data: { displayName: 'Layout Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  let data: LearningData = (await (await context.request.get(`${base}/api/v1/learning`)).json()).data;
  async function command(value: Record<string, unknown>) {
    const result = await context.request.post(`${base}/api/v1/learning`, { headers, data: { ...value, expectedRevision: data.state.revision, operationId: randomUUID() } });
    expect(result.status(), await result.text()).toBe(200);
    data = (await result.json()).data;
  }
  const offeringId = `private-${randomUUID()}`;
  const target = new Date(`${data.localDay}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + 30);
  await command({ type: 'saveDraft', draft: { id: offeringId, title: 'A practical course', sourceUrl: 'https://example.edu/course', courses: [{ id: 'course', title: 'Course', position: 0, modules: [{ id: 'module', title: 'Practice', position: 0, tasks: ['start', 'practice'].map((id, position) => ({ id, title: position ? 'Practice a useful skill' : 'Read the introduction', position, kind: 'assignment', minutes: position ? 60 : 20, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] })) }] }] } });
  await command({ type: 'enroll', offeringId, taskIds: ['start', 'practice'], priorTaskIds: [], targetDate: target.toISOString().slice(0, 10), estimates: {} });
  await command({ type: 'preview', availability: { startDate: data.localDay, weekdayMinutes: [60, 60, 60, 60, 60, 60, 60], reservePercent: 15 }, targets: Object.fromEntries(data.state.enrollments.map(item => [item.id, item.targetDate])), controls: { useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] }, mode: 'initial' });
  await command({ type: 'apply', previewId: data.state.previews.at(-1)!.id, acknowledgeUnscheduled: false });
  const metrics: unknown[] = [];
  async function inspect(page: Page, label: string, screenshot = true) {
    await expect(page.locator('.workspace-content')).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal overflow`).toBe(true);
    // Visible controls should not clip their own labels at the new scale.
    const clipped = await page.locator('.workspace-content button, .workspace-content input').evaluateAll(elements => elements.filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && element.tagName !== 'INPUT' && element.scrollWidth > element.clientWidth + 2;
    }).map(element => element.textContent));
    expect(clipped, `${label}: clipped controls`).toEqual([]);
    if (screenshot) await page.screenshot({ path: `${artifacts}/${label}.png`, fullPage: true });
  }
  await page.goto('/app/library');
  await expect(page.locator('.learning-course-copy').first()).toBeVisible();
  for (const width of [1280, 1440, 1920, 2048, 2560, 960, 390]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1080 });
    await inspect(page, `library-${width}`, [1280, 1920, 2048, 390].includes(width));
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.querySelector('.workspace-content')!.getBoundingClientRect().width, navFont: parseFloat(getComputedStyle(document.querySelector('.workspace-sidebar .account-nav-link')!).fontSize), cardFont: parseFloat(getComputedStyle(document.querySelector('.learning-course-copy p')!).fontSize), zoom: getComputedStyle(document.querySelector('.workspace')!).zoom }));
    metrics.push(sizes);
    expect(sizes.zoom).toBe('1');
    if (width === 1920) { expect(sizes.content).toBeGreaterThan(1300); expect(sizes.navFont).toBeGreaterThanOrEqual(17); expect(sizes.cardFont).toBeGreaterThanOrEqual(16); }
    if (width === 1280) { expect(sizes.navFont).toBe(13); expect(sizes.cardFont).toBe(12); }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const [route, label] of [['/app/today', 'today'], ['/app/plan', 'plan'], [`/app/courses/${data.state.enrollments[0].id}`, 'course'], ['/app/focus', 'focus'], ['/app/rooms', 'rooms'], ['/app/progress/circle', 'friends'], ['/app/progress/sharing', 'sharing'], ['/app/progress/milestones', 'milestones'], ['/app/settings', 'settings']]) {
    await page.goto(route);
    if (label === 'today') await expect(page.getByRole('link', { name: 'Continue course', exact: true })).toBeVisible();
    if (label === 'plan') {
      await expect(page.getByRole('heading', { name: 'Your next 7 days', exact: true })).toBeVisible();
      expect((await page.locator('.plan-workspace').boundingBox())!.width).toBeGreaterThan(1300);
    }
    if (label === 'course') await expect(page.getByRole('heading', { name: 'Course outline', exact: true })).toBeVisible();
    if (label === 'milestones') await expect(page.getByRole('button', { name: 'Refresh milestones', exact: true })).toBeEnabled();
    if (label === 'rooms') {
      await expect(page.getByRole('button', { name: 'Search rooms', exact: true })).toBeVisible();
      await expect(page.locator('.room-filter-toggle')).toBeHidden();
    }
    await inspect(page, `${label}-1920`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await inspect(page, 'settings-390');
  await page.goto('/app/progress/circle');
  await expect(page.getByRole('textbox', { name: 'Your personal link', exact: true })).toBeVisible();
  await inspect(page, 'friends-390');
  writeFileSync(`${artifacts}/metrics.json`, JSON.stringify(metrics, null, 2));
});
