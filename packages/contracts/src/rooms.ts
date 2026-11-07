import { z } from 'zod';
import { pomodoroSettingsSchema, type TimeData } from './time';
import { ROOM_INTENTS, ROOM_LANGUAGES, ROOM_REMOVAL_REASONS, ROOM_REPORT_REASONS } from './room-policy';

export type RoomPresetId = 'classic' | 'deep';
export type RoomStatus = 'open' | 'closed' | 'suspended' | 'archived';
export type RoomMemberStatus = 'active' | 'expired' | 'left' | 'removed';
export type RoomIntent = typeof ROOM_INTENTS[number];
export type RoomRun = {
  id: string; status: 'active' | 'completed' | 'cancelled'; presetId: RoomPresetId;
  startedAt: string; plannedEndAt: string; completedAt: string | null; cancelledAt: string | null;
};
export type RoomPhase = {
  kind: 'lobby' | 'focus' | 'shortBreak' | 'longBreak' | 'completed' | 'cancelled';
  roundIndex: number | null; startsAt: string | null; endsAt: string | null; secondsRemaining: number;
};
/** Public projection deliberately contains no owner/member identity or private task linkage. */
export type PublicRoom = {
  id: string; title: string; description: string; language: string;
  topic: string | null; offering: { id: string; title: string; provider: string } | null;
  status: RoomStatus; configuredPreset: RoomPresetId; version: number; hintVersion: number;
  capacity: 20; reservedCount: number; connectedCount: number;
  run: RoomRun | null; phase: RoomPhase; createdAt: string;
};
export type RoomAccess = {
  roomId: string; state: 'none' | RoomMemberStatus | 'banned' | 'closed' | 'suspended' | 'archived';
  canRejoin: boolean; reason: string | null; isOwner: boolean; canEdit: boolean; canClose: boolean;
};
export type OwnRoomMembership = {
  id: string; roomId: string; status: RoomMemberStatus; version: number;
  deviceId: string; controlVersion: number; lastSeenAt: string; seatExpiresAt: string;
  joinedAt: string; visibilityVersion: number; intent: RoomIntent | null;
  isOwner: boolean; isHost: boolean;
};
export type RoomMe = {
  accountId: string; revision: number; serverTime: string;
  membership: OwnRoomMembership | null; room: PublicRoom | null;
  requestedAccess: RoomAccess | null; timeRevision: number; activeTimeSessionId: string | null;
  canModerate: boolean;
};
export type RoomParticipant = {
  membershipId: string; displayName: string; isOwner: boolean; isHost: boolean;
  presence: 'connected' | 'reconnecting'; focus: 'watching' | 'focusing' | 'paused';
  intent: RoomIntent | null;
};
export type RoomCapabilities = {
  canStartRun: boolean; canJoinRound: boolean; joinRoundReason: string | null;
  canClaimHost: boolean; claimHostAt: string | null;
  canEdit: boolean; canClose: boolean; canTransferHost: boolean;
  canRemove: boolean; canBan: boolean; canModerate: boolean;
};
export type HostTransferOffer = { id: string; fromMembershipId: string; targetMembershipId: string; expiresAt: string };
export type RoomSnapshot = {
  accountId: string; serverTime: string; room: PublicRoom; me: RoomMe;
  access: { membershipId: string; generation: number; seatExpiresAt: string; checkedAt: string };
  participants: RoomParticipant[]; capabilities: RoomCapabilities;
  transferOffer: HostTransferOffer | null;
  reactions: { id: string; membershipId: string; kind: 'wave' | 'wellDone'; createdAt: string }[];
  ownBlocks: { id: string; targetMembershipId: string }[];
  bans: { id: string; membershipId: string; reason: string; createdAt: string }[];
};
export type RoomReceipt = {
  operationId: string; type: string; roomId: string | null; membershipId: string | null;
  runId: string | null; sessionId: string | null; revision: number; acceptedAt: string;
};
export type RoomCommandResponse = { data: RoomMe; receipt: RoomReceipt; time?: TimeData; replayed?: boolean };
export type RoomDirectory = { rooms: PublicRoom[]; nextCursor: string | null; serverTime: string };
export type RoomOptions = {
  offerings: { id: string; title: string; provider: string }[];
  visibilityVersion: 1; capacity: 20; maxOpenOwned: 3; maxCreatedPerUtcDay: 1;
};
export type RoomRealtimeGrant = { membershipId: string; roomId: string; generation: number; seatExpiresAt: string; topic: string };
export type RoomRealtimeCredentials = { token: string; expiresAt: string; topic: string; url: string; anonKey: string };
export type RoomHint = { version: number; phase: RoomPhase['kind']; count: { reserved: number; connected: number } };
export type RoomReport = {
  id: string; roomId: string; targetMembershipId: string | null;
  reason: typeof ROOM_REPORT_REASONS[number]; details: string;
  status: 'open' | 'reviewed'; createdAt: string;
};

