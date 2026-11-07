import type { Availability, Enrollment, LearningData, Offering } from '@dima/contracts';
import { makePlan } from '../../domain/src/planner';
import { activeControls } from '../../domain/src/recovery';

/** Uncommitted course projection, using the same scheduler as the saved preview. */
export function enrollmentForecast(data: LearningData, offering: Offering, selected: string[], prior: string[], estimates: Record<string, number>, target: string, weekdayMinutes: number[]) {
  const startDate = data.state.availability && data.state.availability.startDate > data.localDay ? data.state.availability.startDate : data.localDay;
  const availability: Availability = { startDate, weekdayMinutes, reservePercent: 15 };
  const remaining = offering.courses.flatMap(course => course.modules.flatMap(module => module.tasks)).filter(task => selected.includes(task.id) && !prior.includes(task.id));
  const missing = remaining.filter(task => (estimates[task.id] ?? task.minutes) === null);
  const workload = remaining.reduce((sum, task) => sum + (estimates[task.id] ?? task.minutes ?? 0), 0);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(target) && Number.isFinite(Date.parse(target)) && weekdayMinutes.some(value => value > 0) && weekdayMinutes.every(value => Number.isInteger(value) && value >= 0 && value <= 720) && Object.values(estimates).every(value => Number.isInteger(value) && value >= 1 && value <= 10000);
  if (!valid || missing.length || !remaining.length) return { startDate, remaining, missing, workload, outcome: null };
  const id = `joining-${offering.id}`;
  const enrollment: Enrollment = { id, offeringId: offering.id, snapshot: offering, taskIds: selected, priorTaskIds: prior, targetDate: target, joinedAt: data.localDay, estimates,
    completions: prior.filter(taskId => selected.includes(taskId)).map(taskId => ({ taskId, kind: 'prior', completed: true, firstCompletedAt: null, completedAt: null, localDay: null, timezone: null, effortMinutes: null, claimId: `prior-${taskId}` })) };
  const state = { ...data.state, enrollments: [...data.state.enrollments, enrollment] };
  // The setup step starts with the interruption buffer enabled too.
  const controls = { ...activeControls(data.state), useBuffer: false };
  const result = makePlan(state, availability, Object.fromEntries(state.enrollments.map(course => [course.id, course.targetDate])), data.localDay, controls, data.timezone);
  return { startDate, remaining, missing, workload, outcome: result.conflicts?.length ? null : result.outcomes.find(value => value.enrollmentId === id) ?? null };
}

/** Carry first-course choices forward without overwriting an existing saved routine. */
export function enrollmentWeek(query: string): number[] | null {
  const value = new URLSearchParams(query).get('week');
  if (!value || !/^\d+(,\d+){6}$/.test(value)) return null;
  const week = value.split(',').map(Number);
  return week.some(minutes => minutes > 0) && week.every(minutes => Number.isInteger(minutes) && minutes >= 0 && minutes <= 720) ? week : null;
}
