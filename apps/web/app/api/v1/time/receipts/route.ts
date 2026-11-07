import { timeHandler } from '../../../../../src/server/time';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => timeHandler(request, true);
export const OPTIONS = POST;
