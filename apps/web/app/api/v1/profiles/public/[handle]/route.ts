export const dynamic = 'force-dynamic';
import { publicProfileHandler } from '../../../../../../src/server/social';
type Context = { params:Promise<{handle:string}> };
export async function GET(request:Request,context:Context){return publicProfileHandler(request,(await context.params).handle);}
