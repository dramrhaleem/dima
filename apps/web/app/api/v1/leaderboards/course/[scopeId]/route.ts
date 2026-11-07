export const dynamic = 'force-dynamic';
import { socialHandler } from '../../../../../../src/server/social';
type Context = { params:Promise<{scopeId:string}> };
async function handler(request:Request,context:Context){return socialHandler(request,'course',(await context.params).scopeId);}
export {handler as GET,handler as POST,handler as OPTIONS};
