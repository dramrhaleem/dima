'use client';

import { calendarDays, courseDuration } from './planning-time';
import { enrollmentForecast } from './enrollment-forecast';
import { targetAfterMonths } from './planning-goals';
import './enrollment-setup.css';
import { PlanPreviewScreen, PlanningBacklog as Backlog, PlanOutcomes, RefreshPlanButton, planEditPath, weeklyTime } from './planning';
import { CourseRooms } from './rooms';
import { QuickCompletion } from './quick-completion';
import { CoursePeople } from './community';
import { CourseCompanions, CourseModulePeers, CourseTaskPeers } from './course-live';
import { courseProgress } from '../../domain/src/progress';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from './navigation';
import { effectiveRemaining, activeControls, isPaused, pinRemaining, recoverySummary } from '../../domain/src/recovery';
import { WorkPanel as CompletionPanel, WorkHistory, RecoverySetup, RecoveryComparison, RecoveryPrompt, PausedWork, UndoRecovery, type LearningAction } from './recovery';
import { PLANNER_VERSION } from '@dima/contracts/policy';
import type { AccountProfile, Draft, Enrollment, LearningCommand, LearningData, LearningTask, Offering, PlanPreview } from '@dima/contracts';

type LearningModule = Offering['courses'][number]['modules'][number];
type Item = { task: LearningTask; course: string; module: string };
type Act = LearningAction;
function items(offering: Pick<Offering, 'courses'>): Item[] { return offering.courses.flatMap(course => course.modules.flatMap(module => module.tasks.map(task => ({ task, course: course.title, module: module.title })))); }
function completed(enrollment: Enrollment, id: string) { return enrollment.completions.find(item => item.taskId === id)?.completed === true; }
function estimateValue(estimates: Record<string, number> | undefined, id: string) { return estimates && Object.hasOwn(estimates, id) ? estimates[id] : undefined; }
function effort(enrollment: Enrollment, task: LearningTask) { return estimateValue(enrollment.estimates, task.id) ?? task.minutes; }
function progress(enrollment: Enrollment) {
  const required = items(enrollment.snapshot).filter(({ task }) => enrollment.taskIds.includes(task.id) && task.requirement === 'required');
  const done = required.filter(({ task }) => completed(enrollment, task.id));
  const prior = done.filter(({ task }) => enrollment.completions.find(value => value.taskId === task.id)?.kind === 'prior').length;
  return { total: required.length, done: done.length, prior, fresh: done.length - prior, percent: courseProgress(enrollment).percentage };
}
function dateLabel(value: string | null) { return value ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Not yet known'; }
function later(day: string, days: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function mins(value: number | null) { return value === null ? 'Estimate needed' : `${value} min estimated`; }
function Glyph({ type = 'arrow' }: { type?: 'arrow' | 'book' | 'check' | 'plus' | 'link' | 'calendar' | 'clock' }) {
  const path = { arrow: 'M5 12h14m-5-5 5 5-5 5', book: 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14', check: 'm5 12 4 4L19 6', plus: 'M12 5v14M5 12h14', link: 'M14 4h6v6m0-6L10 14M10 5H5v14h14v-5', calendar: 'M4 6h16v15H4zM8 3v6m8-6v6M4 12h16', clock: 'M12 8v5l3 2' }[type];
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'clock' && <circle cx="12" cy="12" r="9"/>}<path d={path}/></svg>;
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`learning-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>; }
function StepLink({ href, children, secondary = false }: { href: string; children: ReactNode; secondary?: boolean }) { return <a className={`learning-link${secondary ? ' is-secondary' : ''}`} href={href}>{children}<Glyph/></a>; }
function Source({ url, children = 'Open lesson' }: { url: string; children?: ReactNode }) { return <a className="learning-source" href={url} target="_blank" rel="noopener noreferrer">{children}<Glyph type="link"/></a>; }
function Progress({ enrollment }: { enrollment: Enrollment }) { const p = progress(enrollment); const weighted = courseProgress(enrollment); return <div className="learning-progress"><div><strong>{p.percent === null ? weighted.classificationNeeded ? 'Classification needed' : 'Not applicable' : `${p.percent}%`}</strong><span>{p.done} of {p.total} required activities</span></div>{weighted.percentage !== null && <progress aria-label={`${enrollment.snapshot.title} weighted required progress`} value={weighted.completedWeight} max={weighted.requiredWeight!}/>}<small>{p.prior} completed before Dima · {p.fresh} new completions · Weighted required coverage</small></div>; }
class LearningError extends Error { constructor(public code: string, public status: number) { super(code); } }
async function request<T>(path: string, signal: AbortSignal, command?: LearningCommand, owner?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method: command ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers: { ...(command ? { 'Content-Type': 'application/json' } : {}), ...(owner ? { 'X-Dima-Account-Id': owner } : {}) }, body: command ? JSON.stringify(command) : undefined });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new LearningError(payload?.error?.code ?? 'REQUEST_FAILED', response.status);
  return (command && payload.previewId ? { ...payload.data, previewId: payload.previewId } : payload.data) as T;
}
function errorMessage(error: unknown) {
  if (!(error instanceof LearningError)) return 'Couldn’t connect. Your entries are still here. Check your connection, then try again.';
  if (error.code === 'MODULE_PREREQUISITE_INCOMPLETE') return 'Finish the prerequisite activities first. Open the course outline to review them; nothing in this module has changed.';
  if (error.code === 'PRIOR_PROGRESS_CONFLICT') return 'Some activities already have progress recorded in Dima. Choose Finished now, or review those activities individually.';
  if (error.code === 'MODULE_BATCH_CHANGED') return 'Some activities changed after this module was completed. Review them individually to avoid undoing later work.';
  if (error.code === 'MODULE_NOTHING_TO_COMPLETE') return 'All selected activities in this module are already done. Refresh to see the latest progress.';
  if (error.code === 'BODY_TOO_LARGE' || error.status === 413) return 'This outline is too large to save in one request. Split it into smaller courses or shorten its details. Your edits are still here.';
  if (error.code === 'UPGRADE_HISTORY_LIMIT') return 'This enrollment has reached its saved version limit. Your current course and history are safe; contact support before upgrading again.';
  if (error.code === 'NO_UPGRADE') return 'You already have the latest available outline. Your saved progress is unchanged.';
  if (error.code === 'MAPPING_UNRESOLVED') return 'Some activity identities changed. Keep your saved version until the outline author resolves them.';
  if (error.code === 'EMPTY_UPGRADE_SCOPE') return 'No activities remain in the proposed scope. Keep this version or include the new required activities.';
  if (error.code === 'UPGRADE_UNAVAILABLE') return 'There is no current outline available to upgrade to. Your saved course stays usable.';
  if (error.code === 'ALREADY_ENROLLED') return 'This course is already in your account. Open it from My Courses; your progress is saved.';
  if (error.status === 409) return 'Your learning changed elsewhere. Refresh the saved version before trying again. Your form stays here.';
  if (error.status === 422) return 'Check the course details, dates and estimates. Nothing has been discarded.';
  if (error.status === 404) return 'That course or activity is no longer available here. Return to your courses.';
  return 'We couldn’t save that change. Your entries are still here; try again shortly.';
}

// Private data is memory-only and scoped to the keyed account workspace lifetime.
function createLearningSession() {
  let data: LearningData | null = null;
  let checkedAt = 0;
  return {
    read: () => data,
    age: () => Date.now() - checkedAt,
    write: (value: LearningData) => { data = value; checkedAt = Date.now(); },
    invalidate: () => { checkedAt = 0; },
  };
}
type LearningSession = ReturnType<typeof createLearningSession>;
const LearningSessionContext = createContext<LearningSession | null>(null);
export function LearningSessionProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(createLearningSession);
  return <LearningSessionContext.Provider value={cache}>{children}</LearningSessionContext.Provider>;
}
// Only reviewed public metadata can be reused across account boundaries.
let publicCatalog: { items: Offering[]; expiresAt: number } | null = null;
let publicCatalogRequest: Promise<Offering[]> | null = null;
if (typeof window !== 'undefined') window.addEventListener('dima-catalog-changed', () => { publicCatalog = null; publicCatalogRequest = null; });
function getCatalog(): Promise<Offering[]> {
  if (publicCatalog && publicCatalog.expiresAt > Date.now()) return Promise.resolve(publicCatalog.items);
  if (!publicCatalogRequest) publicCatalogRequest = request<Offering[]>('/catalog', AbortSignal.timeout(20000)).then(items => {
    publicCatalog = { items, expiresAt: Date.now() + 300000 }; return items;
  }).finally(() => { publicCatalogRequest = null; });
  return publicCatalogRequest;
}

export function LearningArea({ section, query, owner, profile, onIdentityChanged }: { section: string; query?: string; owner: string; profile: AccountProfile; onIdentityChanged: (owner?: string) => void }) {
  const shared = useContext(LearningSessionContext);
  const [fallback] = useState(createLearningSession);
  const cache = shared ?? fallback;
  const [data, setData] = useState<LearningData | null>(() => { const saved = cache.read(); return saved?.accountId === owner ? saved : null; });
  const [catalog, setCatalog] = useState<Offering[] | null>(() => publicCatalog && publicCatalog.expiresAt > Date.now() ? publicCatalog.items : null);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const needsCatalog = section === 'library' || section.startsWith('library/') || section === 'courses/add';
  const [error, setError] = useState(''); const [conflict, setConflict] = useState(false); const [busy, setBusy] = useState(false);
  const alive = useRef(false); const dataRef = useRef<LearningData | null>(data); const busyRef = useRef(false); const version = useRef(0);
  const loading = useRef(false);
  const lastPassiveCheck = useRef(0);
  const identity = useRef(onIdentityChanged); const controllers = useRef(new Set<AbortController>());
  const pending = useRef<{ signature: string; command: LearningCommand } | null>(null);
  const invalidate = useCallback(() => { version.current++; }, []);
  useEffect(() => { identity.current = onIdentityChanged; }, [onIdentityChanged]);
  const controller = () => { const value = new AbortController(); controllers.current.add(value); return value; };
  const accept = useCallback((value: LearningData) => {
    if (!alive.current) return false;
    if (value.accountId !== owner) { setData(null); identity.current(owner); return false; }
    if (value.state.revision < (dataRef.current?.state.revision ?? -1)) return false;
    dataRef.current = value; cache.write(value); setData(value); return true;
  }, [owner, cache]);
  const load = useCallback(async () => {
    if (busyRef.current || loading.current) return;
    loading.current = true;
    const generation = ++version.current; const abort = new AbortController(); controllers.current.add(abort);
    try {
      const saved = await request<LearningData>('/learning', AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]));
      if (!alive.current || generation !== version.current) return;
      if (accept(saved)) { setError(''); setConflict(false); }
    } catch (reason) {
      if (!alive.current || abort.signal.aborted || generation !== version.current) return;
      if (reason instanceof LearningError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED')) { setData(null); identity.current(owner); return; }
      setError(errorMessage(reason));
    } finally { loading.current = false; controllers.current.delete(abort); }
  }, [accept, owner]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => { if (cache.read()?.accountId !== owner || cache.read()?.timezone !== profile.timezone || cache.age() > 1500) return load(); });
    const refresh = () => { if (document.visibilityState === 'visible' && Date.now() - lastPassiveCheck.current > 1500) { lastPassiveCheck.current = Date.now(); void load(); } };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const activeControllers = controllers.current;
    return () => { alive.current = false; invalidate(); activeControllers.forEach(value => value.abort()); activeControllers.clear(); loading.current = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, profile.timezone, invalidate, cache, owner]);
  useEffect(() => {
    if (!needsCatalog) return;
    let live = true;
    getCatalog().then(value => { if (live) { setCatalog(value); setCatalogError(false); } }).catch(() => { if (live) setCatalogError(true); });
    return () => { live = false; };
  }, [needsCatalog, catalogAttempt]);
  const act: Act = async command => {
    if (busyRef.current || !dataRef.current) return null;
    const expectedRevision = dataRef.current.state.revision;
    const signature = JSON.stringify(command);
    if (pending.current?.signature !== signature) pending.current = { signature, command: { ...command, expectedRevision, operationId: crypto.randomUUID() } as LearningCommand };
    const body = pending.current.command;
    const abort = controller(); version.current++; cache.invalidate(); busyRef.current = true; setBusy(true); setError(''); setConflict(false);
    try {
      const saved = await request<LearningData & { previewId?: string }>('/learning', AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), body, owner);
      if (!alive.current || saved.accountId !== owner) { if (alive.current) identity.current(owner); return null; }
      accept(saved);
      pending.current = null;
      if (['complete', 'undo', 'completeModule', 'undoModule'].includes(command.type)) window.dispatchEvent(new CustomEvent('dima:course-progress-saved', { detail: { accountId: owner } }));
      return saved;
    } catch (reason) {
      if (!alive.current || abort.signal.aborted) return null;
      if (reason instanceof LearningError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED')) { setData(null); identity.current(owner); return null; }
      if (reason instanceof LearningError && reason.status === 409) pending.current = null;
      setError(errorMessage(reason)); setConflict(reason instanceof LearningError && reason.status === 409);
      return null;
    } finally { controllers.current.delete(abort); busyRef.current = false; if (alive.current) setBusy(false); }
  };
  if (!data) return <div className="learning-loading">{error ? <><Notice error>{error}</Notice><button onClick={() => void load()}>Try again</button></> : <p role="status">Finding your place…</p>}</div>;
  const [area, child, itemId] = section.split('/');
  const routeSearch = query ?? (typeof window === 'undefined' ? '' : window.location.search);
  const offeringId = new URLSearchParams(routeSearch).get('offering') ?? '';
  const draftId = new URLSearchParams(routeSearch).get('draft') ?? '';
  const enrollment = data.state.enrollments.find(value => value.id === child);
  const privateOffering = (draft: Draft): Offering => ({ ...draft, version: draft.updatedAt, provider: 'Your private course', kind: 'course', language: 'Your choice', summary: 'A course outline that stays private to your account.', scopeLabel: 'Your own learning outline.', orderPolicy: 'Activities follow the order you set.', courses: draft.courses });
  const selected = catalog?.find(value => value.id === offeringId) ?? data.state.drafts.filter(value => value.id === offeringId).map(privateOffering)[0];
  const warning = error && <Notice error>{error}{conflict && <button className="secondary" disabled={busy} onClick={() => void load()}>Refresh saved version</button>}</Notice>;
  return <div className="learning-root" aria-busy={busy}>{warning}
    {needsCatalog && !catalog ? catalogError ? <Notice error>Couldn’t load the library. <button className="secondary" onClick={() => setCatalogAttempt(value => value + 1)}>Try again</button></Notice> : <p role="status">Opening the library…</p> : area === 'library' ? <Catalog key={child ?? "list"} initialQuery={new URLSearchParams(routeSearch).get("q") ?? ""} offerings={catalog ?? []} detailId={child} enrollments={data.state.enrollments}/> : area === 'courses' && child === 'new' ? <DraftEditor key={draftId || 'new'} initial={data.state.drafts.find(value => value.id === draftId)} busy={busy} act={act} existingEnrollment={data.state.enrollments.find(value => value.offeringId === draftId)}/> : area === 'courses' && child === 'add' ? selected ? <EnrollmentSetup key={selected.id} offering={selected} data={data} busy={busy} act={act}/> : <Catalog offerings={catalog ?? []} enrollments={data.state.enrollments}/> : area === 'courses' && enrollment && itemId === 'tasks' ? <ActivityDetail key={`${enrollment.id}-${section.split('/')[3]}`} enrollment={enrollment} taskId={section.split('/')[3]} action={new URLSearchParams(routeSearch).get('action')} planId={new URLSearchParams(routeSearch).get('plan')} data={data} busy={busy} act={act}/> : area === 'courses' && enrollment && itemId === 'people' ? <><CourseRooms key={enrollment.id} enrollmentId={enrollment.id} offeringId={enrollment.offeringId} title={enrollment.snapshot.title} isPrivate={enrollment.offeringId.startsWith('private-')}/><CoursePeople offeringId={enrollment.offeringId} isPrivate={enrollment.offeringId.startsWith('private-')}/></> : area === 'courses' && enrollment ? <CourseDetail key={enrollment.id} enrollment={enrollment} data={data} busy={busy} act={act}/> : area === 'courses' && child ? <Notice error>That course isn’t in your account. <a href="/app/courses">Return to My Courses</a>.</Notice> : area === 'courses' ? <MyCourses data={data}/> : area === 'plan' && (child === 'setup' || child === 'recovery') ? <RecoverySetup key={`${child}-${query ?? ''}`} data={data} busy={busy} act={act} recovery={child === 'recovery'} query={query}/> : area === 'plan' && child === 'previews' ? <Preview key={itemId} query={query} data={data} preview={data.state.previews.find(value => value.id === itemId)} busy={busy} act={act}/> : area === 'plan' ? <MyPlan data={data} busy={busy} act={act}/> : <Today data={data} profile={profile} busy={busy} act={act}/>}
  </div>;
}

function Catalog({ offerings, detailId, initialQuery, enrollments = [], publicView = false }: { initialQuery?: string; offerings: Offering[]; detailId?: string; enrollments?: Enrollment[]; publicView?: boolean }) {
  const [query, setQuery] = useState(() => initialQuery ?? (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('q') ?? ''));
  const selected = offerings.find(value => value.id === detailId);
  const base = publicView ? '/library' : '/app/library';
  if (detailId && !selected) return <Notice error>This offering wasn’t found. <a href={base}>Browse the library</a>.</Notice>;
  if (selected) {
    const existing = enrollments.find(value => value.offeringId === selected.id);
    const next = `/app/courses/add?offering=${encodeURIComponent(selected.id)}`;
    return <><a className="learning-back" href={base}>← All courses</a><div className="learning-course-heading"><span className="learning-kicker">{selected.provider} · {selected.kind === 'program' ? 'Certificate program' : 'Course'}</span><h2>{selected.title}</h2><p>{selected.summary}</p><p className="learning-provider-note">Study on the course provider’s website. Use Dima to plan your week and record progress.</p><div className="learning-meta"><span>{selected.courses.length} {selected.kind === 'program' ? 'courses' : 'course'}</span><span>{items(selected).length} listed activities</span><span>{selected.language}</span></div><div className="learning-actions"><StepLink href={existing ? `/app/courses/${existing.id}` : publicView ? `/auth?next=${encodeURIComponent(next)}` : next}>{existing ? 'Open my course' : 'Personalize this course'}</StepLink><Source url={selected.sourceUrl}>View at provider</Source></div></div><details className="learning-options"><summary>About this course and its estimates</summary><p>{selected.scopeLabel}</p><p>{selected.orderPolicy}</p><small>Outline version {selected.version}. Dima does not synchronize provider progress or award certificates.</small></details><Outline offering={selected}/></>;
  }
  function search(value: string) { setQuery(value); const url = new URL(window.location.href); if (value) url.searchParams.set('q', value); else url.searchParams.delete('q'); window.history.replaceState(null, '', url); }
  const filtered = offerings.filter(value => `${value.title} ${value.provider} ${value.summary}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="learning-intro"><div><h2>Find a course to add.</h2><p>Choose an outline to plan and track in Dima. The lessons open on the course provider’s website.</p></div><StepLink href="/app/courses/new" secondary>Create a private course</StepLink></div><div className="learning-search"><label htmlFor="course-search">Find a course</label><input id="course-search" type="search" value={query} placeholder="Search by course or provider" onChange={event => search(event.target.value)}/><span>{filtered.length} {filtered.length === 1 ? 'course' : 'courses'}</span></div><div className="learning-catalog-grid">{filtered.map((offering, index) => <article className="learning-course-card" key={offering.id}><div className={`learning-course-art tone-${index % 2}`} aria-hidden="true"><Glyph type="book"/><span>{offering.provider.includes('Google') ? 'A plan,\nmade possible.' : 'Think beyond\nthe screen.'}</span><i/><i/><i/></div><div className="learning-course-copy"><span className="learning-kicker">{offering.provider}</span><h3><a href={`${base}/${offering.id}`}>{offering.title}</a></h3><p>{offering.summary}</p><div className="learning-meta"><span>{offering.kind === 'program' ? `${offering.courses.length} courses` : `${offering.courses.flatMap(value => value.modules).length} modules`}</span><span>{offering.language}</span></div><a className="learning-card-link" href={`${base}/${offering.id}`}>Explore the outline<Glyph/></a></div></article>)}</div>{!filtered.length && <div className="learning-empty"><Glyph type="book"/><h3>No courses match that search.</h3><p>Your own course can still have a place here.</p><button className="secondary" onClick={() => search('')}>Clear search</button></div>}<p className="learning-footnote">Course outlines are reviewed snapshots. You study at the original provider and record progress here. Your own courses stay private until you request publication and an admin approves them.</p></>;
}

export function PublicLibrary({ detailId }: { detailId?: string }) {
  const [offerings, setOfferings] = useState<Offering[] | null>(null); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; getCatalog().then(value => { if (live) setOfferings(value); }).catch(() => { if (live) setError(true); }); return () => { live = false; }; }, [attempt]);
  return <div className="account-root learning-root">{offerings ? <Catalog offerings={offerings} detailId={detailId} publicView/> : error ? <Notice error>Couldn’t load the library. <button className="secondary" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try again</button></Notice> : <p role="status">Opening the library…</p>}</div>;
}

