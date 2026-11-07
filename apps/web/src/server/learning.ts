import { createClient } from '@supabase/supabase-js';
import { learningCommandSchema, type LearningData, type LearningState } from '@dima/contracts';
import { emptyLearningState, LearningError, localDay, normalizeLearningState, transitionLearning } from '../../../../packages/domain/src/learning';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { environment } from './foundation';
import { readCatalog } from './catalog';

export async function learningHandler(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, POST, OPTIONS');
 let apply=(r:Response)=>r;
 try {
  if(!['GET','POST'].includes(request.method))throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if(request.method==='POST'&&!mutationOriginAllowed(request))throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const actor=auth.user.id,expectedActor=request.headers.get('X-Dima-Account-Id');
  if(request.method==='POST'&&((expectedActor!==null&&expectedActor!==actor)||(!request.headers.get('authorization')&&expectedActor===null)))throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const {data:profile,error:pe}=await auth.db.from('account_profiles').select('revision,timezone,onboarded').eq('user_id',actor).maybeSingle();
  if(pe)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);if(!profile?.onboarded)throw new AuthHttpError('ONBOARDING_REQUIRED',409);
  const now=new Date().toISOString(),today=localDay(now,profile.timezone);
  const payload=(state:LearningState):LearningData=>({accountId:actor,state,localDay:today,timezone:profile.timezone});
  const {data:row,error}=await auth.db.from('learning_workspaces').select('state').eq('user_id',actor).maybeSingle();
  if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
  const state=normalizeLearningState((row?.state??emptyLearningState()) as LearningState);
  if(request.method==='GET')return apply(authJson({data:payload(state)}));
  // Private outlines can be larger than account commands; the streamed bound remains explicit.
  const parsed=learningCommandSchema.safeParse(await readJson(request,600000));
  if(!parsed.success)throw new AuthHttpError('INVALID_INPUT',422);
  const command=parsed.data;
  const {data:receipt,error:re}=await auth.db.from('learning_operations').select('command,result').eq('user_id',actor).eq('operation_id',command.operationId).maybeSingle();
  if(re)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
  if(receipt){if(stableJson(receipt.command)!==stableJson(command))throw new AuthHttpError('IDEMPOTENCY_MISMATCH',409);const latest=await auth.db.from('learning_workspaces').select('state').eq('user_id',actor).single();if(latest.error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);return apply(authJson({data:payload(normalizeLearningState(latest.data.state as LearningState)),...(receipt.result.previewId?{previewId:receipt.result.previewId}:{}),operationId:command.operationId,replayed:true}));}
  const upgradeEnrollment=command.type==='previewUpgrade'?state.enrollments.find(e=>e.id===command.enrollmentId):command.type==='applyUpgrade'?state.enrollments.find(e=>e.id===state.upgradePreviews?.find(p=>p.id===command.previewId)?.enrollmentId):undefined;
  const catalog=command.type==='enroll'?await readCatalog(auth.db,command.offeringId):upgradeEnrollment?await readCatalog(auth.db,upgradeEnrollment.offeringId):[];
  if(command.type==='saveDraft'){const reserved=await auth.db.rpc('catalog_id_reserved',{p_id:command.draft.id});if(reserved.error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);if(reserved.data)throw new AuthHttpError('ID_RESERVED',422);}
  const result=transitionLearning(state,command,{now,timezone:profile.timezone,profileRevision:profile.revision,catalog,uuid:()=>crypto.randomUUID()});
  const env=environment() as {SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string};
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new AuthHttpError('SERVICE_NOT_CONFIGURED',503);
  const writer=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});
  const {data:saved,error:se}=await writer.rpc('commit_learning_command',{p_actor:actor,p_expected:command.expectedRevision,p_profile_revision:profile.revision,p_command:command,p_result:result});
  if(se){if(se.code==='PT409')throw new AuthHttpError(se.message,409);throw new AuthHttpError('STORAGE_UNAVAILABLE',503);}
  return apply(authJson({data:payload(saved.state),...(saved.previewId?{previewId:saved.previewId}:{}),operationId:command.operationId,serverTime:now}));
 }catch(error){return apply(authFailure(error instanceof LearningError?new AuthHttpError(error.code,error.status):error));}
}
function stableJson(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(',')+'}';
}
