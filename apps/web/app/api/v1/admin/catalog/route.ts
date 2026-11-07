import { publicationHandler } from '../../../../../src/server/publication';
export const GET=(request:Request)=>publicationHandler(request,'catalog');
export const POST=GET;
export const OPTIONS=GET;
