import { ApiError } from '@dima/contracts';
export type MilestonePreview = { scopeId: string; title: string; displayName: string; audience: 'accepted-followers'; revision: number; workspaceRevision: number; previewToken: string; followerCount: number };
export type MilestoneData = {
  candidates: Array<{ scopeId: string; title: string; revision: number; milestoneId: string | null; published: boolean }>;
  mine: Array<{ id: string; scopeId: string; title: string; revision: number; publishedAt: string; revokedAt: string | null; eligible: boolean }>;
  feed: Array<{ id: string; profileId: string; displayName: string; title: string; publishedAt: string; encouragements: number; encouraged: boolean }>;
  verifiedAt: string;
};
export type MilestoneCommand =
  | { type: 'publish'; operationId: string; scopeId: string; previewToken: string; audience: 'accepted-followers'; acknowledgeSharing: true }
  | { type: 'revoke'; operationId: string; milestoneId: string; expectedRevision: number }
  | { type: 'encourage'; operationId: string; milestoneId: string };
export function createMilestoneClient(owner: string) {
  async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
    const response = await fetch(`/api/v1/shared-milestones${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'X-Dima-Account-Id': owner, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(payload?.error?.code ?? 'REQUEST_FAILED', response.status);
    return payload.data as T;
  }
  return {
    read: (signal: AbortSignal) => request<MilestoneData>('', signal),
    preview: (scopeId: string, signal: AbortSignal) => request<MilestonePreview>('/preview', signal, { scopeId }),
    command: (command: MilestoneCommand, signal: AbortSignal) => request<MilestoneData>(command.type === 'publish' ? '' : `/${command.milestoneId}/${command.type}`, signal, command),
  };
}
