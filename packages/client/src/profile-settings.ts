import { ApiError } from '@dima/contracts';
export type RhythmGoal = { days: number | null; effectiveWeek: string };
export type ProfileSettings = { accountId: string; revision: number; handle: string | null; publicLink: boolean; bio: string; currentGoal: RhythmGoal | null; nextGoal: RhythmGoal | null; nextEffectiveWeek: string };
export type ProfileSettingsAction = { type: 'setPublicLink'; handle: string; publicLink: boolean; bio: string; consentVersion: 1 } | { type: 'setRhythmGoal'; days: number | null };
export type PublicProfile = { handle: string; displayName: string; bio: string };
export function createProfileSettingsClient(owner: string) {
 async function request(command?: ProfileSettingsAction & { operationId: string; expectedRevision: number }, signal?: AbortSignal): Promise<ProfileSettings> {
  const response = await fetch('/api/v1/profile-settings', { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'X-Dima-Account-Id': owner, ...(command ? { 'Content-Type': 'application/json' } : {}) }, ...(command ? { body: JSON.stringify(command) } : {}) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error?.code ?? 'REQUEST_FAILED', response.status);
  if (body?.data?.accountId !== owner) throw new ApiError('ACCOUNT_CHANGED', 409);
  return body.data;
 }
 return { read: (signal?: AbortSignal) => request(undefined,signal), save: (command: ProfileSettingsAction & { operationId: string; expectedRevision: number }, signal?: AbortSignal) => request(command,signal) };
}
