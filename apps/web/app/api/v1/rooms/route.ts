import { roomsHandler } from '../../../../src/server/rooms';
export const dynamic = 'force-dynamic';
const handler = (request: Request) => roomsHandler(request, 'directory');
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
