import { z } from 'zod';
export const accountOperationIdSchema=z.uuid();
export const accountDeletionCommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('start'),operationId:z.uuid()}).strict(),
 z.object({type:z.literal('confirm'),requestId:z.uuid(),code:z.string().regex(/^\d{6,10}$/),confirmation:z.literal('DELETE')}).strict(),
 z.object({type:z.literal('retry'),requestId:z.uuid(),confirmation:z.literal('DELETE')}).strict(),
]);
