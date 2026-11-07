import { describe, expect, it } from 'vitest';
import { saveAccountSchema, timezoneSchema } from '../../packages/contracts/src/account';

const valid = { displayName: 'Dima member', timezone: 'Africa/Cairo', intent: 'work', appearance: 'system',
  reducedMotion: false, onboarded: true, expectedRevision: 0, operationId: '6a7a4aa0-0062-4a41-9a11-70f065ef6d90' };
describe('B1 account contract', () => {
  it('allows incomplete name only for an onboarding draft and normalizes whitespace', () => {
    expect(saveAccountSchema.parse({ ...valid, displayName: '  Member  ' }).displayName).toBe('Member');
    expect(saveAccountSchema.safeParse({ ...valid, displayName: ' ', onboarded: false }).success).toBe(true);
    expect(saveAccountSchema.safeParse({ ...valid, displayName: ' ' }).success).toBe(false);
  });
  it('rejects ownership, role, unknown fields and invalid revision commands', () => {
    for (const extra of [{ role: 'admin' }, { owner_id: 'other' }, { user_id: 'other' }, { revision: 8 }, { expectedRevision: -1 }, { expectedRevision: 1.5 }]) {
      expect(saveAccountSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });
  it('accepts IANA timezone names and UTC, rejects ambiguous offsets and nonexistent names', () => {
    for (const zone of ['UTC', 'Africa/Cairo', 'America/New_York', 'Etc/GMT+2']) expect(timezoneSchema.safeParse(zone).success).toBe(true);
    for (const zone of ['UTC+2', 'EST', 'Moon/City', '', 'Invalid']) expect(timezoneSchema.safeParse(zone).success).toBe(false);
  });
  it('rejects invalid appearance, intent, control characters and oversized names', () => {
    for (const extra of [{ intent: 'admin' }, { appearance: 'neon' }, { reducedMotion: 'true' }, { displayName: 'Name\nOther' }, { displayName: 'x'.repeat(81) }]) {
      expect(saveAccountSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });
});
