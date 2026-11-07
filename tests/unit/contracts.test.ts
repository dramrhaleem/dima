import { describe, it, expect } from 'vitest';
import { createCheckSchema } from '../../packages/contracts/src/index';

describe('untrusted foundation input', () => {
  it('rejects client ownership fields and empty or oversized labels', () => {
    for (const value of [{ label: 'check', owner_id: 'someone-else' }, { label: ' ' }, { label: 'x'.repeat(121) }]) {
      expect(createCheckSchema.safeParse(value).success).toBe(false);
    }
  });
  it('normalizes a bounded label', () => { expect(createCheckSchema.parse({ label: ' check ' })).toEqual({ label: 'check' }); });
});
