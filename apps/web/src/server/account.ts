import { accountProfileSchema, accountResponseSchema, saveAccountSchema, type AccountProfile } from '@dima/contracts';
import { googleAvatar } from './avatar-validation';
import { AuthHttpError, apiPreflight, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';

const columns = 'display_name,timezone,intent,appearance,reduced_motion,onboarded,revision,avatar_mode,avatar_revision';
type ProfileRow = { display_name: string; timezone: string; intent: string; appearance: string; reduced_motion: boolean; onboarded: boolean; revision: number; avatar_mode: 'google'|'custom'|'none'; avatar_revision: number };
function profileDto(row: ProfileRow | null, actor: string, metadata: Record<string,unknown>): AccountProfile | null {
  if (!row) return null;
  return accountProfileSchema.parse({ displayName: row.display_name, timezone: row.timezone, intent: row.intent,
    avatarUrl: row.avatar_mode === 'none' || row.avatar_mode === 'google' && !googleAvatar(metadata) ? null : `/api/v1/profiles/${actor}/avatar?v=${row.avatar_revision}`, avatarMode:row.avatar_mode, avatarRevision:row.avatar_revision, googleAvatarUrl:googleAvatar(metadata), appearance: row.appearance, reducedMotion: row.reduced_motion, onboarded: row.onboarded, revision: row.revision });
}

export async function accountHandler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return apiPreflight(request, 'GET, PATCH, OPTIONS');
  let apply = (response: Response) => response;
  try {
    if (!['GET', 'PATCH'].includes(request.method)) throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    if (request.method === 'PATCH' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const auth = await requestAuth(request);
    apply = auth.apply;
    if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED', 401);
    const actor = auth.user.id;
    const expectedActor = request.headers.get('X-Dima-Account-Id');
    if (request.method === 'PATCH' && (
      (expectedActor !== null && expectedActor !== actor) ||
      (!request.headers.get('authorization') && expectedActor === null)
    )) throw new AuthHttpError('ACCOUNT_CHANGED', 409);

    const { data: roleRow, error: roleError } = await auth.db.from('account_roles').select('role').eq('user_id', actor).maybeSingle();
    if (roleError) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    const role = roleRow?.role ?? 'member';
    if (request.method === 'GET') {
      const { data: row, error } = await auth.db.from('account_profiles').select(columns).eq('user_id', actor).maybeSingle();
      if (error) throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
      const payload = accountResponseSchema.parse({ data: { accountId: actor, profile: profileDto(row,actor,auth.user.user_metadata), role } });
      return apply(authJson(payload));
    }

    const parsed = saveAccountSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AuthHttpError('INVALID_INPUT', 422);
    const { data: saved, error } = await auth.db.rpc('save_account_profile', { p_command: parsed.data });
    if (error) {
      const errors: Record<string, number> = { REVISION_CONFLICT: 409, IDEMPOTENCY_MISMATCH: 409, INVALID_INPUT: 422, AUTH_REQUIRED: 401 };
      const status = errors[error.message];
      if (status && error.code === `PT${status}`) throw new AuthHttpError(error.message, status);
      throw new AuthHttpError('STORAGE_UNAVAILABLE', 503);
    }
    const {data:photoRow,error:photoError}=await auth.db.from('account_profiles').select(columns).eq('user_id',actor).single();
    if(photoError)throw new AuthHttpError('STORAGE_UNAVAILABLE',503);
    const photo = profileDto(photoRow,actor,auth.user.user_metadata)!;
    const profile = {...accountProfileSchema.parse(saved),avatarUrl:photo.avatarUrl,avatarMode:photo.avatarMode,avatarRevision:photo.avatarRevision,googleAvatarUrl:photo.googleAvatarUrl};
    const payload = accountResponseSchema.parse({ data: { accountId: actor, profile, role } });
    return apply(authJson({ ...payload, revision: profile.revision, operationId: parsed.data.operationId,
      serverTime: new Date().toISOString(), requestId: crypto.randomUUID() }));
  } catch (error) {
    return apply(authFailure(error));
  }
}
