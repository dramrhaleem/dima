import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { offeringSchema, type Offering } from '@dima/contracts';
import { apiPreflight, AuthHttpError, authEnvironment, authFailure, authJson } from './auth';

/** The database is authoritative: withdrawn entries must never return from a seed fallback. */
export async function readCatalog(db?:SupabaseClient,id?:string):Promise<Offering[]> {
 if(!db){const env=authEnvironment();if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)throw new AuthHttpError('SERVICE_NOT_CONFIGURED',503);db=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});}
 let query=db.from('catalog_offerings').select('id,curriculum_versions!catalog_offerings_current_version_id_fkey(snapshot)').eq('status','published').order('id').limit(500);
 if(id)query=query.eq('id',id);
 const {data,error}=await query;if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
 return (data??[]).map(row=>{const version=row.curriculum_versions as unknown as {snapshot:unknown}|null;if(!version)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);return offeringSchema.parse(version.snapshot);});
}
export async function catalogHandler(request:Request,id?:string):Promise<Response> {
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, OPTIONS');
 try{
  const origin=request.headers.get('origin'),cors=origin?apiPreflight(request,'GET, OPTIONS'):null;
  if(cors&&cors.status!==204)return cors;
  const catalog=await readCatalog(undefined,id);
  const response=id&&!catalog.length?authJson({error:{code:'NOT_FOUND'}},404):authJson({data:id?catalog[0]:catalog});
  if(origin&&cors)response.headers.set('Access-Control-Allow-Origin',cors.headers.get('Access-Control-Allow-Origin')!);
  return response;
 }catch(error){return authFailure(error);}
}
