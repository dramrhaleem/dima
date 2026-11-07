import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AccountData, LearningData, LearningCommand, RecoveryControls } from '../../packages/contracts/src/index';
import { waitForLocalOtp } from '../helpers/local-mail.mjs';
import { seedSyntheticLearningState } from '../helpers/learning-fixture.mjs';

const base = 'http://127.0.0.1:8787';
const origin = { Origin: base };
test.setTimeout(150000);
async function signIn(context: BrowserContext, recipient: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = Date.now(); const sent = await context.request.post(`${base}/api/v1/auth/otp`, { headers: origin, data: { email: recipient, next: '/app/today' } });
    if (sent.status() === 429 && attempt < 19) { await new Promise(resolve => setTimeout(resolve, 4000)); continue; }
    expect(sent.status()).toBe(200); const token = await waitForLocalOtp(recipient, { after });
    const verified = await context.request.post(`${base}/api/v1/auth/verify`, { headers: origin, data: { email: recipient, token, next: '/app/today' } }); expect(verified.status()).toBe(200); return;
  }
}
async function setup(context: BrowserContext, recipient = `b3-${randomUUID()}@example.test`) {
  await signIn(context, recipient); const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  const result = await context.request.patch(`${base}/api/v1/me`, { headers: { ...origin, 'X-Dima-Account-Id': account.accountId }, data: { displayName: 'Casey Learner', timezone: 'Africa/Cairo', intent: 'learning', appearance: 'light', reducedMotion: true, onboarded: true, expectedRevision: account.profile?.revision ?? 0, operationId: randomUUID() } }); expect(result.status()).toBe(200); return recipient;
}
async function learning(context: BrowserContext) { const response = await context.request.get(`${base}/api/v1/learning`); expect(response.status()).toBe(200); return (await response.json()).data as LearningData; }
async function command(context: BrowserContext, state: LearningData, value: Omit<LearningCommand, 'expectedRevision' | 'operationId'> & Record<string, unknown>) {
  const response = await context.request.post(`${base}/api/v1/learning`, { headers: { ...origin, 'X-Dima-Account-Id': state.accountId }, data: { ...value, expectedRevision: state.state.revision, operationId: randomUUID() } }); expect(response.status(), await response.text()).toBe(200); return (await response.json()).data as LearningData;
}
async function course(context: BrowserContext, activities: Array<{ id: string; title: string; minutes: number | null }>) {
  let state = await learning(context); const id = `private-${randomUUID()}`;
  const tasks = activities.map((task, position) => ({ ...task, position, kind: 'assignment', estimateSource: task.minutes === null ? 'missing' : 'user', requirement: 'required', sourceUrl: 'https://example.com/learning', prerequisiteIds: [] }));
  state = await command(context, state, { type: 'saveDraft', draft: { id, title: 'A realistic learning path', sourceUrl: 'https://example.com/learning', courses: [{ id: 'course', title: 'A realistic learning path', position: 0, modules: [{ id: 'module', title: 'Useful practice', position: 0, tasks }] }] } });
  return command(context, state, { type: 'enroll', offeringId: id, taskIds: tasks.map(task => task.id), priorTaskIds: [], targetDate: state.localDay, estimates: {} });
}
const controls = (): RecoveryControls => ({ useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] });
async function plan(context: BrowserContext, state: LearningData, settings = controls()) {
  state = await command(context, state, { type: 'preview', availability: { startDate: state.localDay, weekdayMinutes: [180, 180, 180, 180, 180, 180, 180], reservePercent: 15 }, targets: Object.fromEntries(state.state.enrollments.map(enrollment => [enrollment.id, enrollment.targetDate])), controls: settings, mode: 'initial' });
  return command(context, state, { type: 'apply', previewId: state.state.previews.at(-1)!.id, acknowledgeUnscheduled: true });
}
async function capture(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: 920 }); await expect(page.locator('.workspace-content .learning-root')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('.impeccable/review', { recursive: true }); await page.screenshot({ path: `.impeccable/review/b3-${name}.png`, fullPage: true });
}

