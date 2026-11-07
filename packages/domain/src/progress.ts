import type { CourseProgress } from '../../contracts/src/progress';
import type { Enrollment } from '../../contracts/src/learning';
export const progressWeights:Readonly<Record<string,number>> = Object.freeze({reading:1,video:1,quiz:2,assignment:4,project:8});
export function courseProgress(enrollment:Enrollment):CourseProgress {
 const selected=new Set(enrollment.taskIds),done=new Map(enrollment.completions.map(c=>[c.taskId,c]));
 const tasks=enrollment.snapshot.courses.flatMap(c=>c.modules.flatMap(m=>m.tasks)).filter(t=>selected.has(t.id)&&t.requirement==='required');
 let requiredWeight=0,priorWeight=0,newWeight=0,completedSteps=0,classificationNeeded=false;
 for(const task of tasks){const weight=Object.hasOwn(progressWeights,task.kind)?progressWeights[task.kind]:undefined;if(weight===undefined)classificationNeeded=true;else requiredWeight+=weight;const completion=done.get(task.id);if(completion?.completed){completedSteps++;if(weight!==undefined){if(completion.kind==='prior')priorWeight+=weight;else newWeight+=weight;}}}
 return {enrollmentId:enrollment.id,offeringId:enrollment.offeringId,title:enrollment.snapshot.title,version:enrollment.snapshot.version,requiredWeight:classificationNeeded?null:requiredWeight,completedWeight:priorWeight+newWeight,priorWeight,newWeight,requiredSteps:tasks.length,completedSteps,percentage:classificationNeeded||!requiredWeight?null:Math.round((priorWeight+newWeight)/requiredWeight*1000)/10,classificationNeeded};
}
/** Monday-inclusive UTC windows; local display timezone never shifts board boundaries. */
export function utcWindow(period:'week'|'month',anchor:Date=new Date()):{start:string;end:string}{
 const start=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),anchor.getUTCDate()));
 if(period==='month')start.setUTCDate(1);else start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
 const end=new Date(start);if(period==='month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+7);
 return {start:start.toISOString(),end:end.toISOString()};
}
export function competitionRanks<T extends {score:number;profileId:string}>(rows:T[]):Array<T&{rank:number}>{
 let previous:number|undefined,rank=0;return [...rows].sort((a,b)=>b.score-a.score||a.profileId.localeCompare(b.profileId)).map((row,index)=>{if(row.score!==previous)rank=index+1;previous=row.score;return {...row,rank};});
}
