import { roomsHandler } from '../../../../../../src/server/rooms';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const handler = async (request: Request, context: Context) => roomsHandler(request, 'realtime', (await context.params).id);
export const POST = handler;
export const OPTIONS = handler;
