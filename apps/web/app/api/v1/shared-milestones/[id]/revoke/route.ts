import { milestoneHandler } from '../../../../../../src/server/milestones';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return milestoneHandler(request, 'revoke', (await context.params).id); }
export const OPTIONS = POST;
