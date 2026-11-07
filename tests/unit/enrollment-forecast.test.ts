import { describe, expect, it } from 'vitest';
import { enrollmentForecast, enrollmentWeek } from '../../packages/ui/src/enrollment-forecast';
import { emptyLearningState } from '../../packages/domain/src/learning';
import type { LearningData, Offering } from '../../packages/contracts/src/learning';
import seed from '../../apps/web/src/server/data/catalog.json';
const data = (): LearningData => ({ accountId: 'test', localDay: '2026-11-02', timezone: 'Africa/Cairo', state: emptyLearningState() });
const course = (seed.offerings as Offering[]).find(course => course.id === 'cs50-business')!;
const tasks = course.courses.flatMap(course => course.modules.flatMap(module => module.tasks)).filter(task => task.requirement === 'required');
const ids = tasks.map(task => task.id);
const estimates = Object.fromEntries(tasks.filter(task => task.minutes === null).map(task => [task.id, 120]));
const week = [60,60,60,60,60,0,0];
describe('uncommitted course finish forecast', () => {
 it('does not claim a finish without assignment estimates or write to learning state', () => {
  const input=data(), before=JSON.stringify(input);
  const incomplete=enrollmentForecast(input,course,ids,[],{},'2027-02-02',week);
  expect(incomplete.missing).toHaveLength(9); expect(incomplete.outcome).toBeNull();
  const ready=enrollmentForecast(input,course,ids,[],estimates,'2027-02-02',week);
  expect(ready.outcome?.forecastDate).toMatch(/^202[67]-/);
  expect(JSON.stringify(input)).toBe(before);
 });
 it('responds to pace and prior progress, and retains missing and empty states', () => {
  const slow=enrollmentForecast(data(),course,ids,[],estimates,'2027-02-02',week);
  const fast=enrollmentForecast(data(),course,ids,[],estimates,'2027-02-02',week.map(v=>v*2));
  expect(fast.outcome!.forecastDate! < slow.outcome!.forecastDate!).toBe(true);
  const partial=enrollmentForecast(data(),course,ids,ids.slice(0,6),estimates,'2027-02-02',week);
  expect(partial.workload).toBeLessThan(slow.workload);
  expect(enrollmentForecast(data(),course,ids,ids,{},'2027-02-02',week).remaining).toEqual([]);
  expect(enrollmentForecast(data(),course,ids,[],estimates,'2027-02-02',week.map(()=>0)).outcome).toBeNull();
 });
 it('carries only valid weekly choices to the next step', () => {
  expect(enrollmentWeek('?week=90,90,90,90,90,0,0')).toEqual([90,90,90,90,90,0,0]);
  for(const query of ['week=0,0,0,0,0,0,0','week=721,60,60,60,60,0,0','week=1,2','week=-1,1,1,1,1,1,1','week=NaN,1,1,1,1,1,1']) expect(enrollmentWeek(query)).toBeNull();
 });
});
