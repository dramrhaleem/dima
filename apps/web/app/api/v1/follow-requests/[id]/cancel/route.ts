export const dynamic = 'force-dynamic';
import { socialHandler } from '../../../../../../src/server/social';
type Context = { params:Promise<{id:string}> };
async function handler(request:Request,context:Context){return socialHandler(request,'cancel',(await context.params).id);}
export {handler as GET,handler as POST,handler as OPTIONS};
