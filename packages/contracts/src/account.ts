import { z } from 'zod';

export const timezoneSchema = z.string().max(100).refine(value => {
  if (value !== 'UTC' && !value.includes('/')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}, 'Choose a valid IANA timezone');

const fields = {
  displayName: z.string().trim().max(80).refine(value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127), 'Control characters are not allowed'),
  timezone: timezoneSchema,
  intent: z.enum(['learning', 'work']),
  appearance: z.enum(['system', 'light', 'dark']),
  reducedMotion: z.boolean(),
  onboarded: z.boolean(),
};
export const accountProfileSchema = z.object({ ...fields, avatarUrl: z.string().nullable().optional(), avatarMode: z.enum(['google','custom','none']).optional(), avatarRevision: z.number().int().min(0).optional(), googleAvatarUrl: z.string().nullable().optional(), revision: z.number().int().min(1).max(2147483647) }).strict();
export const saveAccountSchema = z.object({
  ...fields,
  expectedRevision: z.number().int().min(0).max(2147483646),
  operationId: z.uuid(),
}).strict().refine(value => !value.onboarded || value.displayName.length > 0, { path: ['displayName'], message: 'Enter your display name to continue' });
export const accountResponseSchema = z.object({ data: z.object({
  accountId: z.uuid(),
  profile: accountProfileSchema.nullable(),
  role: z.enum(['member', 'moderator', 'admin']),
}).strict() });
export type AccountProfile = z.infer<typeof accountProfileSchema>;
export type SaveAccount = z.infer<typeof saveAccountSchema>;
export type AccountData = z.infer<typeof accountResponseSchema>['data'];

export const saveAvatarSchema = z.object({mode:z.enum(['google','custom','none']),data:z.string().max(45000).nullable(),expectedRevision:z.number().int().min(0).max(2147483646),operationId:z.uuid()}).strict();
