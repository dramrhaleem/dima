import { offeringSchema } from '../../contracts/src/learning';
import { PLANNER_VERSION } from '../../contracts/src/policy';
import type { Enrollment, LearningCommand, LearningState, Offering, PlanBlock, PlanPreview, PlanSettings, RecoveryControls, WorkEvent } from '../../contracts/src/learning';
import { activeControls, addDays, effectiveRemaining, initialEstimate, localDay, missedPlanDays, normalizeLearningState, tasksOf } from './recovery';
import { makePlan } from './planner';
import { buildPlanAdvice } from './planning-advice';
import { applyCurriculumUpgrade, describeUpgrade } from './upgrade';
export { makePlan } from './planner';
export * from './recovery';
export class LearningError extends Error { constructor(public code:string,public status=422) { super(code); } }
export const emptyLearningState = ():LearningState => ({revision:0,drafts:[],enrollments:[],availability:null,plan:null,previews:[],dataVersion:3,planningRevision:0,workEvents:[],missedStudyDays:[]});
export function validateOutline(offering:Offering) {
 const all=tasksOf(offering); if(!all.length || all.length>1500) throw new LearningError('OUTLINE_SIZE');
 const allIds=[...offering.courses.map(c=>c.id),...offering.courses.flatMap(c=>c.modules.map(m=>m.id)),...all.map(t=>t.id)];
 if(new Set(allIds).size!==allIds.length) throw new LearningError('DUPLICATE_IDS');
 const byId=new Map(all.map(t=>[t.id,t])); const visiting=new Set<string>(),visited=new Set<string>();
 const visit=(key:string)=>{ if(visiting.has(key))throw new LearningError('DEPENDENCY_CYCLE');if(visited.has(key))return; const task=byId.get(key);if(!task)throw new LearningError('DEPENDENCY_MISSING');visiting.add(key);for(const dep of task.prerequisiteIds)visit(dep);visiting.delete(key);visited.add(key); };
 for(const task of all)visit(task.id);
}

