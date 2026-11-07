'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@dima/contracts';
import { createMilestoneClient, type MilestoneCommand, type MilestoneData, type MilestonePreview } from '@dima/client';
import { useFocus } from './focus';

function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Your progress or sharing changed. Refresh and preview again before sharing.';
    if (error.status === 404 || error.status === 403) return 'This milestone is no longer available to share or encourage.';
    if (error.status === 429) return 'Take a little pause. You can encourage up to 20 milestones per day.';
  }
  return 'Couldn’t load the current milestones. Check your connection and try again.';
}
/** Mount in Progress/Circle inside FocusProvider. No private progress is inferred from a profile URL. */
export function MilestonesSection() {
  const { owner } = useFocus();
  return <MilestoneContent key={owner}/>;
}
function MilestoneContent() {
  const { owner, refreshIdentity } = useFocus();
  const client = useMemo(() => createMilestoneClient(owner), [owner]);
  const [data, setData] = useState<MilestoneData | null>(null);
  const [preview, setPreview] = useState<MilestonePreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const live = useRef(false), generation = useRef(0), working = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const invalidate = useCallback(() => { generation.current++; }, []);
  const pending = useRef<{ signature: string; command: MilestoneCommand } | null>(null);
  const fail = useCallback((reason: unknown) => {
    setData(null); setPreview(null); setConsent(false);
    if (reason instanceof ApiError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED')) refreshIdentity();
    else setError(message(reason));
  }, [refreshIdentity]);
  const load = useCallback(async () => {
    if (working.current) return;
    setRefreshing(true);
    const current = ++generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const value = await client.read(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      if (live.current && generation.current === current && document.visibilityState === 'visible') { setData(value); setFeedRefreshing(false); setError(''); }
    } catch (reason) { if (live.current && generation.current === current && !controller.signal.aborted) fail(reason); }
    finally { controllers.current.delete(controller); if (live.current && generation.current === current) setRefreshing(false); }
  }, [client, fail]);
  useEffect(() => {
    live.current = true;
    void Promise.resolve().then(() => { if (live.current) return load(); });
    const active = controllers.current;
    const visibility = () => {
      generation.current++; setFeedRefreshing(true); setPreview(null); setConsent(false);
      if (document.visibilityState === 'visible' && !working.current) void load();
    };
    const timer = window.setInterval(() => { if (!working.current && document.visibilityState === 'visible') void load(); }, 15000);
    window.addEventListener('focus', visibility); document.addEventListener('visibilitychange', visibility);
    return () => { live.current = false; invalidate(); active.forEach(c => c.abort()); active.clear(); clearInterval(timer); window.removeEventListener('focus', visibility); document.removeEventListener('visibilitychange', visibility); };
  }, [load, invalidate]);
  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);
  async function showPreview(scopeId: string, trigger: HTMLButtonElement) {
    if (working.current) return;
    previewTrigger.current = trigger;
    working.current = true; setBusy(true); setPendingAction(`preview:${scopeId}`); setPreview(null); setError(''); setConsent(false); setNotice('');
    const current = ++generation.current, controller = new AbortController(); controllers.current.add(controller);
    try { const result = await client.preview(scopeId, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])); if (live.current && generation.current === current && document.visibilityState === 'visible') setPreview(result); }
    catch (reason) { if (live.current && generation.current === current && !controller.signal.aborted) fail(reason); }
    finally { controllers.current.delete(controller); working.current = false; if (live.current) { setBusy(false); setPendingAction(''); setRefreshing(false); } }
  }
  async function act(action: Omit<Extract<MilestoneCommand, { type: 'publish' }>, 'operationId'> | Omit<Extract<MilestoneCommand, { type: 'revoke' }>, 'operationId'> | Omit<Extract<MilestoneCommand, { type: 'encourage' }>, 'operationId'>) {
    if (working.current) return;
    const signature = JSON.stringify(action);
    if (pending.current?.signature !== signature) pending.current = { signature, command: { ...action, operationId: crypto.randomUUID() } };
    working.current = true; setBusy(true); setPendingAction(action.type === 'publish' ? 'publish' : `${action.type}:${action.milestoneId}`); setError(''); setNotice('');
    const current = ++generation.current, controller = new AbortController(); controllers.current.add(controller);
    try {
      const result = await client.command(pending.current.command, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      if (live.current && generation.current === current && document.visibilityState === 'visible') {
        pending.current = null; setData(result); setFeedRefreshing(false); setPreview(null); setConsent(false);
        setNotice(action.type === 'publish' ? 'Shared with your accepted followers.' : action.type === 'revoke' ? 'Milestone sharing withdrawn.' : 'Encouragement sent.');
      }
    } catch (reason) { if (live.current && generation.current === current && !controller.signal.aborted) { if (reason instanceof ApiError && reason.status < 500 && reason.status !== 429) pending.current = null; fail(reason); } }
    finally { controllers.current.delete(controller); working.current = false; if (live.current) { setBusy(false); setPendingAction(''); setRefreshing(false); } }
  }
  const friendsFeed = data?.feed.filter(item => item.profileId !== owner) ?? [];
  const activeMine = data?.mine.filter(item => !item.revokedAt) ?? [];
  const ownItems = data ? [
    ...data.candidates.map(item => ({ ...item, milestone: activeMine.find(milestone => milestone.scopeId === item.scopeId) })),
    ...activeMine.filter(item => !data.candidates.some(candidate => candidate.scopeId === item.scopeId)).map(item => ({ scopeId: item.scopeId, title: item.title, published: true, milestone: item })),
  ].map(item => ({ ...item, encouragements: data.feed.find(shared => shared.id === item.milestone?.id)?.encouragements })) : [];
  function cancelPreview() {
    setPreview(null); setConsent(false);
    previewTrigger.current?.focus();
  }
  return <section className="milestones-section community-section" aria-labelledby="milestones-heading">
    <div className="milestones-heading"><div><h2 id="milestones-heading">Celebrate a course completed.</h2><p>Share a milestone with your followers, and encourage theirs.</p></div><button className="secondary" disabled={busy || refreshing} onClick={() => void load()}>{refreshing ? 'Refreshing…' : 'Refresh milestones'}</button></div>
    {error && <p role="alert" className="community-notice is-error">{error} Use Refresh milestones to try again.</p>}{notice && <p role="status" className="community-notice">{notice}</p>}
    {!data && !error && <p role="status">Checking current milestones…</p>}
    {data && <>
      <section className="milestones-own" aria-labelledby="milestones-own-heading">
        <h3 id="milestones-own-heading">Your milestones</h3>
        <p className="community-caption">Completed public courses appear here. Only you can see them until you choose to share.</p>
        {ownItems.length === 0 ? <div className="milestones-empty"><p>No completed public courses to share yet. Keep going at your own pace.</p><a href="/app/courses">Continue a course</a></div> : <ul className="milestones-own-list">{ownItems.map(item => <li className="milestones-candidate" key={item.scopeId}>
          <div><h4>{item.title}</h4><span className={item.milestone && !item.milestone.eligible ? 'milestones-state-hidden' : ''}>{item.milestone && !item.milestone.eligible ? 'Hidden · course completion or availability changed' : item.published ? 'Shared with your followers' : 'Ready to share · only you can see this'}</span>{item.encouragements !== undefined && <span className="milestones-own-encouragement">{item.encouragements} {item.encouragements === 1 ? 'encouragement' : 'encouragements'}</span>}</div>
          {item.milestone ? <button className="secondary" disabled={busy} onClick={() => void act({ type: 'revoke', milestoneId: item.milestone!.id, expectedRevision: item.milestone!.revision })}>{pendingAction === `revoke:${item.milestone.id}` ? 'Stopping…' : 'Stop sharing'}</button> : <button className="secondary" disabled={busy || item.published} onClick={event => void showPreview(item.scopeId, event.currentTarget)}>{pendingAction === `preview:${item.scopeId}` ? 'Preparing…' : item.published ? 'Shared' : 'Preview sharing'}</button>}
        </li>)}</ul>}
        {preview && <div className="milestones-preview" role="region" aria-label="Milestone sharing preview">
          <h3 ref={previewHeading} tabIndex={-1}>Your milestone preview</h3>
          <blockquote><strong>{preview.displayName}</strong> completed <strong>{preview.title}</strong>.</blockquote>
          <p>{preview.followerCount === 0 ? 'You have no accepted followers yet. Sharing now makes this visible to followers you accept later.' : `Visible to your ${preview.followerCount} accepted ${preview.followerCount === 1 ? 'follower' : 'followers'}, and anyone you accept later.`} You can stop sharing anytime.</p>
          <p className="community-caption">Only your name and this course completion are shared. Your plan, hours and activity details stay private.</p>
          <label className="community-check"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)}/>Share this milestone with my accepted followers</label>
          <div className="milestones-actions"><button disabled={busy || !consent} onClick={() => void act({ type: 'publish', scopeId: preview.scopeId, previewToken: preview.previewToken, audience: 'accepted-followers', acknowledgeSharing: true })}>{pendingAction === 'publish' ? 'Sharing…' : 'Share milestone'}</button><button className="secondary" disabled={busy} onClick={cancelPreview}>Cancel</button></div>
        </div>}
      </section>
      <section aria-labelledby="milestones-friends-heading">
        <div className="milestones-heading"><div><h3 id="milestones-friends-heading">Friends’ milestones</h3><p className="community-caption">Completed courses shared with you. Send a little encouragement.</p></div><a href="/app/progress/circle">Find your friends</a></div>
        <div className="milestones-feed" aria-busy={feedRefreshing}>{feedRefreshing ? <p className="milestones-feed-refresh" role="status">Updating shared milestones…</p> : friendsFeed.length === 0 ? <div className="milestones-empty"><p>No milestones shared with you yet.</p><p className="community-caption">Follow a friend. When they accept and share a completed course, it will appear here.</p></div> : friendsFeed.map(item => <article className="milestones-card" key={item.id}>
          <p><strong>{item.displayName}</strong> completed</p><h4>{item.title}</h4>
          <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</time>
          <div className="milestones-card-footer"><span>{item.encouragements} {item.encouragements === 1 ? 'encouragement' : 'encouragements'}</span>{item.profileId !== owner && <button className="secondary" disabled={busy || item.encouraged} onClick={() => void act({ type: 'encourage', milestoneId: item.id })}>{pendingAction === `encourage:${item.id}` ? 'Sending…' : item.encouraged ? 'Encouragement sent' : 'Keep going!'}</button>}</div>
        </article>)}</div>
      </section>
      <details className="community-disclosure milestones-explanation"><summary>What sharing a milestone means</summary><p>A milestone records completion you marked in Dima; it is not a provider certificate. Encouragement does not add points or focus hours. You control each milestone separately from the progress summaries on your profile.</p><a href="/app/progress/sharing">Review privacy & sharing</a></details>
    </>}
  </section>;
}