function Outline({ offering, selection, prior, onSelection, onPrior, estimates, onEstimate, enrollment, onTask, moduleActions }: { offering: Offering; selection?: string[]; prior?: string[]; onSelection?: (id: string, value: boolean) => void; onPrior?: (id: string, value: boolean) => void; estimates?: Record<string, number>; onEstimate?: (id: string, value: string) => void; enrollment?: Enrollment; onTask?: (task: LearningTask) => void; moduleActions?: { data: LearningData; busy: boolean; act: Act } }) {
  const searchId = useId();
  const [open, setOpen] = useState<string[]>(() => {
    const modules = offering.courses.flatMap(course => course.modules);
    const anchor = typeof window === 'undefined' ? '' : window.location.hash;
    const targeted = enrollment && onTask ? modules.find(module => anchor === `#module-${module.id}`) : undefined;
    const next = enrollment && onTask ? modules.find(module => module.tasks.some(task => enrollment.taskIds.includes(task.id) && !completed(enrollment, task.id))) : undefined;
    return targeted ? [targeted.id] : next ? [next.id] : [];
  }); const [filter, setFilter] = useState('');
  const anchorVisited = useRef(false);
  useEffect(() => {
    if (!enrollment || !onTask || anchorVisited.current) return;
    const module = offering.courses.flatMap(course => course.modules).find(value => window.location.hash === `#module-${value.id}`);
    if (!module) return;
    anchorVisited.current = true;
    const frame = requestAnimationFrame(() => document.getElementById(`module-${module.id}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [enrollment, onTask, offering.courses]);
  useEffect(() => {
    if (!enrollment || !onTask) return;
    function reveal(event: Event) {
      const detail = (event as CustomEvent<{enrollmentId: string; moduleId: string}>).detail;
      if (detail?.enrollmentId !== enrollment!.id || !offering.courses.some(course => course.modules.some(module => module.id === detail.moduleId))) return;
      setFilter(''); setOpen(previous => [...new Set([...previous, detail.moduleId])]);
      requestAnimationFrame(() => document.getElementById(`module-${detail.moduleId}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }
    window.addEventListener('dima:open-course-module', reveal);
    return () => window.removeEventListener('dima:open-course-module', reveal);
  }, [enrollment, onTask, offering.courses]);
  const [searchCollapsed, setSearchCollapsed] = useState<string[]>([]);
  const query = filter.trim().toLowerCase();
  const matches = (module: string, task: LearningTask) => !query || `${module} ${task.title}`.toLowerCase().includes(query);
  function search(value: string) { if (value.trim().toLowerCase() !== query) setSearchCollapsed([]); setFilter(value); }
  function toggleModule(id: string) {
    if (query) setSearchCollapsed(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    else setOpen(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }
  return <section className="learning-outline" aria-label="Course outline"><div className="learning-section-heading"><h3>Course outline</h3><span>In source order</span></div><label className="learning-sr" htmlFor={searchId}>Search the outline</label><input id={searchId} type="search" onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Find an activity or module" value={filter} onChange={event => search(event.target.value)}/>{query && !items(offering).some(item => matches(item.module, item.task)) && <div className="learning-empty" role="status"><p>No activities match that search.</p><button type="button" className="secondary" onClick={() => search('')}>Clear search</button></div>}{offering.courses.map((course, courseIndex) => {
    if (query && !course.modules.some(module => module.tasks.some(task => matches(module.title, task)))) return null;
    return <section className="learning-outline-course" key={course.id}><h3><span>{String(courseIndex + 1).padStart(2, '0')}</span>{course.title}</h3>{course.modules.map(module => {
    const shown = module.tasks.filter(task => matches(module.title, task));
    if (!shown.length) return null;
    const expanded = query ? !searchCollapsed.includes(module.id) : open.includes(module.id);
    const selectedIds = module.tasks.filter(task => selection?.includes(task.id)).map(task => task.id);
    const priorCount = selectedIds.filter(id => prior?.includes(id)).length;
    const selectedCount = selection ? selectedIds.length : null;
    const enrolledTasks = enrollment ? module.tasks.filter(task => enrollment.taskIds.includes(task.id)) : [];
    const enrolledDone = enrollment ? enrolledTasks.filter(task => completed(enrollment, task.id)).length : 0;
    return <div className="learning-module" id={enrollment && onTask ? `module-${module.id}` : undefined} key={module.id}><button type="button" className="learning-module-toggle" aria-expanded={expanded} onClick={() => toggleModule(module.id)}><span><strong>{module.title}</strong><small>{enrollment && onTask ? `${enrolledDone} of ${enrolledTasks.length} selected activities done` : selectedCount === null ? `${module.tasks.length} activities` : `${selectedCount} selected · ${module.tasks.length} listed`}</small></span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>{onTask && <CourseModulePeers moduleId={module.id}/>} {enrollment && moduleActions && <ModuleCompletion module={module} enrollment={enrollment} {...moduleActions}/>} {expanded && <div className="learning-task-list">{onSelection && <div className="learning-module-actions"><button type="button" className="quiet" onClick={() => module.tasks.filter(task => task.requirement === 'required').forEach(task => onSelection(task.id, true))}>Select required</button><button type="button" className="quiet" onClick={() => module.tasks.forEach(task => onSelection(task.id, false))}>Clear module</button></div>}{onPrior && <label className="learning-choice learning-module-prior"><input type="checkbox" checked={selectedIds.length > 0 && priorCount === selectedIds.length} disabled={selectedIds.length === 0} ref={element => { if (element) element.indeterminate = priorCount > 0 && priorCount < selectedIds.length; }} onChange={event => selectedIds.forEach(id => onPrior(id, event.target.checked))}/><span>Mark selected activities as done before Dima<small>Only the {selectedIds.length} selected {selectedIds.length === 1 ? 'activity' : 'activities'} in this module. Uncheck to clear these marks; your scope stays the same.</small></span></label>}{shown.map(task => {
      const isSelected = selection?.includes(task.id) ?? enrollment?.taskIds.includes(task.id) ?? true;
      const done = enrollment ? completed(enrollment, task.id) : false;
      const value = estimateValue(estimates, task.id) ?? task.minutes;
      return <div className={`learning-task-row${done ? ' is-complete' : ''}`} key={task.id}><div className="learning-task-main">{onSelection ? <label className="learning-choice"><input type="checkbox" checked={isSelected} onChange={event => onSelection(task.id, event.target.checked)} aria-label={`Include ${task.title}`}/><span><strong>{task.title}</strong><small>{task.kind} · {task.requirement} · {mins(value)}{estimateValue(estimates, task.id) !== undefined ? ' · your estimate' : task.estimateSource === 'provisional' ? ' · provisional' : ''}</small></span></label> : <div><strong>{done && <span className="learning-done-mark" aria-label="Completed">✓ </span>}{task.title}</strong><small>{task.kind} · {task.requirement} · {mins(enrollment ? effort(enrollment, task) : task.minutes)}{enrollment && !isSelected ? ' · outside your scope' : ''}{enrollment && task.estimateSource === 'provisional' && estimateValue(enrollment.estimates, task.id) === undefined ? ' · provisional' : ''}{enrollment && estimateValue(enrollment.estimates, task.id) !== undefined ? ' · your estimate' : ''}</small></div>}<div className="learning-task-actions"><Source url={task.sourceUrl}/>{onPrior && isSelected && <label className="learning-prior"><input type="checkbox" checked={prior?.includes(task.id) ?? false} onChange={event => onPrior(task.id, event.target.checked)}/>Done before Dima</label>}{enrollment && isSelected && <a className="learning-text-action" href={`/app/courses/${enrollment.id}/tasks/${task.id}`}>Activity details</a>}{enrollment && isSelected && onTask && (moduleActions ? <QuickCompletion {...moduleActions} enrollment={enrollment} task={task} review={() => onTask(task)}/> : <button className="secondary" onClick={() => onTask(task)}>{done ? 'Review completion' : 'Mark activity done'}</button>)}</div></div>{onTask && <CourseTaskPeers taskId={task.id}/>} {onEstimate && isSelected && <label className="learning-estimate">Your effort estimate <span>(minutes)</span><input type="number" min="1" max="10000" step="1" name={`estimate-${task.id}`} placeholder={task.minutes?.toString() ?? 'Needed'} value={estimateValue(estimates, task.id) ?? ''} onChange={event => onEstimate(task.id, event.target.value)}/></label>}</div>;
    })}</div>}</div>;
  })}</section>; })}</section>;
}

