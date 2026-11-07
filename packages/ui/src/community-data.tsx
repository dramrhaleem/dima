'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createCommunityClient } from '@dima/client';
import { ApiError, type SocialCommand, type PublicationCommand } from '@dima/contracts';
import { useFocus } from './focus';

export type CommunityAction<T = SocialCommand | PublicationCommand> = T extends SocialCommand | PublicationCommand ? Omit<T, 'operationId'> : never;
function explanation(reason: unknown) {
  if (reason instanceof ApiError) {
    if (reason.code === 'RELATIONSHIP_EXISTS') return 'A request or connection already exists. Refresh friends to see its current status.';
    if (reason.code === 'REQUEST_PENDING') return 'This draft already has a request awaiting review. Open your contributions to see it.';
    if (reason.code === 'BODY_TOO_LARGE' || reason.status === 413) return 'This outline is too large to submit. Split it into smaller courses or shorten its details; your entries are still here.';
    if (reason.status === 409) return 'This changed elsewhere. Refresh the saved version, review it, then try again. Your entries are still here.';
    if (reason.status === 403 || reason.status === 404) return 'This is unavailable with your current access.';
    if (reason.status === 429) return 'Please wait a moment before trying again.';
    if (reason.status === 422) return 'Check your details and choices, then try again.';
  }
  return 'Couldn’t connect. Your entries are still here. Check your connection and retry.';
}
export function useCommunityResource<T>(path: string, sensitive = false, autoRefresh = true, options: { mutationReturnsResource?: boolean; preserveOnMutationError?: boolean } = {}) {
  const { owner, refreshIdentity } = useFocus();
  const client = useMemo(() => createCommunityClient(owner), [owner]);
  const [saved, setSaved] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const live = useRef(false), generation = useRef(0), working = useRef(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const lastPassiveCheck = useRef(0);
  const flight = useRef<{ path: string; generation: number; promise: Promise<void> } | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const pending = useRef<{ signature: string; command: SocialCommand | PublicationCommand } | null>(null);
  const failure = useCallback((reason: unknown, preserveData = false) => {
    if (reason instanceof ApiError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED')) { setSaved(null); refreshIdentity(); return; }
    if (!preserveData && (sensitive || reason instanceof ApiError && [403, 404].includes(reason.status))) setSaved(null);
    setError(explanation(reason));
  }, [refreshIdentity, sensitive]);
  const reload = useCallback((): Promise<void> => {
    if (flight.current?.path === path && flight.current.generation === generation.current) return flight.current.promise;
    const current = ++generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setLoading(true);
    const promise = (async () => {
    try {
      const data = await client.read<T>(path, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (live.current && generation.current === current && (!sensitive || document.visibilityState === 'visible')) { setSaved({ path, data }); setError(''); }
    } catch (reason) { if (live.current && generation.current === current && !controller.signal.aborted) failure(reason); }
    finally { controllers.current.delete(controller); if (flight.current?.generation === current) flight.current = null; if (live.current && generation.current === current) setLoading(false); }
    })();
    flight.current = { path, generation: current, promise };
    return promise;
  }, [client, path, failure, sensitive]);
  useEffect(() => {
    live.current = true;
    void reload();
    const active = controllers.current;
    const refresh = () => {
      if (document.visibilityState === 'hidden') { lastPassiveCheck.current = 0; if (sensitive) { setSaved(null); generation.current++; } return; }
      if (working.current || Date.now() - lastPassiveCheck.current < 1500) return;
      lastPassiveCheck.current = Date.now();
      if (sensitive) setSaved(null);
      if (autoRefresh) void reload();
      else { setLoading(false); setError('Refresh to see the current results and visibility choices.'); }
    };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { live.current = false; invalidate(); active.forEach(controller => controller.abort()); active.clear(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [reload, sensitive, autoRefresh, invalidate]);
  const act = async (endpoint: string, action: CommunityAction) => {
    if (working.current) return false;
    if (!navigator.onLine) { setError('Connect to the internet to save this change.'); return false; }
    const signature = JSON.stringify({ endpoint, action });
    if (pending.current?.signature !== signature) pending.current = { signature, command: { ...action, operationId: crypto.randomUUID() } as SocialCommand | PublicationCommand };
    working.current = true; setBusy(true); setError(''); generation.current++;
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const result = await client.command<T>(endpoint, pending.current.command, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!live.current) return false;
      pending.current = null;
      // Some endpoints return the authoritative resource after saving (e.g. sharing).
      // Avoid turning a committed save into a stale form if a redundant read fails.
      if (options.mutationReturnsResource) { setSaved({ path, data: result }); setLoading(false); }
      else { if (sensitive) setSaved(null); await reload(); }
      return true;
    } catch (reason) {
      if (live.current && !controller.signal.aborted) {
        if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 429) pending.current = null;
        failure(reason, options.preserveOnMutationError);
      }
      return false;
    } finally { controllers.current.delete(controller); working.current = false; if (live.current) setBusy(false); }
  };
  return { data: saved?.path === path ? saved.data : null, error, busy, loading, reload, act };
}
export function CommunityStatus({ error, loading, hasData, reload }: { error: string; loading: boolean; hasData: boolean; reload: () => Promise<void> }) {
  return error ? <div className="community-notice is-error" role="alert">{error}<button className="secondary" onClick={() => void reload()}>Refresh saved version</button></div> : loading && !hasData ? <div className="community-pending" role="status">Checking the latest details…</div> : null;
}
export function CommunityEmpty({ title, children }: { title: string; children?: ReactNode }) { return <div className="community-empty"><h2>{title}</h2>{children}</div>; }
export function shortTime(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
