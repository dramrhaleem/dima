import { describe, expect, it } from 'vitest';
import { learningCommandSchema, type LearningState, type Offering } from '../../packages/contracts/src/learning';
import { emptyLearningState, transitionLearning, type LearningContext } from '../../packages/domain/src/learning';
import { courseProgress } from '../../packages/domain/src/progress';

let sequence=0;
const uuid=()=>`10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
const task=(id:string,prerequisiteIds:string[]=[])=>({id,title:id,position:0,kind:'video',minutes:20,estimateSource:'source' as const,requirement:'required' as const,sourceUrl:'https://example.org/course',prerequisiteIds});
const outline:Offering={id:'example',version:'v1',title:'Example',provider:'Provider',kind:'course',sourceUrl:'https://example.org/course',summary:'',language:'English',scopeLabel:'All',orderPolicy:'Source order',courses:[{id:'course',title:'Course',position:0,modules:[{id:'module',title:'Module',position:0,tasks:[task('second',['first']),task('first'),task('already'),task('unselected')]},{id:'other-module',title:'Other',position:1,tasks:[task('other')]}]}]};
const context:LearningContext={now:'2026-11-01T12:00:00Z',timezone:'Africa/Cairo',profileRevision:1,catalog:[outline],uuid};
function act(state:LearningState,body:Record<string,unknown>,ctx=context){return transitionLearning(state,learningCommandSchema.parse({...body,expectedRevision:state.revision,operationId:uuid()}),ctx).state;}
function fixture(){return act(emptyLearningState(),{type:'enroll',offeringId:'example',taskIds:['first','second','already','other'],priorTaskIds:['already'],targetDate:'2026-12-01'});}
function complete(state:LearningState,kind:'new'|'prior'='new'){return act(state,{type:'completeModule',enrollmentId:state.enrollments[0].id,moduleId:'module',kind});}
function undo(state:LearningState){return act(state,{type:'undoModule',enrollmentId:state.enrollments[0].id,batchId:state.moduleCompletionBatches!.at(-1)!.id});}

describe('atomic module completion',()=>{
 it('completes only selected unfinished activities in dependency order and keeps existing progress',()=>{
  const before=fixture(),existing=structuredClone(before.enrollments[0].completions[0]),after=complete(before),enrollment=after.enrollments[0];
  expect(before.enrollments[0].completions).toEqual([existing]);
  expect(after.revision).toBe(before.revision+1);expect(after.planningRevision).toBe(after.revision);
  expect(after.moduleCompletionBatches![0].taskIds).toEqual(['first','second']);
  expect(enrollment.completions.find(c=>c.taskId==='already')).toEqual(existing);
  expect(enrollment.completions.some(c=>c.taskId==='unselected'||c.taskId==='other')).toBe(false);
  expect(enrollment.remaining).toEqual({first:0,second:0});
  expect(after.workEvents).toHaveLength(2);
  expect(after.workEvents!.every(w=>w.effortMinutes===null&&w.originalEffortMinutes===null&&w.source==='completion')).toBe(true);
 });
 it('rejects an incomplete prerequisite outside the batch atomically, including an unselected prerequisite',()=>{
  const s=fixture();s.enrollments[0].snapshot.courses[0].modules[0].tasks.find(t=>t.id==='first')!.prerequisiteIds=['other'];const copy=structuredClone(s);
  expect(()=>complete(s)).toThrow('MODULE_PREREQUISITE_INCOMPLETE');expect(s).toEqual(copy);
  s.enrollments[0].snapshot.courses[0].modules[0].tasks.find(t=>t.id==='first')!.prerequisiteIds=['unselected'];
  expect(()=>complete(s)).toThrow('MODULE_PREREQUISITE_INCOMPLETE');
 });
 it('prior completion creates no new effort or fresh course credit and undo preserves original baseline',()=>{
  const s=complete(fixture(),'prior'),e=s.enrollments[0];
  expect(s.workEvents).toEqual([]);expect(courseProgress(e).newWeight).toBe(0);
  expect(e.completions.every(c=>c.kind==='prior'&&c.firstCompletedAt===null&&c.localDay===null&&c.effortMinutes===0)).toBe(true);
  expect(e.priorTaskIds.sort()).toEqual(['already','first','second']);
  const undone=undo(s);expect(undone.enrollments[0].priorTaskIds).toEqual(['already']);
  expect(undone.enrollments[0].completions.filter(c=>c.completed).map(c=>c.taskId)).toEqual(['already']);
  expect(undone.enrollments[0].remaining).toEqual({first:20,second:20});
 });
 it('undo restores the batch remaining estimates, invalidates only its events, and preserves unrelated completions',()=>{
  let s=fixture();const eid=s.enrollments[0].id;
  s=act(s,{type:'worked',enrollmentId:eid,taskId:'first',effortMinutes:5,remainingMinutes:15});s=complete(s);
  s=act(s,{type:'complete',enrollmentId:eid,taskId:'other',effortMinutes:10});
  const originalClaim=s.enrollments[0].completions.find(c=>c.taskId==='first')!.claimId;
  const originalFirst=s.enrollments[0].completions.find(c=>c.taskId==='first')!.firstCompletedAt;
  s=undo(s);expect(s.enrollments[0].remaining!.first).toBe(15);expect(s.enrollments[0].remaining!.second).toBe(20);
  expect(s.enrollments[0].completions.filter(c=>c.completed).map(c=>c.taskId)).toEqual(['already','other']);
  expect(s.workEvents!.filter(w=>!w.invalidatedAt).map(w=>w.effortMinutes)).toEqual([5,10]);
  s=complete(s);expect(s.enrollments[0].completions.find(c=>c.taskId==='first')).toMatchObject({claimId:originalClaim,firstCompletedAt:originalFirst});
 });
 it('refuses batch undo after an affected item was individually undone and completed again',()=>{
  let s=complete(fixture());const eid=s.enrollments[0].id;
  s=act(s,{type:'undo',enrollmentId:eid,taskId:'second'});s=act(s,{type:'complete',enrollmentId:eid,taskId:'second',effortMinutes:0});
  const before=structuredClone(s);expect(()=>undo(s)).toThrow('MODULE_BATCH_CHANGED');expect(s).toEqual(before);
 });
 it('refuses a prior label over recorded work and over an undone new completion',()=>{
  let s=fixture(),eid=s.enrollments[0].id;
  s=act(s,{type:'worked',enrollmentId:eid,taskId:'first',effortMinutes:5,remainingMinutes:15});expect(()=>complete(s,'prior')).toThrow('PRIOR_PROGRESS_CONFLICT');
  s=fixture();eid=s.enrollments[0].id;s=act(s,{type:'complete',enrollmentId:eid,taskId:'first',effortMinutes:0});s=act(s,{type:'undo',enrollmentId:eid,taskId:'first'});expect(()=>complete(s,'prior')).toThrow('PRIOR_PROGRESS_CONFLICT');
 });
 it('rejects stale revisions, wrong enrollment, missing module and already complete module',()=>{
  const s=fixture(),eid=s.enrollments[0].id;
  const command=learningCommandSchema.parse({type:'completeModule',enrollmentId:eid,moduleId:'module',kind:'new',expectedRevision:0,operationId:uuid()});
  expect(()=>transitionLearning(s,command,context)).toThrow('REVISION_CONFLICT');
  expect(()=>act(s,{type:'completeModule',enrollmentId:uuid(),moduleId:'module',kind:'new'})).toThrow('NOT_FOUND');
  expect(()=>act(s,{type:'completeModule',enrollmentId:eid,moduleId:'missing',kind:'new'})).toThrow('MODULE_NOT_FOUND');
  expect(()=>complete(complete(s))).toThrow('MODULE_NOTHING_TO_COMPLETE');
  expect(()=>undo(undo(complete(s)))).toThrow('MODULE_BATCH_NOT_FOUND');
 });
 it('refuses batch undo after curriculum changes or effort correction',()=>{
  const s=complete(fixture()),changed=structuredClone(s);changed.enrollments[0].snapshot.version='v2';
  expect(()=>undo(changed)).toThrow('MODULE_BATCH_CHANGED');
  const corrected=act(s,{type:'resolveWorkEffort',eventId:s.workEvents![0].id,effortMinutes:10});expect(()=>undo(corrected)).toThrow('MODULE_BATCH_CHANGED');
 });
});
