export const dynamic = 'force-dynamic';
import { socialHandler } from '../../../../../src/server/social';
function handler(request:Request){return socialHandler(request,'notifications');}
export {handler as GET,handler as POST,handler as OPTIONS};
