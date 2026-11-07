import type { CourseLiveData } from '../../contracts/src/course-live';

/** Celebrate newly recorded completion only between two fresh, comparable snapshots. */
export function courseAdvances(previous: CourseLiveData | null, next: CourseLiveData): string[] {
  if (!previous || previous.accountId !== next.accountId || previous.scopeId !== next.scopeId || previous.version !== next.version) return [];
  const elapsed = Date.parse(next.calculatedAt) - Date.parse(previous.calculatedAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 45000) return [];
  const before = new Map(previous.rows.map(row => [row.profileId, row]));
  return next.rows.filter(row => {
    const old = before.get(row.profileId);
    return old && row.completedCount > old.completedCount && row.latest?.kind === 'new'
      && Date.parse(row.latest.completedAt) > Date.parse(previous.calculatedAt)
      && Date.parse(row.latest.completedAt) <= Date.parse(next.calculatedAt)
      && row.latest.completedAt !== old.latest?.completedAt;
  }).map(row => row.profileId).slice(0, 5);
}