function ModuleCompletion({ module, enrollment, data, busy, act }: { module: LearningModule; enrollment: Enrollment; data: LearningData; busy: boolean; act: Act }) {
  const [confirming, setConfirming] = useState(false);
  const [kind, setKind] = useState<'new' | 'prior'>('new');
  const [failed, setFailed] = useState(false);
  const selected = module.tasks.filter(task => enrollment.taskIds.includes(task.id));
  const unfinished = selected.filter(task => !completed(enrollment, task.id));
  const batch = [...(data.state.moduleCompletionBatches ?? [])].reverse().find(value => value.enrollmentId === enrollment.id && value.moduleId === module.id && !value.undoneAt && value.snapshotVersion === enrollment.snapshot.version && value.taskIds.every(id => enrollment.completions.some(c => c.taskId === id && c.completed && c.moduleBatchId === value.id)));
  if (!selected.length) return null;
  async function save() {
    setFailed(false);
    if (await act({ type: 'completeModule', enrollmentId: enrollment.id, moduleId: module.id, kind })) setConfirming(false);
    else setFailed(true);
  }
  return <div className={`learning-module-completion${!unfinished.length ? ' is-done' : ''}`}>
    <div className="learning-module-completion-bar"><span>{!unfinished.length ? <><Glyph type="check"/>Module complete</> : `${unfinished.length} ${unfinished.length === 1 ? 'activity' : 'activities'} left`}</span><div className="learning-actions">
      {unfinished.length > 0 && <button type="button" className="quiet" disabled={busy} aria-expanded={confirming} onClick={() => { setConfirming(!confirming); setFailed(false); }}>Complete module</button>}
      {batch && <button type="button" className="quiet" disabled={busy} onClick={() => { setFailed(false); void act({ type: 'undoModule', enrollmentId: enrollment.id, batchId: batch.id }).then(saved => { if (!saved) setFailed(true); }); }}>Undo module completion</button>}
    </div></div>
    {confirming && unfinished.length > 0 && <div className="learning-module-confirm" role="group" aria-label={`Complete ${module.title}`}>
      <strong>{unfinished.length} {unfinished.length === 1 ? 'activity will' : 'activities will'} be marked done.</strong>
      <p>Only unfinished activities you selected in this module. Earlier completions stay unchanged, and no focus hours are added.</p>
      <div className="learning-module-kind"><label><input type="radio" name={`module-kind-${module.id}`} checked={kind === 'new'} disabled={busy} onChange={() => setKind('new')}/>Finished now</label><label><input type="radio" name={`module-kind-${module.id}`} checked={kind === 'prior'} disabled={busy} onChange={() => setKind('prior')}/>Completed before joining Dima</label></div>
      <p className="learning-footnote">{kind === 'prior' ? 'Adds your earlier progress without crediting it as new learning today.' : 'Records new completion. Study effort stays unknown until you add an estimate in activity history.'}</p>
      <div className="learning-actions"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm module completion'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></div>
    </div>}
    {failed && <p role="alert">Couldn’t update this module. Review the message above; your previous progress is safe.</p>}
  </div>;
}

