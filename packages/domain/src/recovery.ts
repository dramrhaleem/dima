import type { Enrollment, LearningState, Offering, PlanPin, RecoveryControls, RecoverySummary, WorkEvent } from '../../contracts/src/learning';
export const defaultControls = ():RecoveryControls => ({useBuffer:false,exceptions:{},priorities:{},pins:[],pauses:[]});
export const tasksOf = (offering:Offering) => [...offering.courses].sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).flatMap(c=>[...c.modules].sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).flatMap(m=>[...m.tasks].sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id))));
const dayFormatters=new Map<string,Intl.DateTimeFormat>();
export function localDay(at:string,timezone:string):string {
 let formatter=dayFormatters.get(timezone);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});if(dayFormatters.size>=32)dayFormatters.delete(dayFormatters.keys().next().value!);dayFormatters.set(timezone,formatter);}
 const parts=formatter.formatToParts(new Date(at));return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
}
export function addDays(day:string,count:number):string {const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
export const activeControls=(state:LearningState):RecoveryControls=>state.plan?.controls??defaultControls();
export function isPaused(controls:RecoveryControls,day:string,enrollmentId:string|null):boolean {return controls.pauses.some(p=>(p.enrollmentId===null||p.enrollmentId===enrollmentId)&&p.startDate<=day&&(p.resumeDate===null||day<p.resumeDate));}
export function initialEstimate(e:Enrollment,taskId:string):number|null { const task=tasksOf(e.snapshot).find(t=>t.id===taskId);return Object.hasOwn(e.estimates,taskId)?e.estimates[taskId]:task?.minutes??null; }
export function normalizeLearningState(input:LearningState):LearningState {
 const state=structuredClone(input);
 if(!state.workEvents){state.workEvents=[];for(const e of state.enrollments)for(const c of e.completions)if(c.completed&&c.kind==='new'&&c.completedAt&&c.localDay&&c.timezone){
  const id=`legacy-completion-${c.claimId}`;c.workEventId=id;c.remainingBefore=initialEstimate(e,c.taskId);
  state.workEvents.push({id,enrollmentId:e.id,taskId:c.taskId,source:'completion',createdAt:c.completedAt,localDay:c.localDay,timezone:c.timezone,effortMinutes:c.effortMinutes,originalEffortMinutes:c.effortMinutes,remainingAfter:0,completionClaimId:c.claimId,pinId:null,invalidatedAt:null,correctedAt:null,legacy:true});
 }}
 for(const e of state.enrollments)e.remaining??={};state.dataVersion=3;state.planningRevision??=state.revision;return state;
}
export function workEventsOf(state:LearningState):WorkEvent[] {return state.workEvents??normalizeLearningState(state).workEvents!;}
export function effectiveRemaining(state:LearningState,enrollmentId:string,taskId:string):number|null {
 const e=state.enrollments.find(e=>e.id===enrollmentId);if(!e)return null;
 if(e.completions.some(c=>c.taskId===taskId&&c.completed))return 0;
 if(e.remaining&&Object.hasOwn(e.remaining,taskId))return e.remaining[taskId];
 return initialEstimate(e,taskId);
}
export function projectedEffortByDay(state:LearningState,timezone?:string):Map<string,number|null> {
 const totals=new Map<string,number|null>();for(const w of workEventsOf(state))if(!w.invalidatedAt){const day=timezone?localDay(w.createdAt,timezone):w.localDay;const previous=totals.get(day);totals.set(day,previous===null||w.effortMinutes===null?null:(previous??0)+w.effortMinutes);}return totals;
}
export function acceptedEffortOn(state:LearningState,day:string,timezone?:string):number|null {const totals=projectedEffortByDay(state,timezone);return totals.has(day)?totals.get(day)!:0;}
export function pinRemaining(state:LearningState,pin:PlanPin):number|null {
 const e=state.enrollments.find(e=>e.id===pin.enrollmentId);if(e?.completions.some(c=>c.taskId===pin.taskId&&c.completed))return 0;
 const events=workEventsOf(state);let lastCheckpoint=-1,covered=0;
 for(const [index,w]of events.entries())if(!w.invalidatedAt&&w.enrollmentId===pin.enrollmentId&&w.taskId===pin.taskId&&w.pinCoverage&&Object.hasOwn(w.pinCoverage,pin.id)){lastCheckpoint=index;covered=Math.max(covered,w.pinCoverage[pin.id]);}
 let used=0;
 for(let index=lastCheckpoint+1;index<events.length;index++){const w=events[index];if(!w.invalidatedAt&&w.pinId===pin.id&&w.enrollmentId===pin.enrollmentId&&w.taskId===pin.taskId){if(w.effortMinutes===null)return null;used+=w.effortMinutes;}}
 return pin.minutes-covered-used;
}
function collectMisses(state:LearningState,today:string){
 const missed=new Set<string>(),overdueDays=new Set<string>(),tasks=new Map<string,{enrollmentId:string;taskId:string}>();
 if(!state.plan)return {missed,overdueDays,tasks};
 const effort=new Map<string,number|null>();
 for(const w of workEventsOf(state))if(!w.invalidatedAt){const key=`${localDay(w.createdAt,state.plan.timezone)}:${w.enrollmentId}:${w.taskId}`;const previous=effort.get(key);effort.set(key,previous===null||w.effortMinutes===null?null:(previous??0)+w.effortMinutes);}
 const controls=activeControls(state),buckets=new Map<string,{day:string;enrollmentId:string;taskId:string;minutes:number}>();
 for(const b of state.plan.result.blocks){
  if(b.day>=today||isPaused(controls,b.day,b.enrollmentId))continue;
  const e=state.enrollments.find(e=>e.id===b.enrollmentId);
  if(!e||e.completions.some(c=>c.taskId===b.taskId&&c.completed&&(c.kind==='prior'||!!c.completedAt&&localDay(c.completedAt,state.plan!.timezone)<=b.day)))continue;
  const ceiling=controls.exceptions[b.day]??state.plan.availability.weekdayMinutes[new Date(`${b.day}T12:00:00Z`).getUTCDay()];if(ceiling===0)continue;
  const key=`${b.day}:${b.enrollmentId}:${b.taskId}`,prev=buckets.get(key);buckets.set(key,{day:b.day,enrollmentId:b.enrollmentId,taskId:b.taskId,minutes:(prev?.minutes??0)+b.minutes});
 }
 for(const b of buckets.values()){
  const accepted=effort.get(`${b.day}:${b.enrollmentId}:${b.taskId}`)??0;
  if(accepted<b.minutes){missed.add(b.day);if(!state.enrollments.find(e=>e.id===b.enrollmentId)?.completions.some(c=>c.taskId===b.taskId&&c.completed)){overdueDays.add(b.day);tasks.set(`${b.enrollmentId}:${b.taskId}`,{enrollmentId:b.enrollmentId,taskId:b.taskId});}}
 }
 return {missed,overdueDays,tasks};
}
export const missedPlanDays=(state:LearningState,today:string)=>[...collectMisses(state,today).missed].sort();
export function recoverySummary(state:LearningState,today:string,timezone?:string):RecoverySummary {
 const current=collectMisses(state,today),days=[...current.overdueDays].sort();
 const history=new Set([...(state.missedStudyDays??[]).map(d=>d.day),...current.missed]);const recent=[...history].filter(d=>d>=addDays(today,-14)&&d<today);
 const zone=timezone??state.plan?.timezone??'UTC';
 const recentWork=workEventsOf(state).some(w=>!w.invalidatedAt&&(w.effortMinutes===null||w.effortMinutes>0)&&localDay(w.createdAt,zone)>=addDays(today,-7));
 const kind=days.length===0?'none':days[0]<addDays(today,-7)&&!recentWork?'long-break':recent.length>=3?'repeated':days.length===1?'one-day':'two-days';
 const timezoneChanged=!!(state.plan&&timezone&&state.plan.timezone!==timezone);
 const inputsChanged=!!(state.plan&&(state.planningRevision??state.revision)>state.plan.baseRevision);
 const backlog=state.plan?.result.unscheduled.some(b=>!state.enrollments.find(e=>e.id===b.enrollmentId)?.completions.some(c=>c.taskId===b.taskId&&c.completed))??false;
 return {missedDays:days,taskIds:[...current.tasks.values()],kind,needsReview:!!current.tasks.size||timezoneChanged||backlog||inputsChanged,timezoneChanged,inputsChanged,recentMissedStudyDays:recent.length,suggestLighterWorkload:recent.length>=3};
}
export function startSmall(state:LearningState,today?:string):{enrollmentId:string;taskId:string;minutes:number|null}|null {
 const controls=activeControls(state);const enrollments=[...state.enrollments].sort((a,b)=>(controls.priorities[a.id]??3)-(controls.priorities[b.id]??3)||a.targetDate.localeCompare(b.targetDate)||a.id.localeCompare(b.id));
 for(const e of enrollments){if(today&&isPaused(controls,today,e.id))continue;for(const t of tasksOf(e.snapshot))if(e.taskIds.includes(t.id)&&!e.completions.some(c=>c.taskId===t.id&&c.completed)&&t.prerequisiteIds.every(id=>e.completions.some(c=>c.taskId===id&&c.completed))){const remaining=effectiveRemaining(state,e.id,t.id);if(remaining===0)continue;return {enrollmentId:e.id,taskId:t.id,minutes:remaining===null?null:Math.min(15,remaining)};}}return null;
}
