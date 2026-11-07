import { z } from 'zod';
export * from './account';

export const healthSchema = z.object({ status: z.literal('ok'), stage: z.literal('B0'), serverTime: z.iso.datetime() });
export const createCheckSchema = z.object({ label: z.string().trim().min(1).max(120) }).strict();
export const checkSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), label: z.string().min(1).max(120), created_at: z.iso.datetime({ offset: true }) });
export const checksResponseSchema = z.object({ data: z.array(checkSchema).max(20) });
export const createCheckResponseSchema = z.object({ data: checkSchema });
export type FoundationCheck = z.infer<typeof checkSchema>;
export type CreateCheck = z.infer<typeof createCheckSchema>;
export type FoundationConfig = { apiBaseUrl: string; supabaseUrl: string; anonKey: string };

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = 'ApiError';
  }
}

export * from "./learning";

export * from './policy';

export * from "./time";

export * from './rooms';

export * from './social';

export * from './progress';

export * from './publication';
