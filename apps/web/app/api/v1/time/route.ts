import { timeHandler } from '../../../../src/server/time';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => timeHandler(request);
export const POST = GET;
export const OPTIONS = GET;
