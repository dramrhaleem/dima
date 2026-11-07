export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', stage: 'B0', serverTime: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
