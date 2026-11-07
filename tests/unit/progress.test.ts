import { describe,expect,it } from 'vitest';
import type { Enrollment } from '../../packages/contracts/src/learning';
import { competitionRanks,courseProgress,utcWindow } from '../../packages/domain/src/progress';
function enrollment(kinds:string[],optional=false):Enrollment{
 const tasks=kinds.map((kind,i)=>({id:`t${i}`,title:kind,position:i,kind,minutes:10,estimateSource:'source' as const,requirement:optional?'optional' as const:'required' as const,sourceUrl:'https://example.org',prerequisiteIds:[]}));
 return {id:'e',offeringId:'o',snapshot:{id:'o',version:'v1',title:'Course',provider:'Provider',kind:'course',sourceUrl:'https://example.org',summary:'',language:'en',scopeLabel:'all',orderPolicy:'source',courses:[{id:'c',title:'Course',position:0,modules:[{id:'m',title:'Module',position:0,tasks}]}]},taskIds:tasks.map(t=>t.id),priorTaskIds:['t0'],targetDate:'2026-11-10',joinedAt:'2026-11-01',estimates:{},completions:tasks.map((t,i)=>({taskId:t.id,kind:i===0?'prior':'new',completed:i<2,firstCompletedAt:null,completedAt:null,localDay:null,timezone:null,effortMinutes:null,claimId:t.id}))};
}
describe('weighted progress and public board boundaries',()=>{
 it('weights required work independently of time and separates prior credit',()=>{
  const value=courseProgress(enrollment(['video','project','quiz','assignment']));expect(value.requiredWeight).toBe(15);expect(value.completedWeight).toBe(9);expect(value.priorWeight).toBe(1);expect(value.newWeight).toBe(8);expect(value.percentage).toBe(60);
 });
 it('does not fabricate a denominator for unknown required kinds or optional scope',()=>{
  expect(courseProgress(enrollment(['lecture'])).percentage).toBeNull();expect(courseProgress(enrollment(['lecture'])).classificationNeeded).toBe(true);
  for(const kind of ['constructor','toString','__proto__']){const unknown=courseProgress(enrollment([kind]));expect(unknown.percentage).toBeNull();expect(unknown.requiredWeight).toBeNull();expect(unknown.completedWeight).toBe(0);}
  const optional=courseProgress(enrollment(['project'],true));expect(optional.requiredWeight).toBe(0);expect(optional.percentage).toBeNull();
 });
 it('uses Monday UTC across month and DST boundaries',()=>{
  expect(utcWindow('week',new Date('2026-11-01T23:59:59Z'))).toEqual({start:'2026-10-26T00:00:00.000Z',end:'2026-11-02T00:00:00.000Z'});
  expect(utcWindow('month',new Date('2026-12-31T23:59:59Z')).end).toBe('2027-01-01T00:00:00.000Z');
 });
 it('shares rank without a hidden tie breaker',()=>{
  expect(competitionRanks([{profileId:'d',score:1},{profileId:'b',score:8},{profileId:'a',score:9},{profileId:'c',score:8}]).map(r=>r.rank)).toEqual([1,2,2,4]);
 });
});