function EnrollmentSetup({ offering, data, busy, act }: { offering: Offering; data: LearningData; busy: boolean; act: Act }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(() => items(offering).filter(({ task }) => task.requirement === 'required').map(({ task }) => task.id));
  const [customize, setCustomize] = useState(false);
  const [prior, setPrior] = useState<string[]>([]);
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [target, setTarget] = useState(targetAfterMonths(data.localDay, 3));
  const [week, setWeek] = useState(() => data.state.availability?.weekdayMinutes ?? [60, 60, 60, 60, 60, 0, 0]);
  const [daily, setDaily] = useState(60);
  const [batch, setBatch] = useState<Record<string, string>>({});
  const forecast = useMemo(() => enrollmentForecast(data, offering, selected, prior, estimates, target, week), [data, offering, selected, prior, estimates, target, week]);
  const existing = data.state.enrollments.find(value => value.offeringId === offering.id);
  const savedRoutine = !!data.state.availability;
  const total = week.reduce((sum, value) => sum + value, 0);
  const duration = forecast.outcome?.forecastDate ? courseDuration(forecast.startDate, forecast.outcome.forecastDate) : null;
  const gap = forecast.outcome?.forecastDate ? calendarDays(forecast.outcome.forecastDate, target) : null;
  const missingKinds = [...new Set(forecast.missing.map(task => task.kind))];
  function toggle(id: string, value: boolean) { setSelected(previous => value ? [...new Set([...previous, id])] : previous.filter(item => item !== id)); if (!value) setPrior(previous => previous.filter(item => item !== id)); }
  function estimate(id: string, value: string) { setEstimates(previous => { const next = { ...previous }; if (!value) delete next[id]; else next[id] = Number(value); return next; }); }
  function setPace(minutes: number) { setDaily(minutes); if (Number.isInteger(minutes) && minutes > 0 && minutes <= 720) setWeek(previous => previous.map(value => value > 0 ? minutes : 0)); }
  if (existing) return <div className="learning-empty"><Glyph type="check"/><h2>This course already has a place.</h2><p>Your course and progress are saved.</p><StepLink href={`/app/courses/${existing.id}`}>Open my saved course</StepLink></div>;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await act({ type: 'enroll', offeringId: offering.id, taskIds: selected, priorTaskIds: prior.filter(id => selected.includes(id)), estimates: Object.fromEntries(Object.entries(estimates).filter(([id]) => selected.includes(id))), targetDate: target });
    if (saved) {
      const enrollment = saved.state.enrollments.find(value => value.offeringId === offering.id);
      navigate(!forecast.remaining.length && enrollment ? `/app/courses/${enrollment.id}` : `/app/plan/setup${!savedRoutine ? `?week=${week.join(',')}` : ''}`);
    }
  }
  return <div className="enrollment-setup"><a className="learning-back" href="/app/library">← Choose another course</a>
    <ol className="plan-flow-steps" aria-label="Course setup steps"><li aria-current="step">1. Personalize your course</li><li>2. Review your week</li><li>3. Review your finish</li><li>4. Save and start</li></ol>
    <div className="learning-intro"><div><h2>Make {offering.title} fit your life.</h2><p>See when you could finish. Your study time and previous progress shape the plan.</p></div></div>
    <form onSubmit={event => void submit(event)}><fieldset disabled={busy} className="learning-fieldset">
      <div className="enrollment-planning-grid"><section className="enrollment-choices" aria-label="Course planning choices">
        <h3>Your study routine</h3>
        {savedRoutine ? <><p><strong>{weeklyTime(total)} per week</strong> shared across your courses.</p><p className="learning-footnote">Using your saved study days. You can adjust them in the next step.</p></> : <>
          <label htmlFor="join-daily">Minutes per study day</label><div className="enrollment-pace"><input id="join-daily" type="number" min="1" max="720" step="1" required value={daily || ''} onChange={event => setPace(Number(event.target.value))}/>{[30, 60, 90].map(minutes => <button key={minutes} type="button" className="secondary" aria-pressed={daily === minutes} onClick={() => setPace(minutes)}>{minutes} min</button>)}</div>
          <div className="enrollment-days" role="group" aria-label="Study days">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <button key={day} type="button" className="secondary" aria-pressed={week[index] > 0} onClick={() => setWeek(previous => previous.map((value, at) => at === index ? value > 0 ? 0 : daily || 60 : value))}>{day}</button>)}</div>
          <p className="learning-footnote">{weeklyTime(total)} per week · Unselected days stay free.</p>
        </>}
        <h3>When would you like to finish?</h3><div className="enrollment-goals">{[1, 2, 3, 6].map(months => <button type="button" className="secondary" key={months} aria-pressed={target === targetAfterMonths(forecast.startDate, months)} onClick={() => setTarget(targetAfterMonths(forecast.startDate, months))}>{months} {months === 1 ? 'month' : 'months'}</button>)}</div>
        <label htmlFor="join-target">Target finish date</label><input id="join-target" type="date" required min={data.localDay} value={target} onChange={event => setTarget(event.target.value)}/>
      </section>
      <section className="enrollment-forecast" aria-label="Course finish estimate"><h3>Your finish forecast</h3>
        <div className="enrollment-forecast-result" role="status" aria-live="polite" aria-atomic="true">
          {!selected.length ? <><strong>Choose some activities.</strong><p>Select what you want to study below.</p></> : !forecast.remaining.length ? <><strong>You’ve already finished this selection.</strong><p>Save your previous progress and open the course.</p></> : forecast.missing.length ? <><strong>Let’s estimate the remaining work.</strong><p>{forecast.missing.length} {forecast.missing.length === 1 ? 'activity needs' : 'activities need'} a time estimate. Add it below to see your full finish date.</p></> : !total ? <><strong>Choose a study day.</strong><p>Select at least one day to calculate your finish.</p></> : duration ? <><strong>{duration}</strong><p>Starting {dateLabel(forecast.startDate)} · Estimated finish <b>{dateLabel(forecast.outcome!.forecastDate)}</b></p><p className={gap !== null && gap < 0 ? 'enrollment-late' : ''}>{gap === 0 ? 'Fits your target date.' : gap !== null && gap > 0 ? `${gap} days before your target.` : gap !== null ? `${Math.abs(gap)} days after your target. Try more study time or a later goal.` : ''}</p></> : <><strong>Review the full schedule next.</strong><p>Your selected activities or calendar need a closer look before we can give a complete finish date.</p></>}
        </div>
        <dl><div><dt>Work left</dt><dd>{forecast.missing.length ? 'At least ' : ''}{weeklyTime(forecast.workload)}</dd></div><div><dt>Activities left</dt><dd>{forecast.remaining.length}</dd></div><div><dt>Already completed</dt><dd>{prior.length}</dd></div></dl>
        <p className="learning-footnote">{data.state.enrollments.length ? 'Includes your other courses and saved calendar. ' : ''}Based on estimated workload, with 15% of your time kept free for interruptions. You’ll review the schedule before saving it.</p>
      </section></div>
      {forecast.missing.length > 0 && <section className="enrollment-missing" aria-label="Missing activity estimates"><h3>How much time will you need?</h3><p>These activities have no published duration. Enter your own estimate for each type, or set individual times in the outline below.</p>{missingKinds.map(kind => { const tasks = forecast.missing.filter(task => task.kind === kind); const value = Number(batch[kind]); return <div className="enrollment-estimate-group" key={kind}><label htmlFor={`join-estimate-${kind}`}>{tasks.length} {kind} {tasks.length === 1 ? 'activity' : 'activities'}<small>Minutes for each activity</small></label><input id={`join-estimate-${kind}`} type="number" min="1" max="10000" step="1" value={batch[kind] ?? ''} placeholder="Your estimate" onChange={event => setBatch(previous => ({ ...previous, [kind]: event.target.value }))}/><button type="button" className="secondary" disabled={!Number.isInteger(value) || value < 1 || value > 10000} onClick={() => setEstimates(previous => ({ ...previous, ...Object.fromEntries(tasks.map(task => [task.id, value])) }))}>Apply estimate</button></div>; })}</section>}
      <details className="learning-options learning-scope-options" open={customize} onToggle={event => setCustomize(event.currentTarget.open)}><summary>Already started? Add your progress or customize activities</summary><p>Required activities are selected. Mark completed modules or activities to remove them from your remaining workload.</p><div onInvalidCapture={() => setCustomize(true)}><Outline offering={offering} selection={selected} prior={prior} onSelection={toggle} onPrior={(id, value) => setPrior(previous => value ? [...new Set([...previous, id])] : previous.filter(item => item !== id))} estimates={estimates} onEstimate={estimate}/></div></details>
      <details className="learning-options"><summary>About this course and its estimates</summary><p>{offering.scopeLabel}</p><p>{offering.orderPolicy}</p><p>Previous progress counts toward course completion, not new study hours. You study on the original provider’s website.</p></details>
      <div className="learning-form-footer"><p>{forecast.missing.length ? 'You can add the course now; a complete finish forecast needs the missing estimates.' : data.state.plan ? 'Your current schedule stays unchanged until you review and save the new plan.' : 'Next: review your weekly schedule. Your choices carry over.'}</p><button disabled={busy || !selected.length || (!savedRoutine && !total && forecast.remaining.length > 0)}>{busy ? 'Adding your course…' : !forecast.remaining.length && selected.length ? 'Save completed course' : 'Add course & continue'}<Glyph/></button></div>
    </fieldset></form></div>;
}

