import { z } from 'zod';
import type { Offering } from './learning';
const base = { operationId:z.uuid(), expectedRevision:z.number().int().min(0).max(2147483646) };
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/);
const reason = z.string().trim().min(5).max(2000);
export const publicationCommandSchema = z.discriminatedUnion('type', [
 z.object({...base,type:z.literal('submit'),draftId:id,provider:z.string().trim().min(1).max(120),summary:z.string().trim().min(1).max(2000),language:z.string().trim().min(1).max(60),scopeLabel:z.string().trim().min(1).max(1000),orderPolicy:z.string().trim().min(1).max(2000),sourceNotes:reason,rightsAttested:z.literal(true)}).strict(),
 z.object({...base,type:z.literal('withdraw'),requestId:z.uuid()}).strict(),
 z.object({...base,type:z.literal('review'),requestId:z.uuid(),decision:z.enum(['approve','reject']),reason}).strict(),
 z.object({...base,type:z.literal('setPublication'),offeringId:id,published:z.boolean(),reason}).strict(),
]);
export type PublicationCommand = z.infer<typeof publicationCommandSchema>;
export type PublicationRequest = {id:string;draftId:string;offeringId:string;snapshot:Offering;sourceNotes:string;rightsAttested:true;status:'pending'|'approved'|'rejected'|'withdrawn';revision:number;createdAt:string;reviewedAt:string|null;decisionReason:string|null};
export type PublicationData = {requests:PublicationRequest[];canReview:boolean;nextCursor:string|null};
export type CatalogAdministrationItem = {id:string;title:string;provider:string;version:string;status:'published'|'unpublished';revision:number};
export type PublicationReceipt = {requestId?:string;offeringId?:string;revision:number;status:string;replayed?:boolean};
