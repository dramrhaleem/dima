import type { Completion, CurriculumUpgradePreview, Enrollment, LearningState, LearningTask, Offering } from '../../contracts/src/learning';
import { courseProgress } from './progress';
import { tasksOf } from './recovery';

/** Reordering and estimate adjustments are not new learning credit. */
export function sameActivityMeaning(a:LearningTask,b:LearningTask):boolean {
 return a.id===b.id && a.title===b.title && a.kind===b.kind && a.sourceUrl===b.sourceUrl && a.requirement===b.requirement && JSON.stringify([...a.prerequisiteIds].sort())===JSON.stringify([...b.prerequisiteIds].sort());
}
type SavedActivity={task:LearningTask;prior:boolean;completion?:Completion;estimate?:number;remaining?:number|null};
/** Latest selected state wins, including an explicit undo. Archived work may return
 * in a later outline; restore its original claim instead of awarding it twice. */
function savedActivities(e:Enrollment):Map<string,SavedActivity>{
 const records=new Map<string,SavedActivity>();
 for(const scope of [...(e.upgradeHistory??[]),e]) {
  const selected=new Set(scope.taskIds);
  for(const task of tasksOf(scope.snapshot))if(selected.has(task.id))records.set(task.id,{task,prior:scope.priorTaskIds.includes(task.id),completion:scope.completions.find(c=>c.taskId===task.id),estimate:scope.estimates[task.id],remaining:scope.remaining?.[task.id]});
 }
 return records;
}
export function describeUpgrade(e:Enrollment,target:Offering,includeNewRequired:boolean,state:LearningState):Pick<CurriculumUpgradePreview,'taskIds'|'mapped'|'added'|'removed'|'unresolved'|'requiredWeightBefore'|'requiredWeightAfter'|'completedWeightBefore'|'completedWeightAfter'|'removedCompleted'|'affectedPins'> {
 const oldTasks=new Map(tasksOf(e.snapshot).map(t=>[t.id,t])), saved=savedActivities(e),next=tasksOf(target), nextTasks=new Map(next.map(t=>[t.id,t]));
 const mapped=next.filter(t=>{const old=saved.get(t.id);return !!old&&sameActivityMeaning(old.task,t);}).map(t=>t.id);
 const removed=e.taskIds.filter(id=>!nextTasks.has(id));
 const unresolved=next.filter(t=>saved.has(t.id)&&!mapped.includes(t.id)).map(t=>t.id);
 const added=next.filter(t=>!oldTasks.has(t.id)&&!saved.has(t.id)).map(t=>t.id);
 const taskIds=next.filter(t=>mapped.includes(t.id)||(includeNewRequired&&added.includes(t.id)&&t.requirement==='required')).map(t=>t.id);
 const completions=mapped.flatMap(id=>{const c=saved.get(id)?.completion;return c?[c]:[];});
 const before=courseProgress(e),after=courseProgress({...e,snapshot:target,taskIds,completions});
 return {taskIds,mapped,added,removed,unresolved,requiredWeightBefore:before.requiredWeight,requiredWeightAfter:after.requiredWeight,completedWeightBefore:before.completedWeight,completedWeightAfter:after.completedWeight,removedCompleted:e.completions.filter(c=>c.completed&&removed.includes(c.taskId)).length,affectedPins:state.plan?.controls?.pins.filter(p=>p.enrollmentId===e.id&&!taskIds.includes(p.taskId)).length??0};
}
export function applyCurriculumUpgrade(e:Enrollment,p:CurriculumUpgradePreview,now:string):void {
 const saved=savedActivities(e);
 // Retain original claim IDs/timestamps, old scopes and estimates for export/history.
 e.upgradeHistory=[...(e.upgradeHistory??[]),{upgradedAt:now,snapshot:structuredClone(e.snapshot),taskIds:[...e.taskIds],priorTaskIds:[...e.priorTaskIds],completions:structuredClone(e.completions),estimates:{...e.estimates},remaining:{...e.remaining}}];
 e.snapshot=structuredClone(p.target);e.taskIds=[...p.taskIds];
 e.priorTaskIds=p.mapped.filter(id=>saved.get(id)?.prior);
 e.completions=p.mapped.flatMap(id=>{const c=saved.get(id)?.completion;return c?[structuredClone(c)]:[];});
 e.estimates=Object.fromEntries(p.mapped.flatMap(id=>{const v=saved.get(id)?.estimate;return v===undefined?[]:[[id,v]];}));
 e.remaining=Object.fromEntries(p.mapped.flatMap(id=>{const v=saved.get(id)?.remaining;return v===undefined?[]:[[id,v]];}));
}
