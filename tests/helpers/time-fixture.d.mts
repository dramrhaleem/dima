export function ageSyntheticTimeSession(userId: string, sessionId: string, seconds: number): Promise<{ intervalId: string; startAt: string; boundaryAt: string }>;
export function expireSyntheticTimeJobLease(userId: string, jobId: string, attempts?: number): Promise<void>;