function MyCourses({ data }: { data: LearningData }) {
  return <><div className="learning-intro"><div><h2>Your courses and progress.</h2><p>These are the course outlines you’ve added. Open one to continue studying or update your progress.</p></div><div className="learning-actions"><StepLink href="/app/library">Find a course</StepLink><StepLink href="/app/courses/new" secondary>Create my own course</StepLink></div></div>{data.state.enrollments.length ? <div className="learning-enrollment-grid">{data.state.enrollments.map(enrollment => <article className="learning-enrollment-card" key={enrollment.id}><span className="learning-kicker">{enrollment.snapshot.provider}</span><h3><a href={`/app/courses/${enrollment.id}`}>{enrollment.snapshot.title}</a></h3><div className="learning-meta"><span>Your selected scope</span><span>Target {dateLabel(enrollment.targetDate)}</span></div><Progress enrollment={enrollment}/><a className="learning-card-link" href={`/app/courses/${enrollment.id}`}>Continue this course<Glyph/></a></article>)}</div> : <div className="learning-empty"><Glyph type="book"/><h3>No courses added yet.</h3><p>Use Add a course to find an outline in the library. You can also create your own below. Work sessions don’t need a course.</p></div>}<details className="learning-options learning-private-drafts" open={data.state.drafts.length > 0}><summary>{data.state.drafts.length ? `Your private course outlines (${data.state.drafts.length})` : 'Bring your own course'}</summary><p>Create an outline when your course isn’t in the library. It stays private unless you submit it for review.</p><a className="learning-text-action" href="/app/courses/new">Create a private course</a>{data.state.drafts.length ? <div className="learning-draft-list">{data.state.drafts.map(draft => <article key={draft.id}><div><span className="learning-kicker">Only you</span><h3>{draft.title}</h3><p>{items(draft).length} activities · Editable draft</p></div><div className="learning-actions"><a className="learning-text-action" href={`/app/courses/new?draft=${draft.id}`}>Edit outline</a><a className="learning-text-action" href={`/app/contributions?draft=${encodeURIComponent(draft.id)}`}>Request library publication</a><StepLink href={data.state.enrollments.some(value => value.offeringId === draft.id) ? `/app/courses/${data.state.enrollments.find(value => value.offeringId === draft.id)!.id}` : `/app/courses/add?offering=${draft.id}`} secondary>{data.state.enrollments.some(value => value.offeringId === draft.id) ? 'Open saved course' : 'Choose scope'}</StepLink></div></article>)}</div> : <p className="learning-footnote">No private drafts yet. A draft stays editable; joining it saves a separate, fixed snapshot.</p>}</details></>;
}

function DraftEditor({ initial, busy, act, existingEnrollment }: { initial?: Draft; busy: boolean; act: Act; existingEnrollment?: Enrollment }) {
  const [draft, setDraft] = useState(() => initial ? structuredClone(initial) : { id: `private-${crypto.randomUUID()}`, title: '', sourceUrl: '', courses: [{ id: `course-${crypto.randomUUID()}`, title: '', position: 0, modules: [{ id: `module-${crypto.randomUUID()}`, title: 'Getting started', position: 0, tasks: [] as LearningTask[] }] }] });
  const [saved, setSaved] = useState(false);
  function addModule(courseIndex: number) { setDraft(previous => ({ ...previous, courses: previous.courses.map((course, index) => index === courseIndex ? { ...course, modules: [...course.modules, { id: `module-${crypto.randomUUID()}`, title: '', position: course.modules.length, tasks: [] }] } : course) })); setSaved(false); }
  function updateModule(courseIndex: number, moduleIndex: number, title: string) { setDraft(previous => ({ ...previous, courses: previous.courses.map((course, ci) => ci === courseIndex ? { ...course, modules: course.modules.map((module, mi) => mi === moduleIndex ? { ...module, title } : module) } : course) })); setSaved(false); }
  function taskChange(courseIndex: number, moduleIndex: number, taskIndex: number, values: Partial<LearningTask>) { setDraft(previous => ({ ...previous, courses: previous.courses.map((course, ci) => ci === courseIndex ? { ...course, modules: course.modules.map((module, mi) => mi === moduleIndex ? { ...module, tasks: module.tasks.map((task, ti) => ti === taskIndex ? { ...task, ...values } : task) } : module) } : course) })); setSaved(false); }
  function addTask(courseIndex: number, moduleIndex: number) { setDraft(previous => ({ ...previous, courses: previous.courses.map((course, ci) => ci === courseIndex ? { ...course, modules: course.modules.map((module, mi) => mi === moduleIndex ? { ...module, tasks: [...module.tasks, { id: `task-${crypto.randomUUID()}`, title: '', position: module.tasks.length, kind: 'reading', minutes: 15, estimateSource: 'user' as const, requirement: 'required' as const, sourceUrl: previous.sourceUrl, prerequisiteIds: [] }] } : module) } : course) })); setSaved(false); }
  async function submit(event: FormEvent) { event.preventDefault(); const value = { id: draft.id, title: draft.title, sourceUrl: draft.sourceUrl, courses: draft.courses.map((course, index) => ({ ...course, title: course.title || draft.title, position: index, modules: course.modules.map((module, mi) => ({ ...module, position: mi, tasks: module.tasks.map((task, ti) => ({ ...task, sourceUrl: task.sourceUrl || draft.sourceUrl, position: ti })) })) })) }; if (await act({ type: 'saveDraft', draft: value })) setSaved(true); }
  return <><a className="learning-back" href="/app/courses">← My Courses</a><div className="learning-intro"><div><span className="learning-kicker">Your own outline</span><h2>Make room for any course.</h2><p>A private draft you can shape before you commit to a plan.</p></div><span className="learning-tag">Private · Only you</span></div><form className="learning-editor" onSubmit={event => void submit(event)}><fieldset disabled={busy} className="learning-fieldset"><div className="learning-panel"><label htmlFor="private-title">Course title</label><input id="private-title" maxLength={240} required value={draft.title} placeholder="What would you like to learn?" onChange={event => { setDraft({ ...draft, title: event.target.value }); setSaved(false); }}/><label htmlFor="private-source">Course source URL</label><input id="private-source" type="url" required placeholder="https://…" value={draft.sourceUrl} onChange={event => { setDraft({ ...draft, sourceUrl: event.target.value }); setSaved(false); }}/><p className="learning-footnote">Link to the provider or original resource. Dima doesn’t copy or host its content.</p></div>{draft.courses.map((course, ci) => <section key={course.id}>{draft.courses.length > 1 && <label>Course {ci + 1} title<input required value={course.title} onChange={event => { setDraft(previous => ({ ...previous, courses: previous.courses.map((value, index) => index === ci ? { ...value, title: event.target.value } : value) })); setSaved(false); }}/></label>}{course.modules.map((module, mi) => <div className="learning-editor-module" key={module.id}><label>Module {mi + 1} title<input required maxLength={240} value={module.title} placeholder="Name this part of the course" onChange={event => updateModule(ci, mi, event.target.value)}/></label>{module.tasks.map((task, ti) => <div className="learning-editor-task" key={task.id}><span className="learning-task-number">{String(ti + 1).padStart(2, '0')}</span><div><label>Activity {ti + 1} title<input required maxLength={240} value={task.title} placeholder="A clear, useful next step" onChange={event => taskChange(ci, mi, ti, { title: event.target.value })}/></label><div className="learning-editor-fields"><label>Type<select value={task.kind} onChange={event => taskChange(ci, mi, ti, { kind: event.target.value })}><option value="reading">Reading</option><option value="video">Video</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option><option value="project">Project</option></select></label><label>Effort (minutes)<input type="number" min="1" max="10000" required value={task.minutes ?? ''} onChange={event => taskChange(ci, mi, ti, { minutes: event.target.value ? Number(event.target.value) : null, estimateSource: event.target.value ? 'user' : 'missing' })}/></label><label>In this course<select value={task.requirement} onChange={event => taskChange(ci, mi, ti, { requirement: event.target.value as LearningTask['requirement'] })}><option value="required">Required</option><option value="optional">Optional</option><option value="supporting">Supporting</option><option value="alternative">Alternative</option></select></label></div><label>Activity source URL <span className="learning-muted">(optional; uses course URL)</span><input type="url" value={task.sourceUrl} onChange={event => taskChange(ci, mi, ti, { sourceUrl: event.target.value })}/></label><button type="button" className="quiet" onClick={() => { setDraft(previous => ({ ...previous, courses: previous.courses.map((value, cIndex) => cIndex === ci ? { ...value, modules: value.modules.map((part, mIndex) => mIndex === mi ? { ...part, tasks: part.tasks.filter(item => item.id !== task.id) } : part) } : value) })); setSaved(false); }}>Remove activity {ti + 1}</button></div></div>)}<button type="button" className="secondary" onClick={() => addTask(ci, mi)}><Glyph type="plus"/>Add activity to module {mi + 1}</button></div>)}<button type="button" className="secondary" onClick={() => addModule(ci)}><Glyph type="plus"/>Add module</button></section>)}<div className="learning-form-footer"><p>Estimates describe workload. They don’t create tracked hours or points.</p><button disabled={busy || items(draft).length === 0}>{busy ? 'Saving draft…' : 'Save private draft'}</button></div></fieldset></form>{saved && <Notice>{existingEnrollment ? 'Draft saved. These edits do not change your enrolled version or its progress.' : 'Draft saved. You can keep editing or choose what to study.'}<StepLink href={existingEnrollment ? `/app/courses/${existingEnrollment.id}` : `/app/courses/add?offering=${draft.id}`}>{existingEnrollment ? 'Open my saved course' : 'Choose my scope'}</StepLink><a href={`/app/contributions?draft=${encodeURIComponent(draft.id)}`}>Request library publication</a></Notice>}</>;
}


function Preview({ data, preview, busy, act, query = '' }: { data: LearningData; preview?: PlanPreview; busy: boolean; act: Act; query?: string }) {
  const previousPreview = data.state.previews.find(value => value.id === new URLSearchParams(query).get('from') && value.id !== preview?.id);
  return <PlanPreviewScreen data={data} preview={preview} busy={busy} act={act} previousPreview={previousPreview} comparison={preview && data.state.plan ? <RecoveryComparison data={data} preview={preview}/> : undefined} paused={preview ? <PausedWork data={data} preview={preview}/> : undefined}>{preview && <Schedule preview={preview} data={data}/>}</PlanPreviewScreen>;
}

