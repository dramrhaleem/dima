import { foundationHandler } from '../../../../../src/server/foundation';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return foundationHandler(request); }
export function POST(request: Request) { return foundationHandler(request); }
export function OPTIONS(request: Request) { return foundationHandler(request); }