const uuid = z.uuid();
const plainText = (min: number, max: number) => z.string().trim()
  .refine(value => [...value].length >= min && [...value].length <= max, `Use ${min}–${max} characters.`)
  .refine(value => [...value].every(character => {
    const code = character.charCodeAt(0);
    return code !== 127 && (code > 31 || [9, 10, 13].includes(code));
  }) && !/[<>\u202a-\u202e\u2066-\u2069]/u.test(value) && !/(?:https?:\/\/|www\.|mailto:)/i.test(value), 'Use plain text without links.');
const base = { operationId: uuid, expectedRevision: z.number().int().min(0) };
const room = { ...base, roomId: uuid };
const presence = { ...room, deviceId: uuid, controlVersion: z.number().int().min(1) };
const consent = { acknowledgeVisibility: z.literal(true), visibilityVersion: z.literal(1) };
const metadata = {
  title: plainText(3, 60), description: plainText(0, 240), language: z.enum(ROOM_LANGUAGES.map(language => language.id)),
  topic: plainText(2, 80).nullable(), offeringId: z.string().min(1).max(120).nullable(),
  presetId: z.enum(['classic', 'deep']),
};
const timeIntent = {
  expectedTimeRevision: z.number().int().min(0), fromSessionId: uuid.nullable(),
  timeControlVersion: z.number().int().min(1).nullable(),
};
const startSolo = z.object({
  mode: z.enum(['open', 'solo']), category: z.enum(['learning', 'work']), title: z.string().trim().max(160),
  enrollmentId: uuid.nullable(), taskId: z.string().max(120).nullable(), settings: pomodoroSettingsSchema.nullable(),
}).strict();
export const roomCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('create'), deviceId: uuid, ...metadata, ...consent }).strict(),
  z.object({ ...room, type: z.literal('join'), deviceId: uuid, ...consent }).strict(),
  z.object({ ...presence, type: z.literal('renewPresence') }).strict(),
  z.object({ ...presence, type: z.literal('takeControl') }).strict(),
  z.object({ ...presence, ...timeIntent, type: z.literal('leave') }).strict(),
  z.object({ ...base, ...timeIntent, type: z.literal('switchToRoom'), roomId: uuid, fromRoomId: uuid.nullable(), deviceId: uuid, presenceControlVersion: z.number().int().min(1).nullable(), ...consent }).strict(),
  z.object({ ...presence, ...timeIntent, type: z.literal('switchToSolo'), solo: startSolo }).strict(),
  z.object({ ...presence, type: z.literal('setIntent'), intent: z.enum(ROOM_INTENTS).nullable() }).strict(),
  z.object({ ...presence, type: z.literal('startRun'), roomVersion: z.number().int().min(1) }).strict(),
  z.object({ ...presence, type: z.literal('joinRound'), runId: uuid, roundIndex: z.number().int().min(1).max(4), expectedTimeRevision: z.number().int().min(0), category: z.enum(['learning', 'work']), enrollmentId: uuid.nullable(), taskId: z.string().max(120).nullable() }).strict(),
  z.object({ ...room, type: z.literal('edit'), roomVersion: z.number().int().min(1), ...metadata }).strict(),
  z.object({ ...room, type: z.literal('close'), roomVersion: z.number().int().min(1) }).strict(),
  z.object({ ...presence, type: z.literal('offerHost'), targetMembershipId: uuid, roomVersion: z.number().int().min(1) }).strict(),
  z.object({ ...presence, type: z.literal('acceptHost'), offerId: uuid }).strict(),
  z.object({ ...presence, type: z.literal('claimHost') }).strict(),
  z.object({ ...presence, type: z.literal('remove'), targetMembershipId: uuid, reason: z.enum(ROOM_REMOVAL_REASONS) }).strict(),
  z.object({ ...room, type: z.literal('ban'), targetMembershipId: uuid, reason: z.enum(ROOM_REMOVAL_REASONS) }).strict(),
  z.object({ ...room, type: z.literal('unban'), banId: uuid }).strict(),
  z.object({ ...room, type: z.literal('report'), targetMembershipId: uuid.nullable(), reason: z.enum(ROOM_REPORT_REASONS), details: z.string().trim().max(500) }).strict(),
  z.object({ ...room, type: z.literal('block'), targetMembershipId: uuid }).strict(),
  z.object({ ...room, type: z.literal('unblock'), blockId: uuid }).strict(),
  z.object({ ...presence, type: z.literal('react'), reaction: z.enum(['wave', 'wellDone']) }).strict(),
  z.object({ ...room, type: z.literal('suspendRoom'), reason: z.enum(ROOM_REPORT_REASONS) }).strict(),
  z.object({ ...room, type: z.literal('suspendAccount'), targetMembershipId: uuid, reason: z.enum(ROOM_REPORT_REASONS) }).strict(),
  z.object({ ...base, type: z.literal('reviewReport'), reportId: uuid }).strict(),
]);
export type RoomCommand = z.infer<typeof roomCommandSchema>;
