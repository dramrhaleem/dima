import { apiPreflight, AuthHttpError, authFailure, authJson, mutationOriginAllowed, readJson, requestAuth } from './auth';
import { dbError } from './social';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function milestoneHandler(request: Request, action: 'list' | 'preview' | 'revoke' | 'encourage' = 'list', id?: string): Promise<Response> {
  if (request.method === 'OPTIONS') return apiPreflight(request, 'GET, POST, OPTIONS');
  let apply = (response: Response) => response;
  try {
    if (!['GET', 'POST'].includes(request.method) || (request.method === 'GET' && action !== 'list')) throw new AuthHttpError('METHOD_NOT_ALLOWED', 405);
    if (request.method === 'POST' && !mutationOriginAllowed(request)) throw new AuthHttpError('ORIGIN_NOT_ALLOWED', 403);
    const auth = await requestAuth(request); apply = auth.apply;
    if (!auth.user) throw new AuthHttpError('AUTH_REQUIRED', 401);
    const expected = request.headers.get('X-Dima-Account-Id');
    if ((expected !== null && expected !== auth.user.id) || (request.method === 'POST' && !request.headers.has('authorization') && expected === null)) throw new AuthHttpError('ACCOUNT_CHANGED', 409);
    if (new URL(request.url).search) throw new AuthHttpError('INVALID_INPUT', 422);
    if (request.method === 'GET') {
      const { data, error } = await auth.db.rpc('read_milestones');
      if (error) throw dbError(error);
      return apply(authJson({ data }));
    }
    const input = await readJson(request, 4096);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthHttpError('INVALID_INPUT', 422);
    const command = input as Record<string, unknown>;
    const scopeValid = typeof command.scopeId === 'string' && command.scopeId.length > 0 && command.scopeId.length <= 240;
    if (action === 'preview') {
      if (!scopeValid || Object.keys(command).some(key => key !== 'scopeId')) throw new AuthHttpError('INVALID_INPUT', 422);
      const { data, error } = await auth.db.rpc('preview_milestone', { p_scope: command.scopeId });
      if (error) throw dbError(error);
      return apply(authJson({ data }));
    }
    if (typeof command.operationId !== 'string' || !uuid.test(command.operationId)) throw new AuthHttpError('INVALID_INPUT', 422);
    const type = action === 'list' ? 'publish' : action;
    const allowed = type === 'publish' ? ['type', 'operationId', 'scopeId', 'previewToken', 'audience', 'acknowledgeSharing'] : ['type', 'operationId', 'milestoneId', ...(type === 'revoke' ? ['expectedRevision'] : [])];
    if (command.type !== type || Object.keys(command).some(key => !allowed.includes(key))) throw new AuthHttpError('INVALID_INPUT', 422);
    if (type === 'publish') {
      if (!scopeValid || typeof command.previewToken !== 'string' || !/^[a-f0-9]{32}$/.test(command.previewToken) || command.audience !== 'accepted-followers' || command.acknowledgeSharing !== true) throw new AuthHttpError('INVALID_INPUT', 422);
    } else if (!id || !uuid.test(id) || command.milestoneId !== id || (type === 'revoke' && (!Number.isInteger(command.expectedRevision) || Number(command.expectedRevision) < 1))) throw new AuthHttpError('INVALID_INPUT', 422);
    const { data, error } = await auth.db.rpc('execute_milestone', { p_command: command });
    if (error) throw dbError(error);
    return apply(authJson(data));
  } catch (error) { return apply(authFailure(error)); }
}