function Schedule({ preview, data, saved = false }: { preview: PlanPreview; data: LearningData; saved?: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const scheduleId = useId();
  const anchor = preview.availability.startDate > data.localDay ? preview.availability.startDate : data.localDay;
  const start = later(anchor, weekOffset * 7);
  const end = later(start, 6);
  const controls = preview.controls ?? activeControls(data.state);
  const week = Array.from({ length: 7 }, (_, index) => later(start, index));
  const scheduledDates = preview.result.blocks.map(block => block.day).sort();
  const earliest = saved ? Math.min(0, Math.floor((calendarDays(anchor, scheduledDates[0] ?? anchor) ?? 0) / 7)) : 0;
  const latest = Math.max(0, Math.floor((calendarDays(anchor, scheduledDates.at(-1) ?? anchor) ?? 0) / 7));
  const visibleDays = week;
  const enrollmentById = new Map(data.state.enrollments.map(enrollment => [enrollment.id, enrollment]));
  const taskIsDone = (block: PlanPreview['result']['blocks'][number]) => {
    const enrollment = enrollmentById.get(block.enrollmentId);
    return !!enrollment && completed(enrollment, block.taskId);
  };
  const firstStudyDay = week.find(day => preview.result.blocks.some(block => block.day === day && !taskIsDone(block)))
    ?? week.find(day => preview.result.blocks.some(block => block.day === day));
  return <section className="learning-schedule"><div className="learning-section-heading"><h3>{weekOffset === 0 ? 'Your next 7 days' : weekOffset < 0 ? 'Earlier scheduled week' : 'A later week'}</h3><span aria-live="polite">{dateLabel(start)} – {dateLabel(end)}</span></div>{(earliest < 0 || latest > 0) && <nav className="plan-week-navigation" aria-label="Study weeks"><button type="button" className="secondary" disabled={weekOffset <= earliest} aria-controls={scheduleId} onClick={() => setWeekOffset(value => Math.max(earliest, value - 1))}>Previous week</button><button type="button" className="quiet" disabled={weekOffset === 0} aria-controls={scheduleId} onClick={() => setWeekOffset(0)}>Back to this week</button><button type="button" className="secondary" disabled={weekOffset >= latest} aria-controls={scheduleId} onClick={() => setWeekOffset(value => Math.min(latest, value + 1))}>Next week</button></nav>}<p className="learning-footnote">{saved ? 'Open a day to study. Completed activities update here; planned time stays as saved.' : 'This week uses the plan shown above. Select a day to see its activities.'}</p><div id={scheduleId}>{visibleDays.map(day => {
    const blocks = preview.result.blocks.filter(block => block.day === day);
    const singleCourse = new Set(blocks.map(block => block.enrollmentId)).size === 1;
    const activities = [...new Map(blocks.map(block => [`${block.enrollmentId}:${block.taskId}`, block])).values()];
    const doneCount = activities.filter(taskIsDone).length;
    const allDone = activities.length > 0 && doneCount === activities.length;
    const dayInfo = preview.result.days.find(value => value.day === day);
    const ceiling = dayInfo?.ceiling ?? (isPaused(controls, day, null) ? 0 : controls.exceptions[day] ?? preview.availability.weekdayMinutes[new Date(`${day}T12:00:00Z`).getUTCDay()]);
    const reserve = dayInfo?.reserve ?? (controls.useBuffer ? 0 : Math.ceil(ceiling * preview.availability.reservePercent / 100));
    if (!blocks.length) return <div className="plan-agenda-rest" key={day}><strong>{dateLabel(day)}</strong><span>{ceiling === 0 ? 'Rest day' : 'No activities scheduled'}<small>{ceiling === 0 ? 'No study time planned.' : 'Your available time stays free.'}</small></span></div>;
    return <details key={day} open={saved && day === firstStudyDay} className={`learning-schedule-day${saved && allDone ? ' is-day-complete' : ''}`}><summary><span><strong>{day === data.localDay ? 'Today' : dateLabel(day)}</strong><small>{new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</small></span><span>{blocks.reduce((sum, block) => sum + block.minutes, 0)} min scheduled<small>{saved ? allDone ? 'All activities completed' : `${doneCount} of ${activities.length} activities completed` : `${blocks.length} ${blocks.length === 1 ? 'study block' : 'study blocks'}`}</small></span></summary><p className="plan-day-context">{singleCourse && <>{data.state.enrollments.find(value => value.id === blocks[0]?.enrollmentId)?.snapshot.title}<br/></>}{ceiling} min available · {reserve} min {controls.useBuffer ? 'reserved' : 'kept free for flexibility'}{dayInfo?.accepted ? ` · ${dayInfo.accepted} min of effort already recorded` : ''}</p><ul>{blocks.map(block => {
      const enrollment = data.state.enrollments.find(value => value.id === block.enrollmentId);
      const task = enrollment && items(enrollment.snapshot).find(value => value.task.id === block.taskId)?.task;
      const taskDone = enrollment && completed(enrollment, block.taskId);
      const pin = block.pinId ? controls.pins.find(value => value.id === block.pinId) : undefined;
      const pinDone = pin ? pinRemaining(data.state, pin) === 0 : false;
      const done = taskDone || pinDone;
      const ready = enrollment && task ? task.prerequisiteIds.every(id => completed(enrollment, id)) : block.ready;
      return <li className={done ? 'is-complete' : ''} key={`${block.enrollmentId}-${block.taskId}-${block.part}`}><span><strong>{done ? '✓ ' : ''}{task?.title ?? 'Activity'}{block.part > 1 ? ` · block ${block.part}` : ''}</strong>{(!singleCourse || done || !ready) && <small>{!singleCourse && `${enrollment?.snapshot.title} · `}{done ? pinDone && !taskDone ? 'Pinned work recorded' : 'Completed' : !ready ? 'Prerequisite not completed yet' : ''}</small>}</span><b>{block.minutes} min{block.pinId ? ' · pinned' : ''}</b>{saved && enrollment && task && <a className="learning-schedule-open" href={`/app/courses/${enrollment.id}/tasks/${encodeURIComponent(task.id)}`}>{done ? 'Review activity' : 'Open activity'}<span className="learning-sr">: {task.title}</span></a>}</li>;
    })}</ul></details>;
  })}</div><details className="plan-schedule-help"><summary>About study blocks and time</summary><p>A study block is part of an activity, up to 45 minutes. Finishing one block does not complete the whole activity. Reserved time leaves room for interruptions; it is not extra work. These are workload estimates, not tracked timer hours.</p></details></section>;
}
function MyPlan({ data, busy, act }: { data: LearningData; busy: boolean; act: Act }) {
  const draft = data.state.previews.at(-1);
  if (!data.state.enrollments.length) return <div className="learning-empty"><Glyph type="book"/><h2>A plan starts with something to learn.</h2><p>Choose a course, then give it a week that fits your life.</p><StepLink href="/app/library">Find a course</StepLink></div>;
  if (!data.state.plan) return <div className="learning-empty"><Glyph type="calendar"/><h2>{draft ? 'Your draft is waiting for you.' : 'A clear next step starts here.'}</h2><p>{draft ? 'Your weekly choices are saved. Continue reviewing them before you apply a plan.' : 'Your courses are saved. Give them one realistic weekly rhythm, then review before applying.'}</p><div className="learning-actions"><StepLink href={draft ? `/app/plan/previews/${draft.id}` : '/app/plan/setup'}>{draft ? 'Continue planning' : 'Plan my week'}</StepLink>{draft && <a href={planEditPath(draft)}>Adjust my week</a>}</div></div>;
  const plan = data.state.plan;
  const summary = recoverySummary(data.state, data.localDay, data.timezone);
  const oldPolicy = plan.result.plannerVersion !== PLANNER_VERSION;
  const needsReview = oldPolicy || data.state.enrollments.some(value => !plan.targets[value.id]) || summary.timezoneChanged || summary.inputsChanged || summary.missedDays.length > 0;
  const total = plan.availability.weekdayMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const studyDays = plan.availability.weekdayMinutes.filter(minutes => minutes > 0).length;
  const plannedCourses = Object.keys(plan.targets).length;
  return <div className="plan-workspace">
    <header className="plan-workspace-heading"><div><p><strong>{weeklyTime(total)} per week</strong><span>{studyDays} regular study {studyDays === 1 ? 'day' : 'days'} · {plannedCourses} {plannedCourses === 1 ? 'course' : 'courses'}</span></p><small>Plan saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: data.timezone }).format(new Date(plan.appliedAt))}</small></div><div className="learning-actions"><StepLink href="/app/today">Study today</StepLink><StepLink href="/app/plan/recovery" secondary>Adjust study plan</StepLink></div></header>
    {draft && <Notice>Your saved plan is still active. You also have an unapplied preview. <a href={`/app/plan/previews/${draft.id}`}>Continue planning</a></Notice>}
    {needsReview && <div className="plan-update-note" role="status"><div><strong>{summary.missedDays.length ? 'Pick up where you left off' : 'Your plan is ready for an update'}</strong><p>{summary.missedDays.length ? `Unfinished activities from ${summary.missedDays.length} earlier study ${summary.missedDays.length === 1 ? 'day need' : 'days need'} a new place. Preview a fresh schedule with your current study time.` : oldPolicy ? 'An improved forecast is available using your saved study time.' : 'Your learning has changed. Refresh the schedule to include your current progress and course choices.'} Your active plan changes only when you save the preview.</p></div><RefreshPlanButton preview={plan} data={data} busy={busy} act={act}>Refresh forecast</RefreshPlanButton></div>}
    <PlanOutcomes preview={plan} data={data} saved/>
    <Backlog preview={plan} data={data}/>
    <Schedule preview={plan} data={data} saved/>
    <PausedWork data={data} preview={plan}/>
    <UndoRecovery data={data} busy={busy} act={act}/>
  </div>;
}

