export const dynamic = 'force-dynamic';
import { courseLiveHandler } from '../../../../../../src/server/course-live';
type Context = { params: Promise<{ offeringId: string }> };
async function handler(request: Request, context: Context) {
  return courseLiveHandler(request, (await context.params).offeringId);
}
export { handler as GET, handler as POST, handler as OPTIONS };
