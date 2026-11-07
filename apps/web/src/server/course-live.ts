import { courseLiveCommandSchema } from '../../../../packages/contracts/src/course-live';
import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { dbError } from './social';

export async function courseLiveHandler(request: Request, offeringId: string): Promise<Response> {
  if (request.method === 'OPTIONS') return apiPreflight(request, 'GET, POST, OPTIONS');
  let apply = (response: Response) => response;
  try {
    if (!['GET', 'POST'].includes(request.method)) throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    if (request.method === 'POST' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const params = new URL(request.url).searchParams, version = params.get('version');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(offeringId) || !version || version.length > 80 || [...version].some(c => c.charCodeAt(0) < 32) || [...params.keys()].some(k => k !== 'version')) throw new AuthHttpError('INVALID_INPUT', 422);
    const auth = await requestAuth(request); apply = auth.apply;
    if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED', 401);
    const expected = request.headers.get('X-Dima-Account-Id');
    if (expected !== null && expected !== auth.user.id || request.method === 'POST' && !request.headers.get('authorization') && expected === null) throw new AuthHttpError('ACCOUNT_CHANGED', 409);
    if (request.method === 'GET') {
      const { data, error } = await auth.db.rpc('read_course_live', { p_offering: offeringId, p_version: version });
      if (error) throw dbError(error);
      return apply(authJson({ data }));
    }
    const command = courseLiveCommandSchema.safeParse(await readJson(request, 4000));
    if (!command.success) throw new AuthHttpError('INVALID_INPUT', 422);
    const { data, error } = await auth.db.rpc('execute_course_live', { p_offering: offeringId, p_version: version, p_command: command.data });
    if (error) throw dbError(error);
    return apply(authJson(data));
  } catch (error) { return apply(authFailure(error)); }
}
