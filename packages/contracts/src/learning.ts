import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v));
const text = z.string().trim().min(1).max(240);
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const url = z.string().max(2000).refine(v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
export const learningTaskSchema = z.object({ id, title:text, position:z.number().int().min(0), kind:z.string().min(1).max(40), minutes:z.number().int().min(1).max(10000).nullable(), estimateSource:z.enum(['source','user','provisional','missing']), requirement:z.enum(['required','optional','supporting','alternative']), sourceUrl:url, prerequisiteIds:z.array(id).max(100) }).strict();
export const learningModuleSchema = z.object({ id,title:text,position:z.number().int().min(0),tasks:z.array(learningTaskSchema).max(300) }).strict();
export const learningCourseSchema = z.object({ id,title:text,position:z.number().int().min(0),modules:z.array(learningModuleSchema).max(100) }).strict();
export const offeringSchema = z.object({ id,version:z.string().max(80),title:text,provider:z.string().max(120),kind:z.enum(['program','course']),sourceUrl:url,summary:z.string().max(2000),language:z.string().max(60),scopeLabel:z.string().max(1000),orderPolicy:z.string().max(2000),courses:z.array(learningCourseSchema).min(1).max(20) }).strict();
export type LearningTask = z.infer<typeof learningTaskSchema>;
export type Offering = z.infer<typeof offeringSchema>;
export type Draft = { id:string; title:string; sourceUrl:string; courses:Offering['courses']; updatedAt:string };
export type Completion = { taskId:string; kind:'prior'|'new'; completed:boolean; firstCompletedAt:string|null; completedAt:string|null; localDay:string|null; timezone:string|null; effortMinutes:number|null; claimId:string; workEventId?:string|null; remainingBefore?:number|null; moduleBatchId?:string|null };
export type Enrollment = { id:string; offeringId:string; snapshot:Offering; taskIds:string[]; priorTaskIds:string[]; targetDate:string; joinedAt:string; estimates:Record<string,number>; completions:Completion[]; remaining?:Record<string,number|null>; upgradeHistory?:Array<{upgradedAt:string; snapshot:Offering; taskIds:string[]; priorTaskIds:string[]; completions:Completion[]; estimates:Record<string,number>; remaining:Record<string,number|null>}> };
export type Availability = { startDate:string; weekdayMinutes:number[]; reservePercent:15 };
export type WorkEvent = { id:string; enrollmentId:string; taskId:string; source:'worked'|'completion'; createdAt:string; localDay:string; timezone:string; effortMinutes:number|null; originalEffortMinutes:number|null; remainingAfter:number|null; completionClaimId:string|null; pinId:string|null; invalidatedAt:string|null; correctedAt:string|null; legacy?:boolean; pinCoverage?:Record<string,number> };
export type PlanPin = { id:string; enrollmentId:string; taskId:string; day:string; minutes:number };
export type PlanPause = { id:string; enrollmentId:string|null; startDate:string; resumeDate:string|null };
export type RecoveryControls = { useBuffer:boolean; exceptions:Record<string,number>; priorities:Record<string,number>; pins:PlanPin[]; pauses:PlanPause[] };
export type PlanSettings = { availability:Availability; targets:Record<string,string>; controls:RecoveryControls };
export type RecoverySummary = { missedDays:string[]; taskIds:Array<{enrollmentId:string;taskId:string}>; kind:'none'|'one-day'|'two-days'|'repeated'|'long-break'; needsReview:boolean; timezoneChanged:boolean; recentMissedStudyDays?:number; suggestLighterWorkload?:boolean;inputsChanged?:boolean };
export type PlanBlock = { enrollmentId:string; taskId:string; day:string; minutes:number; part:number; ready:boolean; pinId?:string };
export type PlanResult = { blocks:PlanBlock[]; unscheduled:Array<{enrollmentId:string;taskId:string;minutes:number|null;reason:string}>; outcomes:Array<{enrollmentId:string;targetDate:string;forecastDate:string|null;status:'fits'|'late'|'provisional'|'unscheduled'|'conflict'|'paused'|'complete';unmetByTargetMinutes?:number;unknownEffort?:boolean}>; days:Array<{day:string;ceiling:number;reserve:number;used:number;accepted:number|null;pinned?:number;bufferUsed?:number;paused?:boolean}>; status:'fits'|'late'|'provisional'|'unscheduled'|'conflict'|'paused'|'complete'; provisionalTasks:number; missingTasks:number; plannerVersion:string; conflicts?:Array<{code:string;message:string;pinId?:string;day?:string}>; excluded?:Array<{enrollmentId:string;taskId:string;minutes:number|null;reason:string}> };
export type PlanAdvice = { status:'on-track'|'adjustable'|'needs-input'|'no-study-days'|'unavailable'; currentWeeklyMinutes:number; suggestedWeekdayMinutes?:number[]; suggestedWeeklyMinutes?:number; reason?:string };
export type PlanPreview = { advice?:PlanAdvice; id:string; baseRevision:number; profileRevision:number; timezone:string; localDay:string; createdAt:string; expiresAt:string; availability:Availability; targets:Record<string,string>; result:PlanResult; controls?:RecoveryControls; mode?:'initial'|'recovery'|'undo'; comparison?:{before:PlanResult|null;moved:Array<{enrollmentId:string;taskId:string;fromDays:string[];toDays:string[]}>;reasons:string[];previousTimezone:string|null;preservedCompletions:number} };
export type AppliedPlan = PlanPreview & { appliedAt:string; previousSettings?:PlanSettings|null };
export type CurriculumUpgradePreview = { id:string; enrollmentId:string; baseRevision:number; profileRevision:number; sourceVersion:string; createdAt:string; expiresAt:string; target:Offering; includeNewRequired:boolean; taskIds:string[]; mapped:string[]; added:string[]; removed:string[]; unresolved:string[]; requiredWeightBefore:number|null; requiredWeightAfter:number|null; completedWeightBefore:number; completedWeightAfter:number; removedCompleted:number; affectedPins:number };
export type ModuleCompletionBatch = { id:string; enrollmentId:string; moduleId:string; snapshotVersion:string; kind:'prior'|'new'; taskIds:string[]; priorAddedTaskIds:string[]; createdAt:string; undoneAt:string|null };
export type LearningState = { moduleCompletionBatches?:ModuleCompletionBatch[]; revision:number; upgradePreviews?:CurriculumUpgradePreview[]; drafts:Draft[]; enrollments:Enrollment[]; availability:Availability|null; plan:AppliedPlan|null; previews:PlanPreview[]; dataVersion?:3; planningRevision?:number; workEvents?:WorkEvent[]; todayOrder?:{day:string;taskKeys:string[]}; missedStudyDays?:Array<{day:string;timezone:string;recordedAt:string}> };
export type LearningData = { accountId:string; state:LearningState; localDay:string; timezone:string };
const base = { expectedRevision:z.number().int().min(0).max(2147483646), operationId:z.uuid() };
const availabilitySchema = z.object({ startDate:daySchema, weekdayMinutes:z.array(z.number().int().min(0).max(720)).length(7), reservePercent:z.literal(15) }).strict();
const effort = z.number().int().min(0).max(10000).nullable();
export const recoveryControlsSchema = z.object({
 useBuffer:z.boolean(), exceptions:z.record(daySchema,z.number().int().min(0).max(720)), priorities:z.record(z.uuid(),z.number().int().min(1).max(5)),
 pins:z.array(z.object({id:z.uuid(),enrollmentId:z.uuid(),taskId:id,day:daySchema,minutes:z.number().int().min(1).max(720)}).strict()).max(300),
 pauses:z.array(z.object({id:z.uuid(),enrollmentId:z.uuid().nullable(),startDate:daySchema,resumeDate:daySchema.nullable()}).strict()).max(100),
}).strict();
export const learningCommandSchema = z.discriminatedUnion('type', [
 z.object({...base,type:z.literal('saveDraft'),draft:z.object({id,title:text,sourceUrl:url,courses:z.array(learningCourseSchema).min(1).max(20)}).strict()}).strict(),
 z.object({...base,type:z.literal('enroll'),offeringId:id,taskIds:z.array(id).min(1).max(1500),priorTaskIds:z.array(id).max(1500),targetDate:daySchema,estimates:z.record(id,z.number().int().min(1).max(10000)).default({})}).strict(),
 z.object({...base,type:z.literal('previewUpgrade'),enrollmentId:z.uuid(),includeNewRequired:z.boolean()}).strict(),
 z.object({...base,type:z.literal('applyUpgrade'),previewId:z.uuid(),acknowledgeChanges:z.literal(true)}).strict(),
 z.object({...base,type:z.literal('setEstimates'),enrollmentId:z.uuid(),estimates:z.record(id,z.number().int().min(1).max(10000))}).strict(),
 z.object({...base,type:z.literal('preview'),availability:availabilitySchema,targets:z.record(id,daySchema),controls:recoveryControlsSchema.optional(),mode:z.enum(['initial','recovery']).optional()}).strict(),
 z.object({...base,type:z.literal('apply'),previewId:z.uuid(),acknowledgeUnscheduled:z.boolean()}).strict(),
 z.object({...base,type:z.literal('complete'),enrollmentId:z.uuid(),taskId:id,effortMinutes:z.number().int().min(0).max(10000).nullable()}).strict(),
 z.object({...base,type:z.literal('undo'),enrollmentId:z.uuid(),taskId:id}).strict(),
 z.object({...base,type:z.literal('completeModule'),enrollmentId:z.uuid(),moduleId:id,kind:z.enum(['new','prior'])}).strict(),
 z.object({...base,type:z.literal('undoModule'),enrollmentId:z.uuid(),batchId:z.uuid()}).strict(),
 z.object({...base,type:z.literal('worked'),enrollmentId:z.uuid(),taskId:id,effortMinutes:effort,remainingMinutes:effort,pinId:z.uuid().optional()}).strict(),
 z.object({...base,type:z.literal('setRemaining'),enrollmentId:z.uuid(),taskId:id,remainingMinutes:effort}).strict(),
 z.object({...base,type:z.literal('resolveWorkEffort'),eventId:z.string().min(1).max(180),effortMinutes:z.number().int().min(0).max(10000)}).strict(),
 z.object({...base,type:z.literal('reopen'),enrollmentId:z.uuid(),taskId:id,remainingMinutes:effort}).strict(),
 z.object({...base,type:z.literal('voidWork'),eventId:z.string().min(1).max(180)}).strict(),
 z.object({...base,type:z.literal('laterToday'),enrollmentId:z.uuid(),taskId:id}).strict(),
 z.object({...base,type:z.literal('undoRecovery'),planId:z.uuid()}).strict(),
]);
export type LearningCommand = z.infer<typeof learningCommandSchema>;
