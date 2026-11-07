import { avatarHandler } from '../../../../../src/server/avatar';
export const dynamic='force-dynamic';
export const PATCH=(request:Request)=>avatarHandler(request);
export const OPTIONS=PATCH;
