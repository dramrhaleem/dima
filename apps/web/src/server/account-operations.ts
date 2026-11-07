import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accountDeletionCommandSchema, accountOperationIdSchema } from '../../../../packages/contracts/src/operations';
import { apiPreflight, appOrigin, AuthHttpError, authEnvironment, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { environment } from './foundation';

const cookieName=()=>appOrigin().startsWith('https:')?'__Host-dima-deletion':'dima-deletion';
const cookieSecret=(request:Request)=>{const match=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName()}=`));return match?.slice(cookieName().length+1)??'';};
function setSecret(response:Response,secret:string){response.headers.append('Set-Cookie',`${cookieName()}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${appOrigin().startsWith('https:')?'; Secure':''}`);return response;}
async function hash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function privilegedClient():SupabaseClient {
 const env=environment() as {SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string};
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new AuthHttpError('SERVICE_NOT_CONFIGURED',503);
 return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});
}
function isolatedAuth(){const env=authEnvironment();if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)throw new AuthHttpError('SERVICE_NOT_CONFIGURED',503);return createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}});}
function claims(token:string):Record<string,unknown>{try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))) as Record<string,unknown>;}catch{throw new AuthHttpError('AUTH_REQUIRED',401);}}
/** Called only for the token returned by this server's OTP exchange, after getUser verifies it. */
export function freshEmailProof(value:Record<string,unknown>,actor:string,startedAt:string,now=Date.now()):boolean {
 const start=Math.floor(Date.parse(startedAt)/1000),current=Math.floor(now/1000);
 return value.sub===actor&&Number.isFinite(start)&&Array.isArray(value.amr)&&value.amr.some((entry:unknown)=>{
  if(!entry||typeof entry!=='object')return false;const amr=entry as {method?:unknown;timestamp?:unknown};
  return amr.method==='otp'&&typeof amr.timestamp==='number'&&Number.isInteger(amr.timestamp)&&amr.timestamp>=start&&amr.timestamp<=current&&current-amr.timestamp<=600;
 });
}
async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error){const status=error.code?.match(/^PT(\d{3})$/)?.[1];throw new AuthHttpError(status?error.message:'STORAGE_UNAVAILABLE',status?Number(status):503);}return data;}
async function sessionId(request:Request,db:SupabaseClient,actor:string){
 const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');
 const token=bearer??(await db.auth.getSession()).data.session?.access_token;
 if(!token)throw new AuthHttpError('AUTH_REQUIRED',401);
 // requestAuth validated this account's token; getClaims additionally verifies the exact session token.
 const verified=await db.auth.getClaims(token);if(verified.error||!verified.data)throw new AuthHttpError('AUTH_REQUIRED',401);
 const value=verified.data.claims;
 if(value.sub!==actor||typeof value.session_id!=='string')throw new AuthHttpError('AUTH_REQUIRED',401);return value.session_id;
}

export async function accountExportHandler(request:Request):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, OPTIONS');let apply=(r:Response)=>r;
 try{
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const expected=request.headers.get('X-Dima-Account-Id');if(expected&&expected!==auth.user.id)throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const data=await rpc(auth.db,'export_own_account',{});
  const body=JSON.stringify({...data,email:auth.user.email??null},null,2);
  return apply(new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="dima-account-${new Date().toISOString().slice(0,10)}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
 }catch(error){return apply(authFailure(error));}
}

export async function accountDeletionHandler(request:Request):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, POST, OPTIONS');let apply=(r:Response)=>r;
 try{
  if(!['GET','POST'].includes(request.method))throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if(request.method==='POST'&&!mutationOriginAllowed(request))throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const admin=privilegedClient();
  if(request.method==='GET'){
   const requestId=new URL(request.url).searchParams.get('requestId');if(!requestId||!accountOperationIdSchema.safeParse(requestId).success)throw new AuthHttpError('INVALID_INPUT',422);
   const secret=cookieSecret(request);if(!/^[a-f0-9]{64}$/.test(secret))throw new AuthHttpError('NOT_FOUND',404);
   // Minimal status survives Auth deletion. A browser-bound 256-bit secret is still required.
   const {data,error}=await admin.from('account_deletion_requests').select('status,completed_at,expires_at,created_at').eq('id',requestId).eq('secret_hash',await hash(secret)).maybeSingle();
   if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);if(!data||Date.parse(data.created_at)<Date.now()-86400000)throw new AuthHttpError('NOT_FOUND',404);
   return authJson({data:{requestId,status:data.status,completedAt:data.completed_at,expiresAt:data.expires_at}});
  }
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const actor=auth.user.id,expected=request.headers.get('X-Dima-Account-Id');
  if(expected!==actor)throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const parsed=accountDeletionCommandSchema.safeParse(await readJson(request));if(!parsed.success)throw new AuthHttpError('INVALID_INPUT',422);
  const command=parsed.data,session=await sessionId(request,auth.db,actor);
  if(command.type==='start'){
   if(!auth.user.email||!auth.user.email_confirmed_at)throw new AuthHttpError('CONFIRMED_EMAIL_REQUIRED',409);
   const bytes=crypto.getRandomValues(new Uint8Array(32)),secret=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
   const result=await rpc(admin,'account_deletion_challenge',{p_id:command.operationId,p_actor:actor,p_session:session,p_secret_hash:await hash(secret)});
   const proof=isolatedAuth();
   const sent=await proof.auth.signInWithOtp({email:auth.user.email,options:{shouldCreateUser:false}});
   if(sent.error){await admin.from('account_deletion_requests').update({status:'failed',error_code:'EMAIL_DELIVERY_UNAVAILABLE'}).eq('id',command.operationId);throw new AuthHttpError('EMAIL_DELIVERY_UNAVAILABLE',503);}
   const updated=await admin.from('account_deletion_requests').update({status:'codeSent'}).eq('id',command.operationId);
   if(updated.error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
   return apply(setSecret(authJson({data:{...result,status:'codeSent'}}),secret));
  }
  const secret=cookieSecret(request);if(!/^[a-f0-9]{64}$/.test(secret))throw new AuthHttpError('CODE_RESTART_REQUIRED',409);
  const bound={p_id:command.requestId,p_actor:actor,p_session:session,p_secret_hash:await hash(secret)};
  const attempt=await rpc(admin,'account_deletion_attempt',bound);
  if(attempt.status!=='pending'){
   if(command.type!=='confirm')throw new AuthHttpError('CODE_REQUIRED',409);
   const proof=isolatedAuth();
   try{
    const exchange=await proof.auth.verifyOtp({email:auth.user.email!,token:command.code,type:'email'});
    if(exchange.error||!exchange.data.session)throw new AuthHttpError('CODE_INVALID',401);
    const token=exchange.data.session.access_token,verified=await proof.auth.getUser(token);
    if(verified.error||verified.data.user?.id!==actor||!freshEmailProof(claims(token),actor,attempt.createdAt))throw new AuthHttpError('CODE_INVALID',401);
    const original=await auth.db.auth.getUser(request.headers.get('authorization')?.slice(7));if(original.error||original.data.user?.id!==actor)throw new AuthHttpError('AUTH_REQUIRED',401);
    await rpc(admin,'account_deletion_prepare',bound);
   }finally{await proof.auth.signOut({scope:'local'}).catch(()=>undefined);}
  }
  const removed=await admin.auth.admin.deleteUser(actor);
  if(removed.error){await admin.from('account_deletion_requests').update({status:'failed',error_code:'AUTH_DELETE_FAILED'}).eq('id',command.requestId);return apply(authJson({data:{requestId:command.requestId,status:'failed',retryable:true}},503));}
  // The Auth transaction trigger records done together with all local FK cleanup.
  const finished=await admin.from('account_deletion_requests').select('status,completed_at').eq('id',command.requestId).maybeSingle();
  if(finished.error||finished.data?.status!=='done')throw new AuthHttpError('DELETE_STATUS_UNAVAILABLE',503);
  return apply(authJson({data:{requestId:command.requestId,status:'done',completedAt:finished.data.completed_at}}));
 }catch(error){return apply(authFailure(error));}
}
