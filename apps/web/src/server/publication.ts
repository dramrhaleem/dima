import type { SupabaseClient } from '@supabase/supabase-js';
import { publicationCommandSchema, type PublicationRequest, type CatalogAdministrationItem } from '../../../../packages/contracts/src/publication';
import { offeringSchema } from '@dima/contracts';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';

type ReviewRow={id:string;draft_id:string;offering_id:string;snapshot:unknown;source_notes:string;rights_attested:true;status:PublicationRequest['status'];revision:number;created_at:string;reviewed_at:string|null;decision_reason:string|null};
export function publicationDto(row:ReviewRow):PublicationRequest {
 return {id:row.id,draftId:row.draft_id,offeringId:row.offering_id,snapshot:offeringSchema.parse(row.snapshot),sourceNotes:row.source_notes,rightsAttested:row.rights_attested,status:row.status,revision:row.revision,createdAt:row.created_at,reviewedAt:row.reviewed_at,decisionReason:row.decision_reason};
}
const requestFields='id,draft_id,offering_id,snapshot,source_notes,rights_attested,status,revision,created_at,reviewed_at,decision_reason';
async function canReview(db:SupabaseClient,actor:string):Promise<boolean>{
 const {data,error}=await db.from('account_roles').select('role').eq('user_id',actor).maybeSingle();if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);return data?.role==='admin';
}
export async function publicationHandler(request:Request,area:'owner'|'reviews'|'catalog'='owner',id?:string):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,'GET, POST, OPTIONS');
 let apply=(response:Response)=>response;
 try{
  if(!['GET','POST'].includes(request.method))throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if(request.method==='POST'&&!mutationOriginAllowed(request))throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const auth=await requestAuth(request);apply=auth.apply;if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  const actor=auth.user.id,expectedActor=request.headers.get('X-Dima-Account-Id');
  if((expectedActor!==null&&expectedActor!==actor)||(request.method==='POST'&&!request.headers.get('authorization')&&expectedActor===null))throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const reviewer=await canReview(auth.db,actor);
  if(area!=='owner'&&!reviewer)throw new AuthHttpError('FORBIDDEN',403);
  if(request.method==='GET'){
   const cursor=new URL(request.url).searchParams.get('cursor');
   if(cursor&&(cursor.length>120||!/^[A-Za-z0-9_-]+$/.test(cursor)))throw new AuthHttpError('INVALID_INPUT',422);
   if(area==='catalog'){
    let query=auth.db.from('catalog_offerings').select('id,status,revision,curriculum_versions!catalog_offerings_current_version_id_fkey(snapshot)').order('id').limit(31);
    if(cursor)query=query.gt('id',cursor);
    const {data,error}=await query;if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
    const rows=data??[];
    const offerings:CatalogAdministrationItem[]=rows.slice(0,30).map(row=>{const snapshot=offeringSchema.parse((row.curriculum_versions as unknown as {snapshot:unknown}).snapshot);return {id:row.id,status:row.status,revision:row.revision,title:snapshot.title,provider:snapshot.provider,version:snapshot.version};});
    return apply(authJson({data:{offerings,nextCursor:rows.length>30?rows[29].id:null}}));
   }
   let query=auth.db.from('publication_requests').select(requestFields).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(21);
   if(area==='owner')query=query.eq('owner_id',actor);
   const draftId=new URL(request.url).searchParams.get('draft');
   if(draftId){if(area!=='owner'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(draftId))throw new AuthHttpError('INVALID_INPUT',422);query=query.eq('draft_id',draftId);}
   if(id)query=query.eq('id',id);else if(cursor){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor))throw new AuthHttpError('INVALID_INPUT',422);
    let anchorQuery=auth.db.from('publication_requests').select('created_at').eq('id',cursor);
    if(area==='owner')anchorQuery=anchorQuery.eq('owner_id',actor);
    if(draftId)anchorQuery=anchorQuery.eq('draft_id',draftId);
    const {data:anchor,error:anchorError}=await anchorQuery.maybeSingle();
    if(anchorError)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
    if(!anchor)throw new AuthHttpError('INVALID_INPUT',422);
    query=query.or(`created_at.lt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.lt.${cursor})`);
   }
   const status=new URL(request.url).searchParams.get('status');
   if(status){if(!['pending','approved','rejected','withdrawn'].includes(status))throw new AuthHttpError('INVALID_INPUT',422);query=query.eq('status',status);}
   const {data,error}=await query;if(error)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
   if(id&&!data?.length)throw new AuthHttpError('NOT_FOUND',404);
   const rows=(data??[]) as ReviewRow[];
   return apply(authJson({data:id?publicationDto(rows[0]):{requests:rows.slice(0,20).map(publicationDto),canReview:reviewer,nextCursor:rows.length>20?rows[19].id:null}}));
  }
  const parsed=publicationCommandSchema.safeParse(await readJson(request,16000));if(!parsed.success)throw new AuthHttpError('INVALID_INPUT',422);
  const command=parsed.data;
  if(area==='owner'&&!['submit','withdraw'].includes(command.type)||area==='reviews'&&command.type!=='review'||area==='catalog'&&command.type!=='setPublication')throw new AuthHttpError('INVALID_INPUT',422);
  if(id&&('requestId' in command?command.requestId:'offeringId' in command?command.offeringId:undefined)!==id)throw new AuthHttpError('INVALID_INPUT',422);
  const {data,error}=await auth.db.rpc('publication_command',{p_command:command});
  if(error){const status=error.code?.match(/^PT(\d{3})$/)?.[1];if(status)throw new AuthHttpError(error.message,Number(status));throw new AuthHttpError('STORAGE_UNAVAILABLE',503);}
  return apply(authJson({data,operationId:command.operationId}));
 }catch(error){return apply(authFailure(error));}
}
