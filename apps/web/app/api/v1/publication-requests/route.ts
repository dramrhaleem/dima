import { publicationHandler } from '../../../../src/server/publication';
export const GET=(request:Request)=>publicationHandler(request,'owner');
export const POST=GET;
export const OPTIONS=GET;
