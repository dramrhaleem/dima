import { expect, it } from 'vitest';
import { makePlan } from '../../packages/domain/src/planner';
import { buildPlanAdvice } from '../../packages/domain/src/planning-advice';
import { addDays } from '../../packages/domain/src/recovery';
import { emptyLearningState } from '../../packages/domain/src/learning';
import type { Availability, LearningState, Offering, PlanSettings, RecoveryControls } from '../../packages/contracts/src/learning';
import seed from '../../apps/web/src/server/data/catalog.json';

const today = '2026-11-01';
const controls = (): RecoveryControls => ({ useBuffer: false, exceptions: {}, priorities: {}, pins: [], pauses: [] });
const task = (id: string, minutes: number | null, prerequisiteIds: string[] = []) => ({ id, title: id, position: 0, kind: 'assignment', minutes, estimateSource: minutes === null ? 'missing' as const : 'user' as const, requirement: 'required' as const, sourceUrl: 'https://example.edu', prerequisiteIds });
function stateFor(groups: Array<ReturnType<typeof task>[]>, target = '2026-11-08'): LearningState {
  return { ...emptyLearningState(), enrollments: groups.map((tasks, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, offeringId: `course-${i}`, snapshot: { id: `course-${i}`, version: '1', title: `Course ${i}`, provider: 'Test', kind: 'course', sourceUrl: 'https://example.edu', summary: '', language: 'English', scopeLabel: 'Required', orderPolicy: 'Source order', courses: [{ id: 'course', title: 'Course', position: 0, modules: [{ id: 'module', title: 'Module', position: 0, tasks }] }] }, taskIds: tasks.map(t => t.id), priorTaskIds: [], targetDate: target, joinedAt: today, estimates: {}, completions: [] })) };
}
function settingsFor(state: LearningState, minutes = [0, 20, 0, 20, 0, 20, 0]): PlanSettings {
  return { availability: { startDate: today, weekdayMinutes: minutes, reservePercent: 15 }, targets: Object.fromEntries(state.enrollments.map(e => [e.id, e.targetDate])), controls: controls() };
}
function calculate(state: LearningState, settings: PlanSettings) {
  const plan = makePlan(state, settings.availability, settings.targets, today, settings.controls, 'UTC');
  return { plan, advice: buildPlanAdvice(state, settings, today, plan, 'UTC') };
}
it('forecasts every known activity beyond the old target+90 cutoff without moving the target', () => {
  const state = stateFor([[task('one', 10000), task('two', 10000)]], '2026-12-01');
  const settings = settingsFor(state, [60, 60, 60, 60, 60, 60, 60]);
  const plan = makePlan(state, settings.availability, settings.targets, today);
  expect(plan.unscheduled).toEqual([]);
  expect(plan.blocks.reduce((n, b) => n + b.minutes, 0)).toBe(20000);
  expect(plan.outcomes[0].forecastDate! > addDays('2026-12-01', 90)).toBe(true);
  expect(plan.outcomes[0].targetDate).toBe('2026-12-01');
  expect(plan.outcomes[0].status).toBe('late');
});
it('offers a verified combined week without using rest days or changing controls and history', () => {
  const state = stateFor([[task('one', 180)], [task('two', 180)]]);
  const settings = settingsFor(state);
  settings.controls.exceptions['2026-11-04'] = 0;
  const before = JSON.stringify({ state, settings });
  const { advice } = calculate(state, settings);
  expect(advice.status).toBe('adjustable');
  expect(advice.suggestedWeeklyMinutes).toBeGreaterThan(advice.currentWeeklyMinutes);
  expect(advice.suggestedWeekdayMinutes?.filter((_, index) => settings.availability.weekdayMinutes[index] === 0)).toEqual([0, 0, 0, 0]);
  const result = makePlan(state, { ...settings.availability, weekdayMinutes: advice.suggestedWeekdayMinutes! }, settings.targets, today, settings.controls);
  expect(result.unscheduled).toEqual([]);
  expect(result.outcomes.every(o => o.forecastDate! <= o.targetDate)).toBe(true);
  expect(result.blocks.some(b => b.day === '2026-11-04')).toBe(false);
  expect(JSON.stringify({ state, settings })).toBe(before);
});
it('does not mistake provisional for on-time or invent missing estimates', () => {
  const state = stateFor([[task('one', 500)]]);
  state.enrollments[0].snapshot.courses[0].modules[0].tasks[0].estimateSource = 'provisional';
  const first = calculate(state, settingsFor(state));
  expect(first.plan.status).toBe('provisional');
  expect(first.advice.status).toBe('adjustable');
  const unknown = stateFor([[task('one', null)]]);
  const result = calculate(unknown, settingsFor(unknown));
  expect(result.advice.status).toBe('needs-input');
  expect(result.advice.suggestedWeekdayMinutes).toBeUndefined();
  expect(result.plan.outcomes[0].forecastDate).toBeNull();
});
it('has actionable zero-day and past-target states but accepts sufficient dated-only capacity', () => {
  const state = stateFor([[task('one', 30)]]);
  const settings = settingsFor(state, [0, 0, 0, 0, 0, 0, 0]);
  expect(calculate(state, settings).advice.status).toBe('no-study-days');
  settings.controls.exceptions[today] = 60;
  expect(calculate(state, settings).advice.status).toBe('on-track');
  const overdue = stateFor([[task('one', 30)]], '2026-01-01');
  const result = calculate(overdue, settingsFor(overdue));
  expect(result.plan.outcomes[0].forecastDate).not.toBeNull();
  expect(result.advice.status).toBe('unavailable');
});
it('honors finite pauses beyond the old cutoff and never offers a plan for open-ended paused work', () => {
  const state = stateFor([[task('one', 30)]], '2026-11-08');
  const settings = settingsFor(state, [60, 60, 60, 60, 60, 60, 60]);
  settings.controls.pauses = [{ id: 'pause', enrollmentId: null, startDate: today, resumeDate: '2027-05-01' }];
  const resumed = calculate(state, settings);
  expect(resumed.plan.outcomes[0].forecastDate).toBe('2027-05-01');
  expect(resumed.advice.status).toBe('unavailable');
  settings.controls.pauses[0].resumeDate = null;
  expect(calculate(state, settings).advice.status).toBe('needs-input');
});
it('does not offer more weekly time as a fix for conflicting dated pins or missing prerequisites', () => {
  const state = stateFor([[task('one', 100)]]);
  const settings = settingsFor(state);
  settings.controls.exceptions['2026-11-02'] = 10;
  settings.controls.pins = [{ id: 'pin', enrollmentId: state.enrollments[0].id, taskId: 'one', day: '2026-11-02', minutes: 50 }];
  expect(calculate(state, settings).advice.status).toBe('needs-input');
  const dependencies = stateFor([[task('one', 30, ['missing'])]]);
  expect(calculate(dependencies, settingsFor(dependencies)).advice.status).toBe('needs-input');
});
it('offers more study time when a known prerequisite only exceeds the current forecast capacity', () => {
  const state = stateFor([[task('long-project', 10000), task('final-review', 30, ['long-project'])]], '2027-11-01');
  const settings = settingsFor(state, [5, 5, 5, 5, 5, 5, 5]);
  const { plan, advice } = calculate(state, settings);
  expect(plan.unscheduled.some(item => item.taskId === 'final-review' && item.reason.includes('Prerequisite'))).toBe(true);
  expect(advice.status).toBe('adjustable');
  const suggested = makePlan(state, { ...settings.availability, weekdayMinutes: advice.suggestedWeekdayMinutes! }, settings.targets, today, settings.controls);
  expect(suggested.unscheduled).toEqual([]);
  expect(suggested.outcomes[0].forecastDate! <= settings.targets[state.enrollments[0].id]).toBe(true);
  expect(suggested.blocks.reduce((sum, block) => sum + block.minutes, 0)).toBe(10030);
});
it('keeps cyclic prerequisites actionable instead of suggesting more time', () => {
  const state = stateFor([[task('first', 30, ['second']), task('second', 30, ['first'])]]);
  expect(calculate(state, settingsFor(state)).advice.status).toBe('needs-input');
});
it('handles the real Google outline with a complete forecast and a bounded verified suggestion', () => {
  const offering = seed.offerings.find(item => item.provider.includes('Google')) as Offering;
  const state = stateFor([[]], '2027-01-30');
  const enrollment = state.enrollments[0];
  enrollment.snapshot = offering;
  enrollment.offeringId = offering.id;
  enrollment.taskIds = offering.courses.flatMap(c => c.modules.flatMap(m => m.tasks.filter(t => t.requirement === 'required').map(t => t.id)));
  const settings = settingsFor(state, [0, 60, 60, 60, 60, 60, 0]);
  const began = performance.now();
  const result = calculate(state, settings);
  const elapsedMs = performance.now() - began;
  expect(result.plan.unscheduled).toEqual([]);
  expect(result.plan.outcomes[0].forecastDate).not.toBeNull();
  expect(result.advice.status).toBe('adjustable');
  const suggested = makePlan(state, { ...settings.availability, weekdayMinutes: result.advice.suggestedWeekdayMinutes! } as Availability, settings.targets, today, settings.controls);
  expect(suggested.outcomes.every(o => o.forecastDate! <= o.targetDate)).toBe(true);
  console.info(JSON.stringify({ scenario: 'google-complete-forecast-and-advice', activities: enrollment.taskIds.length, elapsedMs: Math.round(elapsedMs * 100) / 100, weeklyMinutes: result.advice.suggestedWeeklyMinutes }));
});
