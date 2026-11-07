import { z } from 'zod';

export type TimeMode = 'open' | 'solo' | 'room';
export type TimeCategory = 'learning' | 'work';
export type TimeStatus = 'running' | 'paused' | 'needsReview' | 'finalized';
export type TimeEligibility = 'eligible' | 'personal' | 'pending';
export type PomodoroSettings = { focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number; longBreakAfter: number };
export type TimeSession = {
  id: string; mode: TimeMode; category: TimeCategory; status: TimeStatus;
  title: string; enrollmentId: string | null; taskId: string | null;
  createdAt: string; finalizedAt: string | null; revision: number;
  deviceId: string; controlVersion: number; leaseUntil: string;
  remainingSeconds: number | null; settings: PomodoroSettings | null;
  roundIndex: number; previousSessionId: string | null;
  roomId: string | null; participationId: string | null;
  roomDeadlineAt?: string | null;
};
export type TimeInterval = {
  id: string; sessionId: string; startAt: string; endAt: string | null;
  boundaryAt: string; effectiveEndAt: string | null;
  source: 'server' | 'manual'; eligibility: TimeEligibility;
  deviceId: string; controlVersion: number; createdAt: string;
};
export type TimeCorrection = {
  id: string; sessionId: string; intervalId: string; previousEndAt: string;
  reportedEndAt: string; reason: 'offline-stop' | 'manual-correction';
  originalOperationId: string | null; createdAt: string;
};
export type TimeReceipt = {
  operationId: string; type: string; sessionId: string | null;
  intervalId: string | null; revision: number; acceptedAt: string;
  outcome: 'applied' | 'offline-correction' | 'replayed-original';
};
export type TimeData = {
  accountId: string; revision: number; serverTime: string;
  active: TimeSession | null; sessions: TimeSession[]; intervals: TimeInterval[];
  corrections: TimeCorrection[];
  totals: { eligibleSeconds: number; personalSeconds: number; pendingSeconds: number };
  nextCursor: string | null;
};
export type TimeResponse = { data: TimeData; receipt?: TimeReceipt; replayed?: boolean };

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const base = { operationId: uuid, expectedRevision: z.number().int().min(0) };
const session = { ...base, sessionId: uuid };
const controlled = { ...session, deviceId: uuid, controlVersion: z.number().int().min(1) };
export const pomodoroSettingsSchema = z.object({
  focusMinutes: z.number().int().min(5).max(90),
  shortBreakMinutes: z.number().int().min(1).max(30),
  longBreakMinutes: z.number().int().min(5).max(60),
  longBreakAfter: z.number().int().min(2).max(6),
}).strict();
export const finishTimeSchema = z.object({
  ...controlled, type: z.literal('finish'), intervalId: uuid.nullable(),
}).strict();
export const pauseTimeSchema = z.object({ ...controlled, type: z.literal('pause'), intervalId: uuid }).strict();
export type FinishTimeCommand = z.infer<typeof finishTimeSchema>;
export type StopIntentCommand = FinishTimeCommand | z.infer<typeof pauseTimeSchema>;
export const timeCommandSchema = z.discriminatedUnion('type', [
  z.object({
    ...base, type: z.literal('start'), deviceId: uuid,
    mode: z.enum(['open', 'solo']), category: z.enum(['learning', 'work']),
    title: z.string().trim().max(160), enrollmentId: uuid.nullable(),
    taskId: z.string().max(120).nullable(),
    settings: pomodoroSettingsSchema.nullable(), previousSessionId: uuid.nullable(),
  }).strict(),
  pauseTimeSchema,
  z.object({ ...controlled, type: z.literal('resume') }).strict(),
  finishTimeSchema,
  z.object({ ...controlled, type: z.literal('renew') }).strict(),
  z.object({ ...session, type: z.literal('claimControl'), deviceId: uuid, controlVersion: z.number().int().min(1) }).strict(),
  z.object({ ...controlled, type: z.literal('review'), acceptCap: z.literal(true) }).strict(),
  z.object({
    ...base, type: z.literal('manual'), category: z.enum(['learning', 'work']),
    title: z.string().trim().max(160), startAt: timestamp, endAt: timestamp,
  }).strict(),
  z.object({ ...session, type: z.literal('correctInterval'), intervalId: uuid, reportedEndAt: timestamp, confirmPersonal: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('offlineStop'), originalCommand: z.union([finishTimeSchema, pauseTimeSchema]), reportedEndAt: timestamp, confirmPersonal: z.literal(true) }).strict(),
]);
export type TimeCommand = z.infer<typeof timeCommandSchema>;
export const timeReceiptQuerySchema = z.object({ command: timeCommandSchema }).strict();
