import { landingHtml } from '../src/generated/landing';
export function GET() {
  return new Response(landingHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });
}
