import { describe, expect, it } from 'vitest';
import { foundationHandler } from '../../apps/web/src/server/foundation';

describe('development proof boundary', () => {
  it('is absent unless explicitly enabled, including preflight', async () => {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const response = await foundationHandler(new Request('http://localhost/api/v1/foundation/checks', { method }), {});
      expect(response.status).toBe(404);
    }
  });
  it('does not trust arbitrary browser origins or missing identity', async () => {
    const foreign = await foundationHandler(new Request('http://localhost/api/v1/foundation/checks', { headers: { Origin: 'https://evil.example' } }), { DIMA_B0_ENABLED: 'true' });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const anonymous = await foundationHandler(new Request('http://localhost/api/v1/foundation/checks'), { DIMA_B0_ENABLED: 'true' });
    expect(anonymous.status).toBe(401);
  });
});