function validateControls(state:LearningState,controls:RecoveryControls,start:string){
 const ids=new Set(state.enrollments.map(e=>e.id));
 if(Object.keys(controls.exceptions).length>825||Object.entries(controls.exceptions).some(([day])=>day<'1900-01-01'||day>addDays(start,820))||Object.keys(controls.priorities).some(id=>!ids.has(id)))throw new LearningError('INVALID_CONTROLS');
 if(new Set(controls.pins.map(p=>p.id)).size!==controls.pins.length||new Set(controls.pauses.map(p=>p.id)).size!==controls.pauses.length)throw new LearningError('DUPLICATE_CONTROL_IDS');
 for(const pin of controls.pins)if(state.workEvents?.some(w=>(w.pinId===pin.id||!!w.pinCoverage&&Object.hasOwn(w.pinCoverage,pin.id))&&(w.enrollmentId!==pin.enrollmentId||w.taskId!==pin.taskId)))throw new LearningError('PIN_ID_REUSED');
 for(const p of controls.pauses)if((p.enrollmentId!==null&&!ids.has(p.enrollmentId))||p.startDate<'1900-01-01'||p.startDate>addDays(start,820)||(p.resumeDate!==null&&(p.resumeDate<=p.startDate||p.resumeDate>addDays(start,821))))throw new LearningError('INVALID_PAUSE');
}
/** Index each activity once; a multi-block activity contributes each date only once. */
function scheduledDays(blocks: PlanBlock[]): Map<string, string[]> {
 const unique = new Map<string, Set<string>>();
 for (const block of blocks) {
  const key = `${block.enrollmentId}:${block.taskId}`;
  let days = unique.get(key);
  if (!days) { days = new Set(); unique.set(key, days); }
  days.add(block.day);
 }
 return new Map([...unique].map(([key, days]) => [key, [...days].sort()]));
}
/** Completion checkpoints never create focus-ledger time. Claims stay stable through undo. */
function finishActivity(state:LearningState,e:Enrollment,taskId:string,kind:'new'|'prior',effortMinutes:number|null,ctx:LearningContext,today:string,batchId?:string) {
 let c=e.completions.find(value=>value.taskId===taskId);
 const remainingBefore=effectiveRemaining(state,e.id,taskId);
 const pinCoverage=Object.fromEntries(activeControls(state).pins.filter(p=>p.enrollmentId===e.id&&p.taskId===taskId).map(p=>[p.id,p.minutes]));
 if(!c){c={taskId,kind,completed:false,firstCompletedAt:kind==='new'?ctx.now:null,completedAt:null,localDay:null,timezone:null,effortMinutes:null,claimId:ctx.uuid()};e.completions.push(c);}
 c.remainingBefore=remainingBefore;c.completed=true;c.completedAt=c.kind==='new'?ctx.now:null;c.localDay=c.kind==='new'?today:null;c.timezone=c.kind==='new'?ctx.timezone:null;c.effortMinutes=c.kind==='new'?effortMinutes:0;c.moduleBatchId=batchId??null;e.remaining![taskId]=0;
 if(c.kind==='new'){const event:WorkEvent={id:ctx.uuid(),enrollmentId:e.id,taskId,source:'completion',createdAt:ctx.now,localDay:today,timezone:ctx.timezone,effortMinutes,originalEffortMinutes:effortMinutes,remainingAfter:0,completionClaimId:c.claimId,pinId:null,pinCoverage,invalidatedAt:null,correctedAt:null};c.workEventId=event.id;state.workEvents!.push(event);}
}
function undoActivity(state:LearningState,e:Enrollment,taskId:string,now:string) {
 const c=e.completions.find(value=>value.taskId===taskId)!;
 const event=state.workEvents!.find(w=>w.id===c.workEventId);if(event)event.invalidatedAt=now;
 e.remaining![taskId]=Object.hasOwn(e.remaining!,taskId)&&e.remaining![taskId]!==0?null:c.remainingBefore===undefined?initialEstimate(e,taskId):c.remainingBefore;
 c.effortMinutes=0;c.completed=false;c.moduleBatchId=null;
}
export type LearningContext={now:string;timezone:string;profileRevision:number;catalog:Offering[];uuid:()=>string};
export function transitionLearning(input:LearningState,command:LearningCommand,ctx:LearningContext):{state:LearningState;previewId?:string} {
 if(command.expectedRevision!==input.revision)throw new LearningError('REVISION_CONFLICT',409);
 const state=normalizeLearningState(input),today=localDay(ctx.now,ctx.timezone);let previewId:string|undefined;
 const enrollment=(id:string)=>{const e=state.enrollments.find(e=>e.id===id);if(!e)throw new LearningError('NOT_FOUND',404);return e;};
 if(command.type==='saveDraft'){
  const d=command.draft;validateOutline({id:d.id,version:'draft',title:d.title,provider:'Private course',kind:'course',sourceUrl:d.sourceUrl,summary:'',language:'',scopeLabel:'Private course',orderPolicy:'Your outline order',courses:d.courses});
  if(ctx.catalog.some(c=>c.id===d.id))throw new LearningError('ID_RESERVED');
  if(!state.drafts.some(x=>x.id===d.id)&&state.drafts.length>=30)throw new LearningError('DRAFT_LIMIT');
  const saved={...d,updatedAt:ctx.now};const i=state.drafts.findIndex(x=>x.id===d.id);if(i<0)state.drafts.push(saved);else state.drafts[i]=saved;
 } else if(command.type==='enroll'){
  if(state.enrollments.length>=20)throw new LearningError('ENROLLMENT_LIMIT');
  if(state.enrollments.some(e=>e.offeringId===command.offeringId))throw new LearningError('ALREADY_ENROLLED',409);
  const draft=state.drafts.find(d=>d.id===command.offeringId);const offering=ctx.catalog.find(o=>o.id===command.offeringId)??(draft?{id:draft.id,version:draft.updatedAt,title:draft.title,provider:'Private course',kind:'course' as const,sourceUrl:draft.sourceUrl,summary:'Your private outline. Not published.',language:'Custom',scopeLabel:'Your selected private scope',orderPolicy:'Your outline order',courses:draft.courses}:undefined);
  if(!offering)throw new LearningError('NOT_FOUND',404);validateOutline(offering);
  const ids=new Set(tasksOf(offering).map(t=>t.id));const selected=new Set(command.taskIds);
  if(selected.size!==command.taskIds.length||command.taskIds.some(id=>!ids.has(id))||new Set(command.priorTaskIds).size!==command.priorTaskIds.length||command.priorTaskIds.some(id=>!selected.has(id))||Object.keys(command.estimates).some(id=>!selected.has(id)))throw new LearningError('INVALID_SCOPE');
  if(command.targetDate<today||command.targetDate>addDays(today,730))throw new LearningError('INVALID_TARGET');
  state.enrollments.push({id:ctx.uuid(),offeringId:offering.id,snapshot:structuredClone(offering),taskIds:command.taskIds,priorTaskIds:command.priorTaskIds,targetDate:command.targetDate,joinedAt:ctx.now,estimates:command.estimates,completions:command.priorTaskIds.map(taskId=>({taskId,kind:'prior',completed:true,firstCompletedAt:null,completedAt:null,localDay:null,timezone:null,effortMinutes:0,claimId:ctx.uuid()}))});
 } else if(command.type==='previewUpgrade'){
  const e=enrollment(command.enrollmentId);
  const draft=state.drafts.find(d=>d.id===e.offeringId);
  const target=ctx.catalog.find(o=>o.id===e.offeringId)??(draft?{...e.snapshot,title:draft.title,sourceUrl:draft.sourceUrl,version:draft.updatedAt,courses:draft.courses}:undefined);
  if(!target)throw new LearningError('UPGRADE_UNAVAILABLE',404);
  validateOutline(target);
  if(target.version===e.snapshot.version)throw new LearningError('NO_UPGRADE');
  if((e.upgradeHistory?.length??0)>=20)throw new LearningError('UPGRADE_HISTORY_LIMIT');
  previewId=ctx.uuid();
  state.upgradePreviews=[{id:previewId,enrollmentId:e.id,baseRevision:state.revision+1,profileRevision:ctx.profileRevision,sourceVersion:e.snapshot.version,createdAt:ctx.now,expiresAt:new Date(Date.parse(ctx.now)+3600000).toISOString(),target:structuredClone(target),includeNewRequired:command.includeNewRequired,...describeUpgrade(e,target,command.includeNewRequired,state)}];
 } else if(command.type==='applyUpgrade'){
  const p=state.upgradePreviews?.find(p=>p.id===command.previewId);if(!p)throw new LearningError('PREVIEW_STALE',409);
  const e=enrollment(p.enrollmentId),draft=state.drafts.find(d=>d.id===e.offeringId);
  const current=ctx.catalog.find(o=>o.id===e.offeringId)??(draft?{...e.snapshot,title:draft.title,sourceUrl:draft.sourceUrl,version:draft.updatedAt,courses:draft.courses}:undefined);
  if(p.baseRevision!==state.revision||p.profileRevision!==ctx.profileRevision||p.sourceVersion!==e.snapshot.version||Date.parse(p.expiresAt)<=Date.parse(ctx.now)||!current||JSON.stringify(offeringSchema.parse(current))!==JSON.stringify(offeringSchema.parse(p.target)))throw new LearningError('PREVIEW_STALE',409);
  if(p.unresolved.length)throw new LearningError('MAPPING_UNRESOLVED');
  if(!p.taskIds.length)throw new LearningError('EMPTY_UPGRADE_SCOPE');
  if(!command.acknowledgeChanges)throw new LearningError('ACKNOWLEDGEMENT_REQUIRED');
  applyCurriculumUpgrade(e,p,ctx.now);state.upgradePreviews=[];state.previews=[];
 } else if(command.type==='completeModule'){
  const e=enrollment(command.enrollmentId);
  const module=e.snapshot.courses.flatMap(course=>course.modules).find(value=>value.id===command.moduleId);
  if(!module)throw new LearningError('MODULE_NOT_FOUND',404);
  const selected=new Set(e.taskIds),done=new Set(e.completions.filter(c=>c.completed).map(c=>c.taskId));
  const pending=module.tasks.filter(task=>selected.has(task.id)&&!done.has(task.id));
  if(!pending.length)throw new LearningError('MODULE_NOTHING_TO_COMPLETE',409);
  const batchIds=new Set(pending.map(task=>task.id));
  if(pending.some(task=>task.prerequisiteIds.some(id=>!done.has(id)&&!batchIds.has(id))))throw new LearningError('MODULE_PREREQUISITE_INCOMPLETE');
  // Existing in-Dima history cannot be relabelled as prior progress to change credit provenance.
  if(command.kind==='prior'&&pending.some(task=>e.completions.some(c=>c.taskId===task.id&&c.kind==='new')||state.workEvents!.some(w=>w.enrollmentId===e.id&&w.taskId===task.id&&!w.invalidatedAt)))throw new LearningError('PRIOR_PROGRESS_CONFLICT');
  const priorAddedTaskIds=command.kind==='prior'?pending.filter(task=>!e.priorTaskIds.includes(task.id)).map(task=>task.id):[];
  // Validate the whole batch first, then complete in dependency order regardless of display order.
  const ordered:typeof pending=[],waiting=new Map(pending.map(task=>[task.id,task]));
  const available=new Set(done);
  while(waiting.size){const ready=[...waiting.values()].filter(task=>task.prerequisiteIds.every(id=>available.has(id)));if(!ready.length)throw new LearningError('MODULE_PREREQUISITE_INCOMPLETE');for(const task of ready){ordered.push(task);available.add(task.id);waiting.delete(task.id);}}
  for(const task of ordered)finishActivity(state,e,task.id,command.kind,null,ctx,today,command.operationId);
  e.priorTaskIds.push(...priorAddedTaskIds);
  state.moduleCompletionBatches=[...(state.moduleCompletionBatches??[]).slice(-19),{id:command.operationId,enrollmentId:e.id,moduleId:module.id,snapshotVersion:e.snapshot.version,kind:command.kind,taskIds:ordered.map(task=>task.id),priorAddedTaskIds,createdAt:ctx.now,undoneAt:null}];
 } else if(command.type==='undoModule'){
  const e=enrollment(command.enrollmentId),batch=state.moduleCompletionBatches?.find(value=>value.id===command.batchId&&value.enrollmentId===e.id);
  if(!batch||batch.undoneAt)throw new LearningError('MODULE_BATCH_NOT_FOUND',404);
  if(batch.snapshotVersion!==e.snapshot.version||batch.taskIds.some(id=>!e.taskIds.includes(id)||!e.completions.some(c=>c.taskId===id&&c.completed&&c.moduleBatchId===batch.id)))throw new LearningError('MODULE_BATCH_CHANGED',409);
  for(const taskId of batch.taskIds)undoActivity(state,e,taskId,ctx.now);
  e.priorTaskIds=e.priorTaskIds.filter(id=>!batch.priorAddedTaskIds.includes(id));batch.undoneAt=ctx.now;
 } else if(command.type==='setEstimates'){
  const e=enrollment(command.enrollmentId);if(Object.keys(command.estimates).some(id=>!e.taskIds.includes(id)))throw new LearningError('INVALID_SCOPE');e.estimates=command.estimates;
 } else if(command.type==='preview'||command.type==='undoRecovery'){
  let settings:PlanSettings;let mode:'initial'|'recovery'|'undo';
  if(command.type==='undoRecovery'){
   if(!state.plan||state.plan.id!==command.planId)throw new LearningError('PLAN_CHANGED',409);
   if(!state.plan.previousSettings)throw new LearningError('NOTHING_TO_UNDO');
   settings=structuredClone(state.plan.previousSettings);settings.availability.startDate=settings.availability.startDate<today?today:settings.availability.startDate;
   for(const e of state.enrollments)settings.targets[e.id]??=e.targetDate;mode='undo';
  }else {settings={availability:command.availability,targets:command.targets,controls:command.controls??activeControls(state)};mode=state.plan?'recovery':'initial';}
  const a=settings.availability;
  if(!state.enrollments.length)throw new LearningError('NO_ENROLLMENTS');
  if(a.startDate<today||a.startDate>addDays(today,365))throw new LearningError('INVALID_START');
  if(Object.keys(settings.targets).length!==state.enrollments.length||state.enrollments.some(e=>!settings.targets[e.id]||settings.targets[e.id]<'1900-01-01'||settings.targets[e.id]>addDays(a.startDate,730)))throw new LearningError('INVALID_TARGET');
  validateControls(state,settings.controls,a.startDate);
  previewId=ctx.uuid();const result=makePlan(state,a,settings.targets,today,settings.controls,ctx.timezone);
  const old=state.plan?.result??null;
  const moved:Array<{enrollmentId:string;taskId:string;fromDays:string[];toDays:string[]}>=[];
  const beforeDays=scheduledDays(old?.blocks??[]),afterDays=scheduledDays(result.blocks);
  for(const e of state.enrollments){
   const completed=new Set(e.completions.filter(c=>c.completed).map(c=>c.taskId));
   for(const taskId of e.taskIds){
    if(completed.has(taskId))continue;
    const key=`${e.id}:${taskId}`,fromDays=beforeDays.get(key)??[],toDays=afterDays.get(key)??[];
    if(fromDays.length!==toDays.length||fromDays.some((day,index)=>day!==toDays[index]))moved.push({enrollmentId:e.id,taskId,fromDays,toDays});
   }
  }
  const reasons=[mode==='undo'?'Previous settings are proposed using your current progress.':'Only remaining work is being scheduled.','Completed activities and recorded work are preserved.'];
  if(settings.controls.useBuffer)reasons.push('Recovery buffer is explicitly enabled; the daily ceiling is unchanged.');
  if(Object.keys(settings.controls.exceptions).length)reasons.push('Date exceptions override the normal weekly capacity.');
  if(settings.controls.pauses.length)reasons.push('Planned pauses are respected and are not missed study days.');
  if(settings.controls.pins.length)reasons.push('Incomplete pins reserve capacity and remaining effort once.');
  if(result.missingTasks)reasons.push('Some remaining effort needs confirmation.');
  if(state.plan&&state.plan.timezone!==ctx.timezone)reasons.push('Future dates use your current timezone; recorded event provenance is unchanged.');
  const preview:PlanPreview={id:previewId,baseRevision:state.revision+1,profileRevision:ctx.profileRevision,timezone:ctx.timezone,localDay:today,createdAt:ctx.now,expiresAt:new Date(Date.parse(ctx.now)+86400000).toISOString(),...settings,result,mode,advice:buildPlanAdvice(state,settings,today,result,ctx.timezone),comparison:{before:old,moved,reasons,previousTimezone:state.plan?.timezone??null,preservedCompletions:state.enrollments.reduce((n,e)=>n+e.completions.filter(c=>c.completed).length,0)}};
  state.previews=[...state.previews.slice(-2),preview];
 } else if(command.type==='apply'){
  const p=state.previews.find(p=>p.id===command.previewId);if(!p)throw new LearningError('NOT_FOUND',404);
  if(p.result.plannerVersion!==PLANNER_VERSION||p.baseRevision!==state.revision||p.profileRevision!==ctx.profileRevision||p.timezone!==ctx.timezone||p.localDay!==today||Date.parse(p.expiresAt)<=Date.parse(ctx.now))throw new LearningError('PREVIEW_STALE',409);
  if(p.result.conflicts?.length)throw new LearningError('PLAN_CONFLICT');
  if(p.result.unscheduled.length&&!command.acknowledgeUnscheduled)throw new LearningError('ACKNOWLEDGEMENT_REQUIRED');
  if(!p.result.blocks.length&&p.result.unscheduled.length)throw new LearningError('NOTHING_SCHEDULABLE');
  const previousSettings=state.plan?{availability:state.plan.availability,targets:state.plan.targets,controls:activeControls(state)}:null;
  if(state.plan){const missed=missedPlanDays(state,today);const history=new Map((state.missedStudyDays??[]).map(d=>[`${d.timezone}:${d.day}`,d]));for(const day of missed)history.set(`${state.plan.timezone}:${day}`,{day,timezone:state.plan.timezone,recordedAt:ctx.now});state.missedStudyDays=[...history.values()].filter(d=>d.day>=addDays(today,-90)).sort((a,b)=>a.day.localeCompare(b.day)).slice(-120);}
  state.plan={...p,appliedAt:ctx.now,previousSettings};state.availability=p.availability;for(const e of state.enrollments)e.targetDate=p.targets[e.id];state.previews=[];
 } else if(command.type==='resolveWorkEffort'||command.type==='voidWork'){
  const event=state.workEvents!.find(w=>w.id===command.eventId);if(!event||event.invalidatedAt)throw new LearningError('WORK_EVENT_NOT_FOUND',404);
  if(command.type==='resolveWorkEffort'){if(event.effortMinutes!==null)throw new LearningError('EFFORT_ALREADY_CONFIRMED',409);event.effortMinutes=command.effortMinutes;event.correctedAt=ctx.now;const completion=enrollment(event.enrollmentId).completions.find(c=>c.workEventId===event.id);if(completion){completion.effortMinutes=command.effortMinutes;completion.moduleBatchId=null;}}
  else{if(event.source!=='worked')throw new LearningError('USE_COMPLETION_UNDO');event.invalidatedAt=ctx.now;enrollment(event.enrollmentId).remaining![event.taskId]=null;}
 } else {
  const e=enrollment(command.enrollmentId);if(!e.taskIds.includes(command.taskId))throw new LearningError('INVALID_SCOPE');
  const c=e.completions.find(c=>c.taskId===command.taskId);
  if(command.type==='laterToday'){
   if(c?.completed)throw new LearningError('ALREADY_COMPLETED',409);
   const taskKey=`${e.id}:${command.taskId}`;const order=state.todayOrder?.day===today?state.todayOrder.taskKeys:[];state.todayOrder={day:today,taskKeys:[...order.filter(k=>k!==taskKey),taskKey]};
  }else if(command.type==='worked'||command.type==='setRemaining'){
   if(c?.completed)throw new LearningError('ALREADY_COMPLETED',409);
   if(command.type==='worked'){
    if(command.pinId){const pin=activeControls(state).pins.find(p=>p.id===command.pinId&&p.enrollmentId===e.id&&p.taskId===command.taskId);if(!pin)throw new LearningError('PIN_NOT_FOUND');if(pin.day!==today||state.plan?.timezone!==ctx.timezone)throw new LearningError('PIN_DAY_CHANGED',409);}
    const event:WorkEvent={id:ctx.uuid(),enrollmentId:e.id,taskId:command.taskId,source:'worked',createdAt:ctx.now,localDay:today,timezone:ctx.timezone,effortMinutes:command.effortMinutes,originalEffortMinutes:command.effortMinutes,remainingAfter:command.remainingMinutes,completionClaimId:null,pinId:command.pinId??null,invalidatedAt:null,correctedAt:null};state.workEvents!.push(event);
   }
   e.remaining![command.taskId]=command.remainingMinutes;
  }else if(command.type==='complete'){
   if(c?.completed)throw new LearningError('ALREADY_COMPLETED',409);
   const task=tasksOf(e.snapshot).find(t=>t.id===command.taskId)!;
   if(task.prerequisiteIds.some(id=>!e.completions.some(p=>p.taskId===id&&p.completed)))throw new LearningError('PREREQUISITE_INCOMPLETE');
   finishActivity(state,e,command.taskId,'new',command.effortMinutes,ctx,today);
  }else {
   if(!c?.completed)throw new LearningError('NOT_COMPLETED',409);
   if(command.type==='undo')undoActivity(state,e,command.taskId,ctx.now);
   else if(command.type==='reopen')e.remaining![command.taskId]=command.remainingMinutes;
   c.completed=false;c.moduleBatchId=null;
  }
 }

 if(['completeModule','undoModule','enroll','applyUpgrade','setEstimates','worked','setRemaining','complete','undo','reopen','voidWork','resolveWorkEffort'].includes(command.type))state.planningRevision=state.revision+1;
 state.revision++;return {state,...(previewId?{previewId}:{})};
}
