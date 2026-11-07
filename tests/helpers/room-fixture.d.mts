export function ageSyntheticRoomRun(ownerId: string, roomId: string, seconds: number): Promise<void>;
export function ageSyntheticRoomLease(ownerId: string, roomId: string, userId: string, seconds?: number): Promise<void>;
export function grantSyntheticRoomModerator(userId: string): Promise<void>;
export function ageSyntheticOpenSession(userId: string, sessionId: string, seconds: number): Promise<void>;
export function setSyntheticRoomArchiveAge(ownerId: string, roomId: string, secondsSinceRunStart: number): Promise<void>;
export function ageSyntheticRoomActivity(ownerId: string, roomId: string, seconds?: number): Promise<void>;
export function duringSyntheticProfileSave<T>(userId: string, callback: () => Promise<T>): Promise<T>;
export function republishSyntheticRoomHint(ownerId: string, roomId: string, version?: number): Promise<{ version: number; phase: string; count: { reserved: number; connected: number } }>;
