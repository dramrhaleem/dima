'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from 'react';
import type { Enrollment } from '@dima/contracts';
import type { CourseLiveData, CourseLiveCommand } from '../../contracts/src/course-live';
import { useFocus } from './focus';
import { Avatar } from './avatar';
import { courseAdvances } from './course-journey-motion';
import './course-live.css';

const JourneyContext = createContext<{ data: CourseLiveData | null; advanced: string[]; owner: string } | null>(null);
const percent = (value: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)}%`;

export function CourseCompanions({ enrollment, children }: { enrollment: Enrollment; children: ReactNode }) {
  if (enrollment.offeringId.startsWith('private-')) return <>{children}</>;
  return <CourseCompanionsInner key={`${enrollment.id}-${enrollment.snapshot.version}`} enrollment={enrollment}>{children}</CourseCompanionsInner>;
}
function CourseCompanionsInner({ enrollment, children }: { enrollment: Enrollment; children: ReactNode }) {
  const { owner, refreshIdentity } = useFocus();
  const [data, setData] = useState<CourseLiveData | null>(null);
  const [error, setError] = useState(''), [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false), [advanced, setAdvanced] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<CourseLiveData | null>(null), live = useRef(false), generation = useRef(0);
  const flight = useRef<Promise<void> | null>(null), controller = useRef<AbortController | null>(null);
  const saving = useRef(false), celebration = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<CourseLiveCommand | null>(null);
  const failures = useRef(0), blocked = useRef(false);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const path = `/api/v1/courses/${encodeURIComponent(enrollment.offeringId)}/live?version=${encodeURIComponent(enrollment.snapshot.version)}`;

  const reload = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    if (document.hidden || saving.current || !live.current) return Promise.resolve();
    const current = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    const promise = (async () => {
      try {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Dima-Account-Id': owner }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]) });
        const body = await response.json().catch(() => null);
        if (!live.current || current !== generation.current || document.hidden) return;
        if (response.status === 401 || body?.error?.code === 'ACCOUNT_CHANGED') { setData(null); previous.current = null; refreshIdentity(); return; }
        if ([403,404].includes(response.status)) { blocked.current = true; setUnavailable(true); setData(null); previous.current = null; return; }
        if (!response.ok || body?.data?.accountId !== owner || body.data.offeringId !== enrollment.offeringId || body.data.version !== enrollment.snapshot.version) throw new Error('Unavailable');
        const next = body.data as CourseLiveData;
        const changed = courseAdvances(previous.current, next);
        previous.current = next; failures.current = 0;
        setData(next); blocked.current = false; setUnavailable(!!next.unavailable); setError('');
        if (celebration.current) clearTimeout(celebration.current);
        setAdvanced(changed);
        if (changed.length) {
          const first = next.rows.find(row => row.profileId === changed[0])!;
          setAnnouncement(changed.length > 1 ? `${changed.length} course companions took another step.` : `${first.displayName} completed ${first.latest!.taskTitle}.`);
          celebration.current = setTimeout(() => setAdvanced([]), 1800);
        }
      } catch {
        if (!live.current || current !== generation.current || abort.signal.aborted) return;
        failures.current = Math.min(failures.current + 1, 3); previous.current = null;
        setData(null); setAdvanced([]); setError('Updates paused. Reconnecting when your connection is available.');
      } finally { if (controller.current === abort) { controller.current = null; flight.current = null; } }
    })();
    flight.current = promise;
    return promise;
  }, [path, owner, enrollment.offeringId, enrollment.snapshot.version, refreshIdentity]);

  useEffect(() => {
    live.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { if (!blocked.current) await reload(); if (live.current) timer = setTimeout(() => void poll(), 15000 * 2 ** failures.current); }
    function visibility() {
      generation.current++; controller.current?.abort(); flight.current = null; previous.current = null;
      setData(null); setAdvanced([]); setAnnouncement('');
      if (!document.hidden) void reload();
    }
    function completion(event: Event) {
      if ((event as CustomEvent).detail?.accountId === owner) void reload();
    }
    void poll();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', reload);
    window.addEventListener('dima:course-progress-saved', completion);
    return () => {
      live.current = false; invalidate(); controller.current?.abort(); flight.current = null; previous.current = null;
      clearTimeout(timer); if (celebration.current) clearTimeout(celebration.current);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', reload);
      window.removeEventListener('dima:course-progress-saved', completion);
    };
  }, [reload, owner, invalidate]);

  async function sharing() {
    if (!data || saving.current) return;
    if (!pending.current || pending.current.enabled === data.sharing.enabled || pending.current.expectedRevision !== data.sharing.revision) {
      pending.current = { type: 'setCourseLiveSharing', enabled: !data.sharing.enabled, expectedRevision: data.sharing.revision, operationId: crypto.randomUUID() };
    }
    saving.current = true; setBusy(true); setError(''); generation.current++; controller.current?.abort(); flight.current = null;
    const current = generation.current;
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Dima-Account-Id': owner }, body: JSON.stringify(pending.current), signal: AbortSignal.timeout(12000) });
      if (!live.current || current !== generation.current) return;
      if (!response.ok) { if (response.status < 500 && response.status !== 429) pending.current = null; throw new Error(response.status === 409 ? 'changed' : 'save'); }
      pending.current = null; previous.current = null;
      saving.current = false; await reload();
    } catch (reason) {
      if (live.current) setError(reason instanceof Error && reason.message === 'changed' ? 'Your sharing choice changed elsewhere. Refresh and review it before saving.' : 'Couldn’t save your sharing choice. Retry when connected.');
    } finally { saving.current = false; if (live.current) setBusy(false); }
  }
  return <JourneyContext.Provider value={{ data: data?.accountId === owner ? data : null, advanced, owner }}>
    <section id="course-companions" className="course-journey" aria-label="Course companions">
      <div className="journey-heading"><div><h3>Small steps. Shared momentum.</h3><p>See the latest steps your course companions choose to share.</p></div><span className={`journey-status${data && !error ? ' is-connected' : ''}`}><i aria-hidden="true"/>{error ? 'Updates paused' : unavailable ? 'Not available for this outline' : data ? 'Updates every 15 seconds' : 'Connecting…'}</span></div>
      {error && <p className="journey-error" role="alert">{error} <button type="button" className="quiet" onClick={() => void reload()}>Refresh</button></p>}
      {unavailable && <p className="journey-explainer">Companions are available for a shared, published course version. Your own progress stays saved.</p>}
      {data && <>
        <div className="journey-sharing"><div><strong>{data.sharing.enabled ? data.sharing.rankingEnabled ? 'Your course milestones are shared' : 'Milestone sharing is on, but your leaderboard is hidden' : 'Your exact course position is private'}</strong><p>{data.sharing.enabled ? 'Only completed steps and course progress are shared. Your timer and study schedule stay private.' : 'Share your completed steps so classmates can see you along the outline.'}</p></div><button className="secondary" type="button" disabled={busy || !!data.unavailable && !data.sharing.enabled} onClick={() => void sharing()}>{busy ? 'Saving…' : data.sharing.enabled ? 'Hide my course position' : 'Share my course position'}</button></div>
        {data.sharing.enabled && !data.sharing.rankingEnabled && <p className="journey-explainer">You remain hidden until you also enable this course’s leaderboard. <a href={`/app/progress/leaderboards?offering=${encodeURIComponent(enrollment.offeringId)}&return=${enrollment.id}`}>Review leaderboard visibility</a></p>}
        {data.rows.length ? <JourneyRoster data={data} enrollmentId={enrollment.id} owner={owner} advanced={advanced}/> : <div className="journey-empty"><strong>Make room for the first shared step.</strong><p>When classmates share their position, their names and last completed lessons appear here and beside the matching modules.</p></div>}
        <details className="journey-about"><summary>What these positions mean</summary><p>These are saved completions, not a live view of someone’s screen or proof they are online. A person may study in a different order. Only people sharing their position and participating in this course’s leaderboard appear. Updates arrive about every 15 seconds while this page is visible.</p>{data.truncated && <p>Showing {data.rows.length} of {data.totalParticipants} participants, including your position when shared.</p>}</details>
      </>}
      <span className="journey-announcement" role="status" aria-live="polite">{announcement}</span>
    </section>
    {children}
  </JourneyContext.Provider>;
}

function goToModule(event: MouseEvent<HTMLAnchorElement>, enrollmentId: string, moduleId: string) {
  event.preventDefault();
  window.dispatchEvent(new CustomEvent('dima:open-course-module', { detail: { enrollmentId, moduleId } }));
}
function JourneyRoster({ data, enrollmentId, owner, advanced }: { data: CourseLiveData; enrollmentId: string; owner: string; advanced: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data.rows : data.rows.slice(0, 5);
  return <><div className="journey-roster-heading"><strong>{data.totalParticipants} {data.totalParticipants === 1 ? 'companion' : 'companions'} sharing steps</strong><span>Full course progress</span></div><ol className="journey-runners">{visible.map(person => <li key={person.profileId} className={`journey-person${person.profileId === owner ? ' is-you' : ''}${advanced.includes(person.profileId) ? ' just-advanced' : ''}`}>
    <div className="journey-person-heading"><strong>{person.displayName}{person.profileId === owner && <small>You</small>}</strong><span>{percent(person.percent)}</span></div>
    <div className="journey-track" style={{ '--progress': person.percent, '--fraction': person.percent / 100 } as CSSProperties}><div className="journey-track-fill"/><div className="journey-runner"><Avatar name={person.displayName} src={person.avatarUrl} size="medium"/>{advanced.includes(person.profileId) && <span className="journey-burst" aria-hidden="true"><i/><i/><i/><i/><i/><i/></span>}</div></div>
    <div className="journey-step">{person.latest ? <div><a href={`#module-${person.latest.moduleId}`} onClick={event => goToModule(event, enrollmentId, person.latest!.moduleId)}>{person.latest.moduleTitle}</a><span>Last completed: {person.latest.taskTitle}{person.latest.kind === 'prior' ? ' · Previous learning' : ''}</span></div> : <span>No recorded completions yet.</span>}<small>{person.completedCount} / {person.totalCount} activities</small></div>
  </li>)}</ol>{data.rows.length > 5 && <button className="quiet" type="button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer companions' : `Show all ${data.rows.length} companions`}</button>}</>;
}
export function CourseModulePeers({ moduleId }: { moduleId: string }) {
  const journey = useContext(JourneyContext);
  const people = journey?.data?.rows.filter(person => person.latest?.moduleId === moduleId) ?? [];
  if (!people.length) return null;
  return <details className="journey-module-peers"><summary><span className="journey-avatar-stack">{people.slice(0, 4).map(person => <Avatar key={person.profileId} name={person.displayName} src={person.avatarUrl} size="small" className={journey?.advanced.includes(person.profileId) ? 'just-arrived' : ''}/>)}</span><span>{people.length === 1 ? `${people[0].displayName}’s latest step is here` : `${people.length} companions last progressed here`}</span></summary><ul>{people.map(person => { const module = person.modules.find(value => value.moduleId === moduleId); return <li key={person.profileId}><strong>{person.displayName}{person.profileId === journey?.owner ? ' · You' : ''}</strong><span>{module ? `${module.completedCount} / ${module.totalCount} in this module · ` : ''}{person.latest?.taskTitle}</span></li>; })}</ul></details>;
}
export function CourseTaskPeers({ taskId }: { taskId: string }) {
  const journey = useContext(JourneyContext);
  const people = journey?.data?.rows.filter(person => person.latest?.taskId === taskId) ?? [];
  if (!people.length) return null;
  return <div className="journey-task-peers"><span className="journey-avatar-stack">{people.slice(0, 3).map(person => <span key={person.profileId} className={journey?.advanced.includes(person.profileId) ? 'just-arrived' : ''}><Avatar name={person.displayName} src={person.avatarUrl} size="small"/></span>)}</span><span>Latest completed step for {people.slice(0, 2).map(person => person.displayName).join(' & ')}{people.length > 2 ? ` +${people.length - 2} more` : ''}</span></div>;
}
