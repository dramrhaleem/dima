import { milestoneHandler } from '../../../../../src/server/milestones';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => milestoneHandler(request, 'preview');
export const OPTIONS = POST;
