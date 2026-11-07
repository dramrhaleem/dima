import { roomsHandler } from '../../../../../src/server/rooms';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const handler = async (request: Request, context: Context) => roomsHandler(request, 'detail', (await context.params).id);
export const GET = handler;
export const OPTIONS = handler;