function CourseDetail({ enrollment, data, busy, act }: { enrollment: Enrollment; data: LearningData; busy: boolean; act: Act }) {
  const [chosen, setChosen] = useState<LearningTask | null>(null);
  const [editing, setEditing] = useState(false);
  const [estimates, setEstimates] = useState(enrollment.estimates ?? {});
  const [saved, setSaved] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const estimate = (id: string, value: string) => { setEstimateError(''); setEstimates(previous => { const next = { ...previous }; if (value) next[id] = Number(value); else delete next[id]; return next; }); };
  async function saveEstimates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = Object.entries(estimates).find(([, value]) => !Number.isInteger(value) || value < 1 || value > 10000);
    if (invalid) {
      const title = items(enrollment.snapshot).find(item => item.task.id === invalid[0])?.task.title ?? 'An activity';
      setEstimateError(`${title}: enter whole minutes from 1 to 10,000, or leave the estimate blank to use the original duration. Open its module or clear the search to review it.`);
      return;
    }
    setEstimateError('');
    const value = await act({ type: 'setEstimates', enrollmentId: enrollment.id, estimates });
    if (value) { setSaved(true); setEditing(false); }
    else setEstimateError('Estimates were not saved. Your edits are still here.');
  }
  return <>
    <a className="learning-back" href="/app/courses">← My Courses</a>
    <div className="learning-course-heading"><h2>{enrollment.snapshot.title}</h2><p>{enrollment.snapshot.summary}</p><div className="learning-actions"><Source url={enrollment.snapshot.sourceUrl}>Open course website</Source><a className="learning-text-action" href="/app/plan">View study plan</a></div></div>
    <nav className="focus-tabs" aria-label="Course sections"><a aria-current="page" href={`/app/courses/${enrollment.id}`}>Outline</a><a href={`/app/courses/${enrollment.id}/people`}>People</a>{!enrollment.offeringId.startsWith('private-') && <a href={`/app/progress/leaderboards?offering=${encodeURIComponent(enrollment.offeringId)}&return=${enrollment.id}`}>Leaderboard</a>}</nav>
    <div className="learning-course-stats"><Progress enrollment={enrollment}/><dl><div><dt>Target</dt><dd>{dateLabel(enrollment.targetDate)}</dd></div><div><dt>Scope</dt><dd>{enrollment.taskIds.length} selected activities</dd></div><div><dt>Tracked time</dt><dd>Separate from completion</dd></div></dl></div>
    {data.state.drafts.some(draft => draft.id === enrollment.offeringId) && <div className="learning-private-publish"><div><strong>Your private course</strong><p>Study it yourself, or ask an admin to add the outline to the public library.</p></div><a className="learning-link is-secondary" href={`/app/contributions?draft=${encodeURIComponent(enrollment.offeringId)}`}>Request library publication<Glyph/></a></div>}
    <CourseCompanions enrollment={enrollment}><Outline offering={enrollment.snapshot} enrollment={enrollment} onTask={setChosen} moduleActions={{ data, busy, act }}/></CourseCompanions>
    <details className="learning-options"><summary>Course options</summary><p>Review the saved outline, update its version, or adjust your effort estimates.</p>
      <div className="learning-provenance"><p>{enrollment.snapshot.scopeLabel}</p><p>{enrollment.snapshot.orderPolicy}</p><small>Saved version {enrollment.snapshot.version}. Progress describes your selected required activities, not provider certification or mastery. Optional and supporting work stays separate.</small></div>
      <CurriculumUpgrade enrollment={enrollment} data={data} busy={busy} act={act}/>
      <button className="secondary" onClick={() => { setEditing(!editing); setSaved(false); setEstimateError(''); }}>{editing ? 'Close estimate editor' : 'Review effort estimates'}</button>
      {saved && <Notice>Estimates saved. Preview a new plan to apply their effect.</Notice>}
      {editing && <form aria-label="Course effort estimates" onSubmit={event => void saveEstimates(event)} onInvalidCapture={() => setEstimateError('Enter whole minutes from 1 to 10,000, or leave the estimate blank to use the original duration.')}><fieldset disabled={busy} className="learning-fieldset"><Outline offering={enrollment.snapshot} enrollment={enrollment} selection={enrollment.taskIds} estimates={estimates} onEstimate={estimate}/>{estimateError && <Notice error>{estimateError}</Notice>}<button type="submit" disabled={busy}>{busy ? 'Saving estimates…' : 'Save estimates'}</button></fieldset></form>}
    </details>
    {chosen && <CompletionPanel data={data} key={`${enrollment.id}-${chosen.id}`} task={chosen} enrollment={enrollment} busy={busy} act={act} close={() => setChosen(null)}/>}
    <p className="learning-footnote">Today’s date: {dateLabel(data.localDay)} · {data.timezone}</p>
  </>;
}


function CurriculumUpgrade({ enrollment, data, busy, act }: { enrollment: Enrollment; data: LearningData; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false), [includeNew, setIncludeNew] = useState(true), [ack, setAck] = useState(false), [applied, setApplied] = useState(false);
  const preview = data.state.upgradePreviews?.find(p => p.enrollmentId === enrollment.id);
  const stale = !!preview && preview.baseRevision !== data.state.revision;
  const taskTitle = (id:string) => items(preview?.target ?? enrollment.snapshot).find(i=>i.task.id===id)?.task.title ?? items(enrollment.snapshot).find(i=>i.task.id===id)?.task.title ?? id;
  async function review() { setAck(false); setApplied(false); const result = await act({type:'previewUpgrade', enrollmentId:enrollment.id, includeNewRequired:includeNew}); if(result)setOpen(true); }
  async function apply() { if(!preview)return; const result = await act({type:'applyUpgrade',previewId:preview.id,acknowledgeChanges:true});if(result){setApplied(true);setOpen(false);} }
  return <section className="curriculum-upgrade" aria-label="Course version"><div className="learning-section-heading"><div><h3>Your saved outline stays yours.</h3><p>Updates are optional. Review their effect before changing this course.</p></div><button className="secondary" disabled={busy} onClick={()=>{setOpen(!open);setApplied(false);}}>{open?'Close version review':'Review latest outline'}</button></div>
    {applied && <Notice>Outline updated. Your matching completions and time history are preserved. <a href="/app/plan/recovery">Review your plan for the changed workload</a>.</Notice>}
    {open && <><label className="learning-choice"><input type="checkbox" checked={includeNew} disabled={busy} onChange={e=>{setIncludeNew(e.target.checked);setAck(false);}}/><span>Include newly added required activities in my scope</span></label><button disabled={busy} onClick={()=>void review()}>{busy?'Preparing preview…':'Preview outline changes'}</button>
      {preview && <div className="curriculum-preview"><p className="learning-kicker">{preview.sourceVersion} → {preview.target.version}</p><h4>What would change</h4><p>Preview valid for one hour, while your learning and the published outline stay unchanged.</p><dl className="curriculum-summary"><div><dt>Matching activities</dt><dd>{preview.mapped.length}</dd></div><div><dt>Added to the outline</dt><dd>{preview.added.length}</dd></div><div><dt>Removed from your scope</dt><dd>{preview.removed.length}</dd></div><div><dt>Unresolved identities</dt><dd>{preview.unresolved.length}</dd></div><div><dt>Required weight</dt><dd>{preview.requiredWeightBefore ?? 'Unknown'} → {preview.requiredWeightAfter ?? 'Unknown'}</dd></div><div><dt>Completed weight</dt><dd>{preview.completedWeightBefore} → {preview.completedWeightAfter}</dd></div></dl>
        <p>{preview.taskIds.length} activities in the proposed scope. Matching completions keep their original dates and credit; no hours are added. {preview.removedCompleted} removed completions will stay in version history, outside the new denominator.</p>
        {([['Added',preview.added],['Removed',preview.removed],['Unresolved',preview.unresolved]] as const).map(([label,ids])=>ids.length>0&&<details key={label}><summary>{label} activities ({ids.length})</summary><ul>{ids.map(id=><li key={id}>{taskTitle(id)}</li>)}</ul></details>)}
        {preview.unresolved.length>0 && <Notice error>An activity ID now means different work. This update is blocked until the outline author resolves its identity. Your current course remains unchanged.</Notice>}
        {preview.affectedPins>0&&<Notice>{preview.affectedPins} pinned activities leave the scope. Your current schedule is preserved; remove those pins when reviewing the plan.</Notice>}
        {(stale||includeNew!==preview.includeNewRequired)&&<Notice error>This preview no longer matches your saved learning or choices. Create a fresh preview.</Notice>}
        <label className="learning-choice"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/><span>I reviewed the scope and progress changes. I will review my plan after applying.</span></label><div className="learning-actions"><button disabled={busy||!ack||stale||includeNew!==preview.includeNewRequired||preview.unresolved.length>0||!preview.taskIds.length} onClick={()=>void apply()}>Apply reviewed update</button><button className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Keep my current version</button></div></div>}
    </>}
    {!!enrollment.upgradeHistory?.length&&<details className="curriculum-history"><summary>Previous versions and preserved progress ({enrollment.upgradeHistory.length})</summary>{enrollment.upgradeHistory.map((h,i)=><article key={`${h.snapshot.version}-${i}`}><h4>{h.snapshot.title} · {h.snapshot.version}</h4><p>Replaced {dateLabel(h.upgradedAt.slice(0,10))}. {h.completions.filter(c=>c.completed).length} completed activities in that saved scope.</p><ul>{h.completions.filter(c=>c.completed).map(c=><li key={c.claimId}>{items(h.snapshot).find(t=>t.task.id===c.taskId)?.task.title??c.taskId} · {c.kind==='prior'?'Completed before Dima':c.firstCompletedAt?dateLabel(c.firstCompletedAt.slice(0,10)):'Completion preserved'}</li>)}</ul></article>)}</details>}
  </section>;
}


function ActivityDetail({ enrollment, taskId, action, planId, data, busy, act }: { enrollment: Enrollment; taskId: string; action: string | null; planId?: string | null; data: LearningData; busy: boolean; act: Act }) {
  const [mode, setMode] = useState<'worked' | 'complete' | 'remaining' | null>(action === 'worked' || action === 'complete' || action === 'remaining' ? action : null);
  const item = items(enrollment.snapshot).find(value => value.task.id === taskId);
  if (!item || !enrollment.taskIds.includes(taskId)) return <Notice error>This activity is not in your selected scope. <a href={`/app/courses/${enrollment.id}`}>Return to the course</a>.</Notice>;
  const task = item.task; const done = completed(enrollment, task.id); const remaining = effectiveRemaining(data.state, enrollment.id, task.id);
  return <>{planId && data.state.previews.some(value => value.id === planId) && <a className="learning-back" href={planEditPath(data.state.previews.find(value => value.id === planId)!)}>Return to plan setup</a>}<a className="learning-back" href={`/app/courses/${enrollment.id}`}>Back to {enrollment.snapshot.title}</a><div className="recovery-intro"><p>{item.course} · {item.module}</p><h2>{task.title}</h2><p>{task.kind} · {task.requirement} · Your selected scope</p><Source url={task.sourceUrl}>Open learning material</Source></div><div className="work-summary"><span>{done ? 'Completed activity' : 'Activity still open'}</span><strong>{remaining === null ? 'Remaining unknown' : `${remaining} min remaining`}</strong></div>{!done && remaining === 0 && <Notice>More work needed? This activity is still open. Confirm completion only when the whole activity is done, or update the remaining estimate.</Notice>}<div className="learning-actions"><a className="learning-link" href={`/app/focus?course=${enrollment.id}&task=${encodeURIComponent(task.id)}`}>Start focus</a>{!done && <button onClick={() => setMode('worked')}>Log partial progress</button>}<QuickCompletion data={data} enrollment={enrollment} task={task} busy={busy} act={act} review={() => setMode('complete')}/>{!done && <button className="secondary" onClick={() => setMode('remaining')}>Review remaining work</button>}{!done && <a href={`/app/plan/recovery?course=${enrollment.id}&task=${encodeURIComponent(task.id)}`}>Move to another day</a>}</div><WorkHistory data={data} enrollmentId={enrollment.id} taskId={task.id} busy={busy} act={act}/>{mode && <CompletionPanel key={`${enrollment.id}-${task.id}`} data={data} enrollment={enrollment} task={task} initialMode={mode} busy={busy} act={act} close={() => setMode(null)}/>}<p className="learning-footnote">Completion, accepted planning effort and timer hours are separate. No focus time is inferred from this record.</p></>;
}

