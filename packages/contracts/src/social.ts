import { z } from 'zod';
const scope = z.string().min(1).max(240);
const base = { operationId:z.uuid(), expectedRevision:z.number().int().min(0).max(2147483646) };
export type SocialSettings = { revision:number; publicProfile:boolean; bio:string; allowFollow:boolean; weeklyTime:boolean; courseProgress:boolean };
export type SocialPerson = { profileId:string; displayName:string };
export type FollowRelationship = SocialPerson & { id:string; status:'pending'|'accepted'|'declined'|'cancelled'|'revoked'; revision:number; canRequestFollow?:boolean };
export type CircleData = { incoming:FollowRelationship[]; outgoing:FollowRelationship[]; following:FollowRelationship[]; followers:FollowRelationship[] };
export type RankingSnapshot = { scope:string; scoringVersion:string; window:{start:string;end:string}|null; calculatedAt:string; generation:string; correctedAt:string|null; unit:'seconds'|'weight'; requiredWeight:number|null; rows:Array<SocialPerson & {rank:number;score:number;profileVisible?:boolean}>; participation:{enabled:boolean;revision:number;canParticipate?:boolean}; scopes?:Array<{id:string;offeringId:string;title:string}> };
export type SocialNotification = { id:string; type:'follow-request'|'follow-accepted'; targetId:string|null; available:boolean; createdAt:string; readAt:string|null };
export const socialCommandSchema = z.discriminatedUnion('type', [
 z.object({...base,type:z.literal('setSharing'),publicProfile:z.boolean(),bio:z.string().trim().max(280),allowFollow:z.boolean(),weeklyTime:z.boolean(),courseProgress:z.boolean()}).strict(),
 z.object({...base,type:z.literal('follow'),targetId:z.uuid()}).strict(),
 z.object({...base,type:z.enum(['accept','decline','cancel','revoke']),relationshipId:z.uuid()}).strict(),
 z.object({...base,type:z.literal('setPeople'),offeringId:scope,visible:z.boolean()}).strict(),
 z.object({...base,type:z.literal('setParticipation'),board:z.enum(['time','course']),scopeId:scope.nullable(),enabled:z.boolean()}).strict(),
 z.object({...base,type:z.literal('block'),targetId:z.uuid()}).strict(),
 z.object({...base,type:z.literal('unblock'),blockId:z.uuid()}).strict(),
 z.object({...base,type:z.literal('readNotifications'),ids:z.array(z.uuid()).min(1).max(50)}).strict(),
]);
export type SocialCommand = z.infer<typeof socialCommandSchema>;
