import { socialCommandSchema } from '@dima/contracts';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
export async function socialHandler(request:Request,view:string,key:string|null=null):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, POST, OPTIONS');
 let apply=(r:Response)=>r;
 try{
  if(!['GET','POST'].includes(request.method))throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if(request.method==='POST'&&!mutationOriginAllowed(request))throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const expected=request.headers.get('X-Dima-Account-Id');
  if((expected!==null&&expected!==auth.user.id)||(request.method==='POST'&&!request.headers.get('authorization')&&expected===null))throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const params=new URL(request.url).searchParams,period=params.get('period')??'week',category=params.get('category')??'all';
  if(key!==null&&key.length>240)throw new AuthHttpError('INVALID_INPUT',422);
  if(request.method==='GET'){
   if([...params.keys()].some(k=>!['period','category'].includes(k))||!(view==='course'?['week','overall']:['week','month']).includes(period)||!['all','learning','work'].includes(category))throw new AuthHttpError('INVALID_INPUT',422);
   const {data,error}=await auth.db.rpc('read_social',{p_view:view,p_key:key,p_period:period,p_category:category});
   if(error)throw dbError(error);
   return apply(authJson({data}));
  }
  const input=await readJson(request,12000);
  const handleCommand = view==='follow'&&input&&typeof input==='object'&&'type' in input&&input.type==='follow'&&'targetId' in input&&typeof input.targetId==='string'&&/^[a-z][a-z0-9-]{2,29}$/i.test(input.targetId);
  const parsed=socialCommandSchema.safeParse(handleCommand?{...input,targetId:'00000000-0000-4000-8000-000000000000'}:input);
  if(!parsed.success)throw new AuthHttpError('INVALID_INPUT',422);
  const command=parsed.data;
  const allowed:Record<string,string[]>={sharing:['setSharing'],people:['setPeople'],participation:['setParticipation'],follow:['follow'],accept:['accept'],decline:['decline'],cancel:['cancel'],revoke:['revoke'],blocks:['block'],unblock:['unblock'],notifications:['readNotifications']};
  if(!allowed[view]?.includes(command.type))throw new AuthHttpError('INVALID_INPUT',422);
  if(key!==null&&(('relationshipId' in command&&command.relationshipId!==key)||('blockId' in command&&command.blockId!==key)))throw new AuthHttpError('INVALID_INPUT',422);
  const {data,error}=await auth.db.rpc(handleCommand?'follow_public_handle':'execute_social',{p_command:handleCommand?input:command});
  if(error)throw dbError(error);
  return apply(authJson(data));
 }catch(error){return apply(authFailure(error));}
}
export function dbError(error:{code?:string;message:string}):AuthHttpError{
 const status=Number(error.code?.match(/^PT(\d{3})$/)?.[1]);
 return Number.isFinite(status)?new AuthHttpError(error.message,status):new AuthHttpError('STORAGE_UNAVAILABLE',503);
}

/** This opt-in public surface deliberately returns no account ID or private metrics. */
export async function publicProfileHandler(request: Request, handle: string): Promise<Response> {
 let apply = (r: Response) => r;
 try {
  if (request.method !== 'GET') throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
  if (!/^[a-z][a-z0-9-]{2,29}$/i.test(handle)) throw new AuthHttpError('NOT_FOUND', 404);
  const auth = await requestAuth(request); apply = auth.apply;
  const { data, error } = await auth.db.rpc('read_public_profile', { p_handle: handle.toLowerCase() });
  if (error) throw dbError(error);
  return apply(authJson({ data }));
 } catch (error) { return apply(authFailure(error)); }
}
export async function profileSettingsHandler(request: Request): Promise<Response> {
 if (request.method === 'OPTIONS') return apiPreflight(request, 'GET, POST, OPTIONS');
 let apply = (r: Response) => r;
 try {
  if (!['GET','POST'].includes(request.method)) throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if (request.method === 'POST' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const auth = await requestAuth(request); apply = auth.apply;
  if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED',401);
  const expected = request.headers.get('X-Dima-Account-Id');
  if ((expected !== null && expected !== auth.user.id) || (request.method === 'POST' && !request.headers.get('authorization') && expected === null)) throw new AuthHttpError('ACCOUNT_CHANGED',409);
  if (request.method === 'GET') {
   const { data,error } = await auth.db.rpc('read_profile_settings'); if (error) throw dbError(error);
   return apply(authJson({data}));
  }
  const input = await readJson(request,4096);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthHttpError('INVALID_INPUT',422);
  const command = input as Record<string,unknown>;
  const common = ['type','operationId','expectedRevision'];
  const allowed = command.type === 'setPublicLink' ? [...common,'handle','publicLink','bio','consentVersion'] : command.type === 'setRhythmGoal' ? [...common,'days'] : [];
  if (!allowed.length || Object.keys(command).some(key => !allowed.includes(key)) || typeof command.operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(command.operationId) || !Number.isSafeInteger(command.expectedRevision) || Number(command.expectedRevision)<0) throw new AuthHttpError('INVALID_INPUT',422);
  if (command.type === 'setPublicLink' && (typeof command.handle !== 'string' || command.handle.length>30 || typeof command.publicLink !== 'boolean' || typeof command.bio !== 'string' || command.bio.length>280 || command.consentVersion !== 1)) throw new AuthHttpError('INVALID_INPUT',422);
  if (command.type === 'setRhythmGoal' && command.days !== null && (!Number.isInteger(command.days) || Number(command.days)<1 || Number(command.days)>7)) throw new AuthHttpError('INVALID_INPUT',422);
  const {data,error} = await auth.db.rpc('execute_profile_settings',{p_command:command}); if(error) throw dbError(error);
  return apply(authJson(data));
 } catch(error) { return apply(authFailure(error)); }
}
