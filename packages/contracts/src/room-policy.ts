/** Browser-safe room policy; no schemas, secrets or server dependencies. */
export const ROOM_POLICY_VERSION = 'rooms-1' as const;
export const ROOM_VISIBILITY_VERSION = 1 as const;
export const ROOM_CAPACITY = 20;
export const ROOM_LEASE_SECONDS = 180;
export const ROOM_CONNECTED_SECONDS = 90;
export const ROOM_HOST_ABSENCE_SECONDS = 120;
export const ROOM_PRESETS = {
  classic: { label: '25 / 5', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakAfter: 4, rounds: 4 },
  deep: { label: '50 / 10', focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakAfter: 4, rounds: 4 },
} as const;
export const ROOM_LANGUAGES = [
  { id: 'en', label: 'English' }, { id: 'ar', label: 'Arabic' },
  { id: 'fr', label: 'French' }, { id: 'es', label: 'Spanish' },
  { id: 'de', label: 'German' }, { id: 'other', label: 'Other' },
] as const;
export const ROOM_INTENTS = ['reading', 'practice', 'project', 'work'] as const;
export const ROOM_REPORT_REASONS = ['spam', 'harassment', 'inappropriate-content', 'privacy', 'other'] as const;
export const ROOM_REMOVAL_REASONS = ['disruptive', 'spam', 'harassment', 'privacy', 'other'] as const;
