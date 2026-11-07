import { authMutationHandler } from '../../../../../src/server/auth';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return authMutationHandler(request, 'google'); }