function Today({ data, profile, busy, act }: { data: LearningData; profile: AccountProfile; busy: boolean; act: Act }) {
  const [chosen, setChosen] = useState<{ enrollment: Enrollment; task: LearningTask; mode?: 'worked' | 'complete' | 'remaining'; minutes?: number; pinId?: string } | null>(null);
  const plan = data.state.plan;
  const controls = activeControls(data.state);
  const blocks = plan?.result.blocks.flatMap(block => {
    const enrollment = data.state.enrollments.find(value => value.id === block.enrollmentId);
    if (!enrollment || !enrollment.taskIds.includes(block.taskId) || completed(enrollment, block.taskId) || isPaused(controls, data.localDay, enrollment.id)) return [];
    const pin = block.pinId ? controls.pins.find(value => value.id === block.pinId) : undefined;
    const pinLeft = pin ? pinRemaining(data.state, pin) : null;
    if (pin && (pinLeft === null || pinLeft <= 0)) return [];
    const remaining = effectiveRemaining(data.state, enrollment.id, block.taskId);
    if (remaining === 0) return [];
    return [{ ...block, minutes: Math.min(block.minutes, remaining ?? block.minutes, pinLeft ?? block.minutes) }];
  }) ?? [];
  const deferred = data.state.todayOrder?.day === data.localDay ? data.state.todayOrder.taskKeys : [];
  const due = blocks.filter(block => block.day <= data.localDay).sort((a, b) => { const ai = deferred.indexOf(`${a.enrollmentId}:${a.taskId}`); const bi = deferred.indexOf(`${b.enrollmentId}:${b.taskId}`); return (ai < 0 ? -1 : ai) - (bi < 0 ? -1 : bi); });
  const next = (due.length ? due : blocks)[0]; const nextEnrollment = data.state.enrollments.find(value => value.id === next?.enrollmentId); const nextTask = nextEnrollment && items(nextEnrollment.snapshot).find(value => value.task.id === next?.taskId)?.task;
  const nextRemaining = nextEnrollment && nextTask ? effectiveRemaining(data.state, nextEnrollment.id, nextTask.id) : null;
  const totals = data.state.enrollments.map(progress); const newDone = totals.reduce((sum, value) => sum + value.fresh, 0); const prior = totals.reduce((sum, value) => sum + value.prior, 0);
  const recent = data.state.enrollments.flatMap(enrollment => enrollment.completions.filter(value => value.completed && value.kind === 'new' && value.localDay === data.localDay).map(value => ({ enrollment, task: items(enrollment.snapshot).find(item => item.task.id === value.taskId)?.task }))).filter(value => value.task);
  const hasCourses = data.state.enrollments.length > 0;
  const workOnly = !hasCourses && profile.intent === 'work';
  const draft = data.state.previews.at(-1);
  if (!plan) {
    const title = workOnly ? 'Ready for a work session?' : !hasCourses ? 'Choose what you want to learn.' : draft ? 'Your plan is ready to review.' : 'Set your weekly study time.';
    const description = workOnly ? 'Start a focus timer for your work. You don’t need to add a course or make a study plan.' : !hasCourses ? 'Add a course, set a realistic weekly plan, then start your first study session.' : draft ? 'Your weekly choices are saved. Continue from your latest preview and apply the plan when it works for you.' : 'Your course is saved. Tell Dima when you can study to turn it into a daily plan.';
    const href = workOnly ? '/app/focus?category=work' : !hasCourses ? '/app/library' : draft ? `/app/plan/previews/${draft.id}` : '/app/plan/setup';
    const action = workOnly ? 'Start work session' : !hasCourses ? 'Choose a course' : draft ? 'Continue planning' : 'Plan my week';
    return <><div className="learning-today-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
      <section className="learning-getting-started">
        {!workOnly && <ol className="learning-start-steps" aria-label="Getting started">{[
          { title: 'Choose a course', description: hasCourses ? `${data.state.enrollments.length} ${data.state.enrollments.length === 1 ? 'course added' : 'courses added'}` : 'Find an outline in the library.', done: hasCourses, current: !hasCourses },
          { title: 'Plan your week', description: draft ? 'Review your saved preview.' : 'Choose your study days and time.', done: false, current: hasCourses },
          { title: 'Start a session', description: 'Study, then record your progress.', done: false, current: false },
        ].map((step, index) => <li key={step.title} aria-current={step.current ? 'step' : undefined} className={step.done ? 'is-complete' : step.current ? 'is-current' : ''}><span className="learning-start-marker" aria-hidden="true">{step.done ? <Glyph type="check"/> : index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p><span className="learning-start-state">{step.done ? 'Done' : step.current ? 'Current step' : 'Next'}</span></div></li>)}</ol>}
        <StepLink href={href}>{action}</StepLink>
        {!workOnly && <p className="learning-start-note">{hasCourses ? 'Your progress stays saved while you set up or review your plan.' : 'You’ll study on the course provider’s website. Dima organizes the plan and progress.'}</p>}
      </section>
      {(newDone > 0 || prior > 0) && <p className="learning-start-note">{newDone} completed in Dima · {prior} completed before Dima. Your saved work stays with you.</p>}
      <TodayCourses data={data}/>
      <WorkHistory data={data} busy={busy} act={act}/>
    </>;
  }
  const nextModule = nextEnrollment?.snapshot.courses.flatMap(course => course.modules).find(module => module.tasks.some(task => task.id === nextTask?.id));
  return <>
    <div className="learning-today-heading"><div><h2>Pick up where you left off.</h2><p>Open your course to choose a lesson and update your progress.</p></div></div>
    <RecoveryPrompt data={data} onSmall={(enrollment, task, minutes, mode) => setChosen({ enrollment, task, mode, minutes })}/>
    {nextTask && nextEnrollment && next ? <section className="learning-next-step learning-today-course">
      <div className="learning-section-heading"><span>{next.day > data.localDay ? `Next planned · ${dateLabel(next.day)}` : 'Suggested for today'}</span><span>{progress(nextEnrollment).percent === null ? 'Progress not available yet' : `${progress(nextEnrollment).percent}% complete`}</span></div>
      <h3><a href={`/app/courses/${nextEnrollment.id}`}>{nextEnrollment.snapshot.title}</a></h3>
      <p className="learning-today-module">{nextModule?.title}</p>
      <div className="learning-today-lesson"><Glyph type="book"/><div><strong>{nextTask.title}</strong><span>{nextTask.kind} · {nextRemaining === null ? 'Estimate needed' : `${next.minutes} min suggested${next.part > 1 ? ` · part ${next.part}` : ''}`}</span></div></div>
      <div className="learning-actions"><StepLink href={`/app/courses/${nextEnrollment.id}${nextModule ? `#module-${nextModule.id}` : ''}`}>Continue course</StepLink><a className="learning-text-action" href={`/app/focus?course=${nextEnrollment.id}&task=${encodeURIComponent(nextTask.id)}`}>Focus on this activity<Glyph type="clock"/></a></div>
      <p className="learning-footnote">Your course opens here in Dima. Open lessons and mark activities or a whole module done there.</p>
      <details className="learning-today-adjust"><summary>Change today’s plan</summary><div className="learning-actions recovery-quick-actions"><button className="quiet" disabled={busy || next.day > data.localDay} onClick={() => void act({ type: 'laterToday', enrollmentId: nextEnrollment.id, taskId: nextTask.id })}>Study this later today</button><a href={`/app/plan/recovery?course=${nextEnrollment.id}&task=${nextTask.id}`}>Move to another day</a><a href={`/app/plan/recovery?rest=${data.localDay}`}>Take a rest day</a></div></details>
    </section> : <section className="learning-empty is-start"><Glyph type="book"/><h3>No activity waiting in today’s plan.</h3><p>Open a course to keep learning, or review your schedule when your availability changes.</p><StepLink href="/app/courses">Open my courses</StepLink><a className="learning-text-action" href="/app/plan">View study plan</a></section>}
    <TodayCourses data={data} suggestedId={nextEnrollment?.id}/>
    {recent.length > 0 && <details className="learning-options learning-today-done"><summary>{recent.length} {recent.length === 1 ? 'activity' : 'activities'} completed today</summary><div className="learning-recent">{recent.map(({ enrollment, task }) => <div key={`${enrollment.id}-${task!.id}`}><span className="learning-done-mark"><Glyph type="check"/></span><strong>{task!.title}</strong><button className="quiet" onClick={() => setChosen({ enrollment, task: task! })}>Review completion</button></div>)}</div></details>}
    <details className="learning-options"><summary>Schedule details and study history</summary><Backlog preview={plan} data={data}/><PausedWork preview={plan} data={data}/><WorkHistory data={data} busy={busy} act={act}/><a href="/app/progress">See my progress</a></details>
    {chosen && (() => { const current = data.state.enrollments.find(value => value.id === chosen.enrollment.id) ?? chosen.enrollment; return <CompletionPanel data={data} key={`${current.id}-${chosen.task.id}`} task={chosen.task} enrollment={current} initialMode={chosen.mode} suggestedMinutes={chosen.minutes} pinId={chosen.pinId} busy={busy} act={act} close={() => setChosen(null)}/>; })()}
  </>;

}

function TodayCourses({ data, suggestedId }: { data: LearningData; suggestedId?: string }) {
  if (!data.state.enrollments.length) return null;
  return <section className="learning-today-courses" aria-label="Your courses"><div className="learning-section-heading"><h3>Your courses</h3><a href="/app/courses">Manage courses</a></div><div className="learning-today-course-list">{data.state.enrollments.map(enrollment => { const p = progress(enrollment); return <a key={enrollment.id} href={`/app/courses/${enrollment.id}`} className="learning-today-course-link"><Glyph type="book"/><div><strong>{enrollment.snapshot.title}</strong><span>{p.done} of {p.total} required activities done{enrollment.id === suggestedId ? ' · Suggested above' : ''}</span></div><span className="learning-today-percent">{p.percent === null ? '—' : `${p.percent}%`}</span><Glyph/></a>; })}</div></section>;
}
