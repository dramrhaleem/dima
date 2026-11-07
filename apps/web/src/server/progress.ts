import type { LearningState, ProgressData } from '@dima/contracts';
import { courseProgress, utcWindow } from '../../../../packages/domain/src/progress';
import { emptyLearningState, normalizeLearningState } from '../../../../packages/domain/src/learning';
import { apiPreflight, AuthHttpError, authFailure, authJson, requestAuth } from './auth';
import { dbError } from './social';
export async function progressHandler(request:Request):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, OPTIONS');
 let apply=(r:Response)=>r;
 try{
  if(request.method!=='GET')throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const expected=request.headers.get('X-Dima-Account-Id');if(expected!==null&&expected!==auth.user.id)throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const params=new URL(request.url).searchParams,period=params.get('period')??'week',anchor=params.get('anchor');
  if(!['week','month'].includes(period)||[...params.keys()].some(k=>!['period','anchor'].includes(k))||(anchor&&(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||!Number.isFinite(Date.parse(anchor)))))throw new AuthHttpError('INVALID_INPUT',422);
  const now=new Date(),window=utcWindow(period as 'week'|'month',anchor?new Date(anchor):now);
  const [{data:profile,error:pe},{data:row,error:we},{data:summary,error:te},{data:preferences,error:ge}]=await Promise.all([
   auth.db.from('account_profiles').select('timezone,onboarded').eq('user_id',auth.user.id).maybeSingle(),
   auth.db.from('learning_workspaces').select('state').eq('user_id',auth.user.id).maybeSingle(),
   auth.db.rpc('read_progress_time',{p_start:window.start,p_end:window.end}),
   auth.db.rpc('read_profile_settings',{p_week:window.start.slice(0,10)}),
  ]);
  if(pe||we)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);if(te)throw dbError(te);if(ge)throw dbError(ge);
  if(!profile?.onboarded)throw new AuthHttpError('ONBOARDING_REQUIRED',409);
  const state=normalizeLearningState((row?.state??emptyLearningState()) as LearningState);
  const days=new Set<string>(summary.activeDays);
  // Only first genuine completion is a meaningful learning day; partial work alone is not.
  for(const e of state.enrollments)for(const c of e.completions){if(c.completed&&c.kind==='new'&&c.firstCompletedAt&&c.firstCompletedAt>=window.start&&c.firstCompletedAt<window.end)days.add(c.firstCompletedAt.slice(0,10));}
  const {activeDays:_activeDays,...time}=summary;void _activeDays;
  const data:ProgressData={accountId:auth.user.id,timezone:profile.timezone,sourceRevision:state.revision,calculatedAt:now.toISOString(),window,courses:state.enrollments.map(courseProgress),time,
   rhythm:{activeDays:days.size,days:[...days].sort(),source:'time-ledger-and-work-events',goal:period==='week'?(preferences?.currentGoal?.days??null):null},
   planHealth:{status:state.plan?.result.status??'not-planned',missingEstimates:state.plan?.result.missingTasks??0,provisionalEstimates:state.plan?.result.provisionalTasks??0,outcomes:state.plan?.result.outcomes??[]}};
  return apply(authJson({data}));
 }catch(error){return apply(authFailure(error));}
}
