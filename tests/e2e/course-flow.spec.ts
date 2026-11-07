import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningCommand, LearningData } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(120000);

async function read(context: BrowserContext): Promise<LearningData> {
  const response = await context.request.get(`${base}/api/v1/learning`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function command(context: BrowserContext, data: LearningData, value: Omit<LearningCommand, 'expectedRevision' | 'operationId'> & Record<string, unknown>): Promise<LearningData> {
  const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': data.accountId }, data: { ...value, expectedRevision: data.state.revision, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}
async function setup(context: BrowserContext) {
  const email = `course-flow-${randomUUID()}@example.test`, after = Date.now();
  expect((await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email, next: '/app/courses' } })).status()).toBe(200);
  const token = await waitForLocalOtp(email, { after });
  expect((await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email, token, next: '/app/courses' } })).status()).toBe(200);
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  expect((await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Clarity Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } })).status()).toBe(200);
  let data = await read(context);
  const id = `private-${randomUUID()}`;
  const task = (id: string, title: string) => ({ id, title, position: 0, kind: 'reading', minutes: 20, estimateSource: 'user', requirement: 'required', sourceUrl: 'https://example.edu/course', prerequisiteIds: [] });
  data = await command(context, data, { type: 'saveDraft', draft: { id, title: 'Practical foundations', sourceUrl: 'https://example.edu/course', courses: [
    { id: 'design', title: 'Design basics', position: 0, modules: [{ id: 'design-module', title: 'Design introduction', position: 0, tasks: [task('design-task', 'Explore layout'), {...task('design-practice', 'Practice layout'), position: 1}] }] },
    { id: 'writing', title: 'Writing clearly', position: 1, modules: [{ id: 'writing-module', title: 'Writing introduction', position: 0, tasks: [task('writing-task', 'Practice paragraphs')] }] },
  ] } });
  const target = new Date(`${data.localDay}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + 30);
  return command(context, data, { type: 'enroll', offeringId: id, taskIds: ['design-task', 'design-practice', 'writing-task'], priorTaskIds: ['design-task'], targetDate: target.toISOString().slice(0, 10), estimates: {} });
}
async function capture(page: Page, name: string) {
  mkdirSync('.impeccable/review', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/course-flow-${name}-${width}.png`, fullPage: true });
  }
}

test('Today opens the full course directly; a module can be completed and undone without touching earlier progress', async ({ page, context }) => {
  let data = await setup(context);
  const enrollment = data.state.enrollments[0];
  data = await command(context, data, { type: 'preview', availability: { startDate: data.localDay, weekdayMinutes: [60,60,60,60,60,60,60], reservePercent: 15 }, targets: { [enrollment.id]: enrollment.targetDate }, controls: { useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] }, mode: 'initial' });
  await command(context, data, { type: 'apply', previewId: data.state.previews.at(-1)!.id, acknowledgeUnscheduled: true });
  await page.goto('/app/today');
  await expect(page.getByRole('link', { name: 'Continue course', exact: true })).toHaveAttribute('href', `/app/courses/${enrollment.id}#module-design-module`);
  await expect(page.getByRole('button', { name: 'Worked on', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0);
  await capture(page, 'today');
  await page.getByRole('link', { name: 'Continue course', exact: true }).click();
  const module = page.locator('#module-design-module');
  await expect(module.getByRole('button', { name: /Design introduction/ })).toHaveAttribute('aria-expanded','true');
  await module.getByRole('button', { name: 'Complete module', exact: true }).click();
  await expect(module.getByText('1 activity will be marked done.', { exact: true })).toBeVisible();
  await module.getByRole('radio', { name: 'Completed before joining Dima', exact: true }).check();
  const operationIds: string[] = []; let responseLost = false;
  await page.route('**/api/v1/learning', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().type === 'completeModule') {
      operationIds.push(route.request().postDataJSON().operationId);
      if (!responseLost) { responseLost = true; const saved = await route.fetch(); expect(saved.status()).toBe(200); await route.abort('failed'); return; }
    }
    await route.continue();
  });
  await module.getByRole('button', { name: 'Confirm module completion', exact: true }).click();
  await expect(module.getByRole('alert')).toContainText('Couldn’t update');
  await module.getByRole('button', { name: 'Confirm module completion', exact: true }).click();
  await page.unroute('**/api/v1/learning');
  expect(operationIds).toHaveLength(2); expect(operationIds[0]).toBe(operationIds[1]);
  await expect(module.getByText('Module complete', { exact: true })).toBeVisible();
  data = await read(context);
  expect(data.state.enrollments[0].completions.find(c=>c.taskId==='design-task')?.kind).toBe('prior');
  expect(data.state.enrollments[0].completions.find(c=>c.taskId==='design-practice')).toMatchObject({completed:true,kind:'prior'});
  expect(data.state.workEvents ?? []).toHaveLength(0);
  await capture(page, 'module-complete');
  await module.getByRole('button', { name: 'Undo module completion', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Complete module', exact: true })).toBeVisible();
  data = await read(context);
  expect(data.state.enrollments[0].completions.find(c=>c.taskId==='design-task')?.completed).toBe(true);
  expect(data.state.enrollments[0].completions.find(c=>c.taskId==='design-practice')?.completed ?? false).toBe(false);
  expect(data.state.enrollments[0].completions.some(c=>c.taskId==='writing-task'&&c.completed)).toBe(false);
});

test('courses remain accessible before applying a plan and creating a private course is visible', async ({page,context})=>{
 const data=await setup(context), enrollment=data.state.enrollments[0];
 await page.goto('/app/today');
 const courses=page.getByRole('region',{name:'Your courses',exact:true});
 await expect(courses.getByRole('link',{name:/Practical foundations/})).toHaveAttribute('href',`/app/courses/${enrollment.id}`);
 await page.goto('/app/courses');
 await expect(page.getByRole('link',{name:'Create my own course',exact:true})).toHaveAttribute('href','/app/courses/new');
 await expect(page.getByRole('link',{name:'Request library publication',exact:true})).toHaveAttribute('href',`/app/contributions?draft=${enrollment.offeringId}`);
});
