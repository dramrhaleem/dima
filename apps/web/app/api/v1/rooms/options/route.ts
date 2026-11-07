import { roomsHandler } from '../../../../../src/server/rooms';
export const dynamic = 'force-dynamic';
const handler = (request: Request) => roomsHandler(request, 'options');
export const GET = handler;
export const OPTIONS = handler;
