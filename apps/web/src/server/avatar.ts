import { saveAvatarSchema } from '@dima/contracts';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { googleAvatar, validateAvatarJpeg } from './avatar-validation';
export async function avatarHandler(request:Request,target?:string):Promise<Response>{
 if(request.method==='OPTIONS')return apiPreflight(request,target?'GET, OPTIONS':'PATCH, OPTIONS');
 let apply=(response:Response)=>response;
 try{
  if(target?request.method!=='GET':request.method!=='PATCH')throw new AuthHttpError('METHOD_NOT_ALLOWED',405);
  if(!target&&!mutationOriginAllowed(request))throw new AuthHttpError('ORIGIN_NOT_ALLOWED',403);
  const auth=await requestAuth(request);apply=auth.apply;
  if(!auth.user)throw new AuthHttpError('AUTH_REQUIRED',401);
  if(target){
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target))throw new AuthHttpError('NOT_FOUND',404);
   const {data,error}=await auth.db.rpc('read_profile_avatar',{p_target:target});
   if(error){const status=error.code?.match(/^PT(\d{3})$/)?.[1];throw new AuthHttpError(status?error.message:'STORAGE_UNAVAILABLE',status?Number(status):503);}
   if(!data?.value)throw new AuthHttpError('NOT_FOUND',404);
   if(data.mode==='google'){
    const location=googleAvatar({avatar_url:data.value});if(!location)throw new AuthHttpError('NOT_FOUND',404);
    return apply(new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}}));
   }
   if(!validateAvatarJpeg(data.value))throw new AuthHttpError('NOT_FOUND',404);
   const tag=`"avatar-${target}-${data.revision}"`;
   const headers={'Content-Type':'image/jpeg','Cache-Control':'private, no-cache','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','ETag':tag};
   // Authorization runs before conditional response, so blocked/hidden access cannot reuse a 304.
   if(request.headers.get('if-none-match')===tag)return apply(new Response(null,{status:304,headers}));
   const bytes=Uint8Array.from(atob(data.value.slice(23)),char=>char.charCodeAt(0));
   return apply(new Response(bytes,{headers}));
  }
  const expectedActor=request.headers.get('X-Dima-Account-Id');
  if(expectedActor!==null&&expectedActor!==auth.user.id||!request.headers.get('authorization')&&expectedActor===null)throw new AuthHttpError('ACCOUNT_CHANGED',409);
  const parsed=saveAvatarSchema.safeParse(await readJson(request,50000));
  if(!parsed.success||parsed.data.mode==='custom'&&!validateAvatarJpeg(parsed.data.data)||parsed.success&&parsed.data.mode!=='custom'&&parsed.data.data!==null)throw new AuthHttpError('INVALID_INPUT',422);
  const {data,error}=await auth.db.rpc('save_profile_avatar',{p_command:parsed.data});
  if(error){const status=error.code?.match(/^PT(\d{3})$/)?.[1];throw new AuthHttpError(status?error.message:'STORAGE_UNAVAILABLE',status?Number(status):503);}
  return apply(authJson({data}));
 }catch(error){return apply(authFailure(error));}
}
