import { milestoneHandler } from '../../../../src/server/milestones';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => milestoneHandler(request);
export const POST = GET;
export const OPTIONS = GET;
