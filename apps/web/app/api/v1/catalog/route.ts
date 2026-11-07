import { catalogHandler } from '../../../../src/server/catalog';
export const GET=(request:Request)=>catalogHandler(request);
export const OPTIONS=GET;
