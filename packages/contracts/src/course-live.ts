import { z } from 'zod';

export type CourseLiveMember = {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  percent: number;
  completedCount: number;
  totalCount: number;
  modules: Array<{ moduleId: string; completedCount: number; totalCount: number }>;
  latest: { taskId: string; taskTitle: string; moduleId: string; moduleTitle: string; completedAt: string; kind: 'new' | 'prior' } | null;
};
export type CourseLiveData = {
  accountId: string;
  offeringId: string;
  version: string;
  scopeId: string;
  title: string;
  calculatedAt: string;
  refreshAfterSeconds: 15;
  sharing: { enabled: boolean; revision: number; rankingEnabled: boolean };
  rows: CourseLiveMember[];
  totalParticipants: number;
  truncated: boolean;
  unavailable?: boolean;
};
export const courseLiveCommandSchema = z.object({
  type: z.literal('setCourseLiveSharing'),
  enabled: z.boolean(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  operationId: z.uuid(),
}).strict();
export type CourseLiveCommand = z.infer<typeof courseLiveCommandSchema>;
export type CourseLiveSnapshot = CourseLiveData;
export type CourseLiveParticipant = CourseLiveMember;
