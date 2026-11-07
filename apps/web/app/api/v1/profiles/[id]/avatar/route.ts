import { avatarHandler } from '../../../../../../src/server/avatar';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return avatarHandler(request,(await params).id);}
export const OPTIONS=GET;