test('partial work stays distinct, unknown is explicit, completion uses remainder and corrections keep real work', async ({ page, context }) => {
  await setup(context); let state = await course(context, [{ id: 'practice', title: 'Develop a useful skill', minutes: 120 }]); const enrollment = state.state.enrollments[0];
  await page.goto(`/app/courses/${enrollment.id}/tasks/practice`); await expect(page.getByRole('heading', { name: 'Develop a useful skill', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Move to another day', exact: true }).click();
  const tomorrow = new Date(`${state.localDay}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await expect(page.getByLabel('Pin 1 date', { exact: true })).toHaveValue(tomorrow.toISOString().slice(0, 10));
  expect((await learning(context)).state.plan).toBeNull();
  await page.goto(`/app/courses/${enrollment.id}/tasks/practice`);
  await page.getByRole('button', { name: 'Log partial progress', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Time spent studying (your estimate)', { exact: true }).fill('40');
  await expect(dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true })).toHaveValue('80');
  await expect(dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true })).not.toBeChecked();
  const operations: string[] = []; let lost = false;
  await page.route('**/api/v1/learning', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().type === 'worked') { operations.push(route.request().postDataJSON().operationId); if (!lost) { lost = true; const saved = await route.fetch(); expect(saved.status()).toBe(200); await route.abort('failed'); return; } }
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Save partial work', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Couldn’t save');
  await dialog.getByRole('button', { name: 'Save partial work', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(operations[0]).toBe(operations[1]); await page.unroute('**/api/v1/learning');
  await expect(page.getByText('Remaining unknown', { exact: true })).toBeVisible(); state = await learning(context); expect(state.state.workEvents?.filter(event => !event.invalidatedAt)).toHaveLength(1); expect(state.state.enrollments[0].completions).toHaveLength(0);
  await page.getByRole('button', { name: 'Review remaining work', exact: true }).click(); await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('80'); await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check(); await dialog.getByRole('button', { name: 'Save remaining work', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark activity done', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.locator('.quick-completion').getByRole('status')).toHaveText('Completed'); await expect(page.locator('.quick-completion summary')).toContainText('80 min');
  state = await learning(context); expect(state.state.workEvents?.filter(event => !event.invalidatedAt).reduce((sum, event) => sum + (event.effortMinutes ?? 0), 0)).toBe(120);
  await expect(page.getByRole('link', { name: 'Move to another day', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mark activity done', exact: true })).toBeVisible();
  state = await learning(context); expect(state.state.workEvents?.filter(event => !event.invalidatedAt).map(event => event.effortMinutes)).toEqual([40]); await expect(page.getByText('80 min remaining', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark activity done', exact: true }).click(); await expect(page.locator('.quick-completion').getByRole('status')).toHaveText('Completed'); await page.locator('.quick-completion summary').click();
  await page.getByRole('button', { name: 'Review completion', exact: true }).click(); await dialog.getByRole('button', { name: 'Reopen · keep recorded work', exact: true }).click(); await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('25'); await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check(); await dialog.getByRole('button', { name: 'Reopen with recorded work', exact: true }).click(); await expect(dialog).toHaveCount(0);
  state = await learning(context); expect(state.state.enrollments[0].completions[0].completed).toBe(false); expect(state.state.workEvents?.filter(event => !event.invalidatedAt).reduce((sum, event) => sum + (event.effortMinutes ?? 0), 0)).toBe(120);
  await page.getByRole('button', { name: 'Log partial progress', exact: true }).click(); await dialog.getByRole('checkbox', { name: 'I don’t know the effort yet', exact: true }).check(); await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('10'); await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check(); await dialog.getByRole('button', { name: 'Save partial work', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Resolve unknown effort', exact: true }).click(); await page.getByLabel('Accepted effort (minutes)', { exact: true }).fill('15'); await page.getByRole('button', { name: 'Save effort estimate', exact: true }).click(); await expect(page.getByRole('button', { name: 'Resolve unknown effort', exact: true })).toHaveCount(0);
  await capture(page, 'work-desktop', 1280); await capture(page, 'work-mobile', 375); await capture(page, 'work-small', 320);
});

test('recovery preserves conflicting inputs, honors explicit pins and does not offer fulfilled pin work again', async ({ page, context }) => {
  await setup(context); let state = await course(context, [{ id: 'practice', title: 'Develop a useful skill', minutes: 100 }, { id: 'reflect', title: 'Reflect on the result', minutes: 70 }]); const enrollment = state.state.enrollments[0]; await plan(context, state);
  await page.goto('/app/plan/recovery'); await page.getByText('Pin work to a date', { exact: true }).click(); await page.getByRole('button', { name: 'Add a pinned block', exact: true }).click(); await page.getByLabel('Pin 1 minutes', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Preview revised plan', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Resolve these choices first', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Resolve conflicts before applying', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Review dates and pinned work', exact: true }).click(); await expect(page.getByLabel('Pin 1 minutes', { exact: true })).toHaveValue('120'); await page.getByLabel('Pin 1 minutes', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Preview revised plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Save revised plan', exact: true })).toBeEnabled(); await capture(page, 'recovery-desktop', 1280); await capture(page, 'recovery-tablet', 768); await capture(page, 'recovery-mobile', 375);
  await page.getByRole('button', { name: 'Save revised plan', exact: true }).click(); await page.goto(`/app/courses/${enrollment.id}/tasks/practice`); await page.getByRole('button', { name: 'Log partial progress', exact: true }).click(); const dialog = page.getByRole('dialog'); const current = await learning(context); await dialog.getByRole('combobox', { name: 'This work belongs to', exact: true }).selectOption(current.state.plan!.controls!.pins[0].id); await dialog.getByLabel('Time spent studying (your estimate)', { exact: true }).fill('45'); await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('55'); await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check(); await dialog.getByRole('button', { name: 'Save partial work', exact: true }).click(); await expect(dialog).toHaveCount(0);
  state = await learning(context); const accepted = state.state.workEvents?.find(event => event.source === 'worked' && !event.invalidatedAt); expect(accepted?.pinId).toBe(state.state.plan?.controls?.pins[0].id); expect(accepted?.effortMinutes).toBe(45);
  await page.getByRole('button', { name: 'Log partial progress', exact: true }).click(); await expect(dialog.getByRole('combobox', { name: 'This work belongs to', exact: true })).toHaveCount(0); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto(`/app/courses/${enrollment.id}/tasks/practice`); await expect(page.getByText('55 min remaining', { exact: true })).toBeVisible();
});

test('partial apply is explicit, pause retains work, and undo recovery preserves newer completion', async ({ page, context, browser }) => {
  const recipient = await setup(context); let state = await course(context, [{ id: 'known', title: 'A clear next step', minutes: 30 }, { id: 'unknown', title: 'A project to estimate', minutes: null }]); const enrollment = state.state.enrollments[0];
  await page.goto('/app/plan/recovery'); await page.getByRole('button', { name: 'Preview revised plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Apply feasible part', exact: true })).toBeDisabled(); await page.getByRole('checkbox', { name: /I understand that 1 activity remains unscheduled/ }).check(); await page.getByRole('button', { name: 'Apply feasible part', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Activities needing attention', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Confirm remaining work · 1', exact: true })).toBeVisible();
  await page.goto('/app/plan/recovery'); await page.getByText('Pause and resume', { exact: true }).click(); await page.getByRole('button', { name: 'Add a pause', exact: true }).click(); await page.getByRole('button', { name: 'Preview revised plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Apply pause', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Apply pause', exact: true }).click(); await expect(page.getByRole('heading', { name: '2 paused activities stay saved', exact: true })).toBeVisible();
  const second = await browser.newContext({ baseURL: base });
  try { await signIn(second, recipient); state = await learning(second); await command(second, state, { type: 'complete', enrollmentId: enrollment.id, taskId: 'known', effortMinutes: 30 }); } finally { await second.close(); }
  await page.goto('/app/plan'); await page.getByRole('button', { name: 'Preview undo recovery', exact: true }).click();
  // If a stale local snapshot was used, the revision conflict requires an explicit refresh/retry.
  if (await page.getByRole('button', { name: 'Refresh saved version', exact: true }).isVisible()) { await page.getByRole('button', { name: 'Refresh saved version', exact: true }).click(); await page.getByRole('button', { name: 'Preview undo recovery', exact: true }).click(); }
  await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible(); state = await learning(context); expect(state.state.enrollments[0].completions.some(value => value.taskId === 'known' && value.completed)).toBe(true); expect(state.state.previews.at(-1)?.mode).toBe('undo'); expect(state.state.plan?.result.status).toBe('paused'); await expect(page.getByRole('link', { name: 'Keep draft and return', exact: true })).toBeVisible();
  await capture(page, 'zero-work-draft-mobile', 375);
});

test('two missed study days offer a real small step and rest stays an unapplied preview', async ({ page, context }) => {
  await setup(context); let state = await course(context, [{ id: 'practice', title: 'Develop a useful skill', minutes: 120 }, { id: 'reflect', title: 'Reflect on the result', minutes: 30 }]); state = await plan(context, state);
  const shift = (count: number) => { const date = new Date(`${state.localDay}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); };
  const previous = structuredClone(state.state); const savedPlan = previous.plan!;
  savedPlan.result.blocks = [{ enrollmentId: previous.enrollments[0].id, taskId: 'practice', day: shift(-2), minutes: 45, part: 1, ready: true }, { enrollmentId: previous.enrollments[0].id, taskId: 'reflect', day: shift(-1), minutes: 30, part: 1, ready: true }];
  savedPlan.result.days = [-2, -1].map((offset, index) => ({ day: shift(offset), ceiling: 180, reserve: 27, used: index === 0 ? 45 : 30, accepted: 0 })); savedPlan.availability.startDate = shift(-2); savedPlan.localDay = shift(-2); savedPlan.appliedAt = `${shift(-2)}T08:00:00.000Z`;
  const account = (await (await context.request.get(`${base}/api/v1/me`)).json()).data as AccountData;
  await seedSyntheticLearningState(state.accountId, previous, account.profile!.revision);
  await page.goto('/app/plan');
  await expect(page.getByText('Pick up where you left off', { exact: true })).toBeVisible();
  await expect(page.locator('.plan-update-note')).toContainText('Unfinished activities from 2 earlier study days need a new place.');
  await expect(page.getByRole('button', { name: 'Refresh forecast', exact: true })).toBeEnabled();
  expect((await learning(context)).state.plan!.id).toBe(savedPlan.id);
  await page.goto('/app/today'); await expect(page.getByText('Two study days need a new place.', { exact: false })).toBeVisible();
  await capture(page, 'return-desktop', 1280); await capture(page, 'return-mobile', 375);
  await page.getByRole('button', { name: 'Record a small step · 15 min', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('Time spent studying (your estimate)', { exact: true })).toHaveValue('15');
  await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check(); await dialog.getByRole('button', { name: 'Save partial work', exact: true }).click(); await expect(dialog).toHaveCount(0);
  state = await learning(context); expect(state.state.enrollments[0].completions).toHaveLength(0); expect(state.state.workEvents?.filter(event => !event.invalidatedAt).map(event => event.effortMinutes)).toEqual([15]);
  const appliedId = state.state.plan!.id; await page.getByText('Change today’s plan', { exact: true }).click(); await page.getByRole('link', { name: 'Take a rest day', exact: true }).click(); await expect(page.getByLabel('Exception 1 minutes', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Preview revised plan', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Review your study plan.', exact: true })).toBeVisible(); await page.getByText('What changes from my current plan?', { exact: true }).click(); await expect(page.getByRole('heading', { name: 'Proposed schedule', exact: true })).toBeVisible(); state = await learning(context); expect(state.state.plan!.id).toBe(appliedId); expect(state.state.previews.at(-1)?.controls?.exceptions[state.localDay]).toBe(0); expect(state.state.previews.at(-1)?.result.blocks.some(block => block.day === state.localDay)).toBe(false);
  await page.getByText('Daily workload and rest-day changes', { exact: true }).click();
  const restLabel = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${state.localDay}T12:00:00Z`));
  await expect(page.getByText(`${restLabel} · rest day`, { exact: true })).toBeVisible();
  await capture(page, 'return-rest-preview-mobile', 375);
});

test('quiet refresh preserves a partial-work draft when another device completes the same activity', async ({ page, context, browser }) => {
  const recipient = await setup(context); const state = await course(context, [{ id: 'practice', title: 'Develop a useful skill', minutes: 120 }]); const enrollment = state.state.enrollments[0];
  await page.goto(`/app/courses/${enrollment.id}/tasks/practice`); await page.getByRole('button', { name: 'Log partial progress', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Time spent studying (your estimate)', { exact: true }).fill('40'); await dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true }).fill('80'); await dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true }).check();
  const second = await browser.newContext({ baseURL: base });
  try { await signIn(second, recipient); const other = await learning(second); await command(second, other, { type: 'complete', enrollmentId: enrollment.id, taskId: 'practice', effortMinutes: 120 }); } finally { await second.close(); }
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(dialog.getByRole('alert')).toContainText('completion changed elsewhere');
  await expect(dialog.getByLabel('Time spent studying (your estimate)', { exact: true })).toHaveValue('40'); await expect(dialog.getByLabel('Remaining work after this (estimated minutes)', { exact: true })).toHaveValue('80'); await expect(dialog.getByRole('checkbox', { name: 'I confirm this remaining estimate', exact: true })).toBeChecked(); await expect(dialog.getByRole('button', { name: 'Save partial work', exact: true })).toBeDisabled();
  await capture(page, 'draft-retained-mobile', 375); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('button', { name: 'Review completion', exact: true })).toBeVisible();
});
