import { publicationHandler } from '../../../../../src/server/publication';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return publicationHandler(request,'owner',(await params).id);}
export const OPTIONS=GET;
