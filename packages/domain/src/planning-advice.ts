import type { LearningState, PlanAdvice, PlanResult, PlanSettings } from '../../contracts/src/learning';
import { makePlan } from './planner';
import { addDays, isPaused, projectedEffortByDay, tasksOf } from './recovery';
import { MAX_FORECAST_DAYS } from '../../contracts/src/policy';

function meetsTargets(result: PlanResult): boolean {
  return !result.conflicts?.length && !result.unscheduled.length && !result.excluded?.length &&
    result.outcomes.every(outcome => outcome.status === 'complete' ||
      outcome.forecastDate !== null && outcome.forecastDate <= outcome.targetDate);
}

// Unscheduled prerequisites can simply be waiting for more capacity. Only ask
// for input when selected unfinished work cannot resolve its dependency graph.
function hasBlockedPrerequisites(state: LearningState): boolean {
  for (const enrollment of state.enrollments) {
    const resolved = new Set(enrollment.completions.filter(item => item.completed).map(item => item.taskId));
    const selected = new Set(enrollment.taskIds);
    let pending = tasksOf(enrollment.snapshot).filter(task => selected.has(task.id) && !resolved.has(task.id));
    while (pending.length) {
      const next = pending.filter(task => {
        if (!task.prerequisiteIds.every(id => resolved.has(id))) return true;
        resolved.add(task.id);
        return false;
      });
      if (next.length === pending.length) return true;
      pending = next;
    }
  }
  return false;
}

/** Suggestions are checked against the same scheduler as the eventual preview.
 * They change recurring capacity only: never rest days, pins, exceptions or goals.
 * A short search finds a useful proposal, not a claimed minimum or a guarantee.
 */
export function buildPlanAdvice(state: LearningState, settings: PlanSettings, today: string, current: PlanResult, timezone?: string): PlanAdvice {
  const currentWeeklyMinutes = settings.availability.weekdayMinutes.reduce((sum, value) => sum + value, 0);
  const result = (status: PlanAdvice['status'], reason?: string): PlanAdvice => ({ status, currentWeeklyMinutes, ...(reason ? { reason } : {}) });
  if (meetsTargets(current)) return result('on-track');
  if (current.conflicts?.length) return result('needs-input', 'Resolve the pinned-work or availability conflicts before comparing study time.');
  if (current.missingTasks || current.outcomes.some(outcome => outcome.unknownEffort)) return result('needs-input', 'Add the missing remaining-work estimates to compare a complete course plan.');
  if (current.excluded?.length) return result('needs-input', 'Some courses are paused. Choose when to resume them before comparing finish dates.');
  if (current.unscheduled.some(item => item.reason.includes('Prerequisite')) && hasBlockedPrerequisites(state)) return result('needs-input', 'Review the missing or unfinished prerequisites before comparing a complete plan.');
  if (!currentWeeklyMinutes) return result('no-study-days', 'Choose at least one regular study day, or add enough dated availability in the schedule settings.');
  const start = settings.availability.startDate > today ? settings.availability.startDate : today;
  if (current.outcomes.some(outcome => outcome.status !== 'complete' && outcome.targetDate < start)) return result('unavailable', 'A target date is before this plan starts. Choose a future target or keep your current pace with a later estimated finish.');

  const original = settings.availability.weekdayMinutes;
  const candidate = (step: number) => original.map(minutes => minutes ? Math.min(720, minutes + step * 15) : 0);
  const maxStep = Math.max(...original.filter(Boolean).map(minutes => Math.ceil((720 - minutes) / 15)));
  if (!maxStep) return result('unavailable', 'The current study days cannot fit every target. Adjust a target, a rest period, or a dated limit.');

  // Find a lower bound using cumulative capacity, without building candidate schedules.
  // Every real suggestion is then checked with the full dependency/pin-aware scheduler.
  const work = new Map<string, number>();
  for (const block of current.blocks) work.set(block.enrollmentId, (work.get(block.enrollmentId) ?? 0) + block.minutes);
  for (const task of current.unscheduled) work.set(task.enrollmentId, (work.get(task.enrollmentId) ?? 0) + (task.minutes ?? 0));
  const demand = new Map<string, number>();
  for (const outcome of current.outcomes) if (outcome.status !== 'complete') demand.set(outcome.targetDate, (demand.get(outcome.targetDate) ?? 0) + (work.get(outcome.enrollmentId) ?? 0));
  const latest = [...demand.keys()].sort().at(-1)!;
  const end = latest < addDays(start, MAX_FORECAST_DAYS) ? latest : addDays(start, MAX_FORECAST_DAYS);
  const accepted = projectedEffortByDay(state, timezone);
  const days: Array<{ weekday: number; fixed: number | null; accepted: number | null; demand: number }> = [];
  let required = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    required += demand.get(day) ?? 0;
    days.push({ weekday: new Date(`${day}T12:00:00Z`).getUTCDay(), fixed: isPaused(settings.controls, day, null) ? 0 : settings.controls.exceptions[day] ?? null, accepted: accepted.has(day) ? accepted.get(day)! : 0, demand: demand.has(day) ? required : 0 });
  }
  function sufficientCapacity(step: number) {
    const week = candidate(step);
    let free = 0;
    for (const day of days) {
      const ceiling = day.fixed ?? week[day.weekday];
      const reserve = settings.controls.useBuffer ? 0 : Math.ceil(ceiling * settings.availability.reservePercent / 100);
      free += day.accepted === null ? 0 : Math.max(0, ceiling - reserve - day.accepted);
      if (free < day.demand) return false;
    }
    return true;
  }
  if (!sufficientCapacity(maxStep)) return result('unavailable', 'More time on your current study days cannot meet every target with these settings. Adjust the dates, pauses or dated limits.');
  let low = 1, high = maxStep;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (sufficientCapacity(middle)) high = middle; else low = middle + 1; }
  // At most two full schedules. Tight pauses/dependencies can make the aggregate bound
  // optimistic; never expose that candidate unless actual scheduling confirms it.
  for (const step of [...new Set([low, Math.min(maxStep, low + 1)])]) {
    const suggested = candidate(step);
    if (meetsTargets(makePlan(state, { ...settings.availability, weekdayMinutes: suggested }, settings.targets, today, settings.controls, timezone))) {
      return { status: 'adjustable', currentWeeklyMinutes, suggestedWeekdayMinutes: suggested, suggestedWeeklyMinutes: suggested.reduce((sum, value) => sum + value, 0), reason: 'This suggested week fits all course targets using the current estimates. Review the daily changes before applying it.' };
    }
  }
  return result('unavailable', 'A simple weekly increase did not fit every target. Review your dates, pauses and pinned work, or keep your current pace.');
}
