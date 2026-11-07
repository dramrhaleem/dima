import { catalogHandler } from '../../../../../src/server/catalog';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return catalogHandler(request,(await params).id);}
export const OPTIONS=GET;
