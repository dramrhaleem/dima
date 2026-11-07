'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { LearningData, PublicRoom, RoomDirectory, RoomOptions, RoomParticipant, RoomPresetId, RoomSnapshot } from '@dima/contracts';
import { ROOM_INTENTS, ROOM_LANGUAGES, ROOM_PRESETS, ROOM_REMOVAL_REASONS, ROOM_REPORT_REASONS } from '@dima/contracts/room-policy';
import { ActiveFocus, FocusSoundControls, Dialog, formatTime, PendingStops, useFocus } from './focus';
import { publicRoomRead, roomMessage, useRooms, type RoomAction } from './rooms-provider';
import { useNavigate } from './navigation';
import { CopyLink } from './copy-link';

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`focus-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
function Label({ value }: { value: string }) { if (value === 'watching') return <>Not focusing</>; return <>{value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase())}</>; }
function phaseName(room: PublicRoom) { return { lobby: 'Ready to begin', focus: 'Focus', shortBreak: 'Short break', longBreak: 'Long break', completed: 'Run complete', cancelled: 'Run cancelled' }[room.phase.kind]; }
function usePublic<T>(path: string) {
  const [resource, setResource] = useState<{ path: string; value: T } | null>(null);
  const value = resource?.path === path ? resource.value : null;
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void publicRoomRead<T>(path, controller.signal).then(data => { if (!controller.signal.aborted) { setResource({ path, value: data }); setError(''); } }).catch(reason => { if (!controller.signal.aborted) setError(roomMessage(reason)); });
    return () => controller.abort();
  }, [path, attempt]);
  return { value, error, refresh: () => setAttempt(value => value + 1) };
}
function FocusTabs({ rooms = true }: { rooms?: boolean }) {
  return <nav className="focus-tabs" aria-label="Focus mode"><a href="/app/focus" aria-current={!rooms ? 'page' : undefined}>Focus alone</a><a href="/app/rooms" aria-current={rooms ? 'page' : undefined}>Study rooms</a></nav>;
}
function RoomCard({ room, signed }: { room: PublicRoom; signed: boolean }) {
  const preset = ROOM_PRESETS[room.run?.status === 'active' ? room.run.presetId : room.configuredPreset];
  return <article className="room-card"><div className="room-card-meta"><span className={`room-phase is-${room.phase.kind}`}>{phaseName(room)}{room.phase.roundIndex ? ` · ${room.phase.roundIndex}/4` : ''}</span><span>{ROOM_LANGUAGES.find(value => value.id === room.language)?.label ?? room.language}</span></div><h3 dir="auto"><a href={`${signed ? '/app' : ''}/rooms/${room.id}`}>{room.title}</a></h3><p>{room.offering?.title ?? room.topic}</p><div className="room-card-foot"><span>{room.connectedCount} connected · {room.reservedCount}/{room.capacity} seats reserved</span><span>{room.phase.endsAt ? `${formatTime(room.phase.secondsRemaining)} remaining · ` : ''}{preset.focusMinutes} min focus / {preset.shortBreakMinutes} min break</span></div><a className="room-card-link" href={`${signed ? '/app' : ''}/rooms/${room.id}`}>View room <span aria-hidden="true">→</span></a></article>;
}
export function RoomDirectoryView({ signed = false, query = '', offeringId, compact = false }: { signed?: boolean; query?: string; offeringId?: string; compact?: boolean }) {
  const navigate = useNavigate();
  const params = new URLSearchParams(query);
  if (offeringId) params.set('offeringId', offeringId);
  const path = `?${params.toString()}`;
  const { value, error, refresh } = usePublic<RoomDirectory>(path);
  const { value: options } = usePublic<RoomOptions>('/options');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [language, setLanguage] = useState(params.get('language') ?? '');
  const [offering, setOffering] = useState(offeringId ?? params.get('offeringId') ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const appliedOffering = params.get('offeringId');
  const selectedCourse = options?.offerings.find(item => item.id === appliedOffering);
  const createPath = `/app/rooms/new${appliedOffering && selectedCourse ? `?offeringId=${encodeURIComponent(appliedOffering)}` : ''}`;
  const createHref = signed ? createPath : `/auth?next=${encodeURIComponent(createPath)}`;
  const appliedFilters = Number(!!params.get('language')) + Number(!!params.get('offeringId'));
  function filter(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (search.trim()) next.set('q', search.trim()); if (language) next.set('language', language); if (offering) next.set('offeringId', offering);
    navigate(`${signed ? '/app' : ''}/rooms${next.size ? `?${next}` : ''}`);
  }
  return <section className={`room-directory${compact ? ' is-compact' : ''}`}>
    {!compact && <header className="rooms-intro"><div><h2>Study together.</h2><p>Join a room or create one and send its link to friends. Choose a focus round when you’re ready to study.</p></div><a className="account-button-link" href={createHref}>Create a room</a></header>}
    {!compact && <form className={`room-filters${filtersOpen ? ' is-expanded' : ''}`} onSubmit={filter}>
      <label className="room-search-field">Find a room<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title or topic" maxLength={80}/></label>
      <button type="button" className="secondary room-filter-toggle" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(!filtersOpen)}>Filters{appliedFilters > 0 && <span> · {appliedFilters} active</span>}</button>
      <div id={filtersId} className={`room-filter-options${filtersOpen ? ' is-open' : ''}`}>
        <label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option value="">Any language</option>{ROOM_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Course<select value={offering} onChange={event => setOffering(event.target.value)}><option value="">Any topic or course</option>{options?.offerings.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      </div>
      <button className="room-apply-filters">{filtersOpen || language || offering ? 'Apply filters' : 'Search rooms'}</button>
    </form>}

    {!compact && (params.has('q') || params.has('language') || params.has('offeringId')) && <div className="room-applied-filters">{selectedCourse && <p>Rooms for <strong>{selectedCourse.title}</strong></p>}<a href={`${signed ? '/app' : ''}/rooms`}>Clear filters</a></div>}
    {error && <Notice error>{error} {value && 'The previous results are shown; counts may have changed.'}<button className="quiet" onClick={refresh}>Refresh rooms</button></Notice>}
    {!value && !error ? <p role="status">Finding rooms…</p> : value?.rooms.length ? <><div className="rooms-grid">{value.rooms.map(room => <RoomCard key={room.id} room={room} signed={signed}/>)}</div><button className="quiet" onClick={refresh}>Refresh room listings</button><p className="room-snapshot-note">Counts and remaining time reflect the latest saved snapshot. Reserved seats include people reconnecting; they are not a measure of learning.</p>{value.nextCursor && <a href={`${signed ? '/app' : ''}/rooms?${new URLSearchParams({ ...Object.fromEntries(params), cursor: value.nextCursor })}`}>Next rooms</a>}</> : value && <div className="room-empty"><h3>{params.size ? 'No rooms match yet.' : 'There’s room for a new beginning.'}</h3><p>{params.size ? 'Try another filter, or create a room for this subject.' : 'There are no open rooms to show. You can create one or begin a solo session.'}</p><div className="focus-actions"><a className="account-button-link" href={createHref}>Create a room</a><a href={signed ? '/app/focus' : '/auth?next=%2Fapp%2Ffocus'}>Focus solo</a></div></div>}
  </section>;
}
function PublicDetails({ room, compact = false }: { room: PublicRoom; compact?: boolean }) {
  if (compact) return <header className="room-live-header">
    <p className="learning-kicker">{room.offering?.title ?? room.topic} · {ROOM_LANGUAGES.find(value => value.id === room.language)?.label ?? room.language}</p>
    <h1 id="workspace-title" tabIndex={-1} dir="auto">{room.title}</h1>
    <div className="room-live-meta"><span>{room.connectedCount} connected · {room.reservedCount}/{room.capacity} reserved</span>
      <details><summary>Room details</summary><p dir="auto">{room.description || 'A quiet place to focus together.'}</p><p>Next run: {ROOM_PRESETS[room.configuredPreset].focusMinutes} min focus · {ROOM_PRESETS[room.configuredPreset].shortBreakMinutes} min short break · {ROOM_PRESETS[room.configuredPreset].longBreakMinutes} min long break · 4 rounds.</p></details>
    </div>
  </header>;
  return <><div className="room-detail-heading"><p className="learning-kicker">{room.offering?.provider ?? 'Topic room'} · {ROOM_LANGUAGES.find(value => value.id === room.language)?.label ?? room.language}</p><h2 dir="auto">{room.title}</h2><p>{room.description || 'A quiet place to focus together.'}</p><span className="room-subject">{room.offering?.title ?? room.topic}</span></div><dl className="room-facts"><div><dt>Current phase</dt><dd>{phaseName(room)}{room.phase.endsAt && <small>{formatTime(room.phase.secondsRemaining)} remaining when updated</small>}</dd></div><div><dt>Seats reserved</dt><dd>{room.reservedCount} / {room.capacity}</dd></div><div><dt>Connected</dt><dd>{room.connectedCount}</dd></div><div><dt>Next run rhythm</dt><dd>{ROOM_PRESETS[room.configuredPreset].label} · 4 rounds</dd></div></dl></>;
}
export function PublicRooms({ detailId, query = '' }: { detailId?: string; query?: string }) {
  if (!detailId) return <div className="rooms-root"><RoomDirectoryView query={query}/></div>;
  return <PublicRoomDetail key={detailId} roomId={detailId}/>;
}
function PublicRoomDetail({ roomId }: { roomId: string }) {
  const { value: room, error, refresh } = usePublic<PublicRoom>(`/${encodeURIComponent(roomId)}`);
  return <div className="rooms-root"><a href="/rooms">Back to rooms</a>{room ? <><PublicDetails room={room}/><button className="quiet" onClick={refresh}>Refresh availability</button><section className="room-consent"><h3>Join at your own pace.</h3><p>Room members will see your display name and declared focus state after you choose to join. Visitors never see the member list. Your tasks and plan stay private.</p><p>Quiet by design: no microphone, camera or chat. Personal timers start only when you join a focus round.</p>{room.status === 'open' ? <a className="account-button-link" href={`/auth?next=${encodeURIComponent(`/app/rooms/${room.id}`)}`}>Sign in to join</a> : <Notice>This room is {room.status}. <a href="/rooms">Find another room</a>.</Notice>}</section></> : error ? <Notice error>{error}<button onClick={refresh}>Try again</button></Notice> : <p role="status">Opening room…</p>}</div>;
}

type RoomFields = { title: string; description: string; language: string; topic: string; offeringId: string; presetId: RoomPresetId };
function MetadataFields({ value, change, options, active = false }: { value: RoomFields; change: (value: RoomFields) => void; options: RoomOptions | null; active?: boolean }) {
  const prefix = useId();
  const field = (key: keyof RoomFields, next: string) => change({ ...value, [key]: next });
  return <><label htmlFor={`${prefix}-title`}>Room title<input id={`${prefix}-title`} value={value.title} onChange={event => field('title', event.target.value)} minLength={3} maxLength={60} required placeholder="A clear invitation to focus"/></label><label>Description <span className="focus-optional">optional</span><textarea value={value.description} onChange={event => field('description', event.target.value)} maxLength={240} rows={3}/></label><p className="focus-caption">Public text only. No links, private task names or personal contact details.</p><div className="room-form-row"><label>Language<select value={value.language} onChange={event => field('language', event.target.value)}>{ROOM_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Shared course<select value={value.offeringId} onChange={event => field('offeringId', event.target.value)}><option value="">Use a topic instead</option>{options?.offerings.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>{!value.offeringId && <label>Topic<input value={value.topic} onChange={event => field('topic', event.target.value)} minLength={2} maxLength={80} required placeholder="For example, reading or project work"/></label>}<fieldset className="room-preset"><legend>{active ? 'Preset for the next run' : 'Room rhythm'}</legend>{(Object.entries(ROOM_PRESETS) as Array<[RoomPresetId, typeof ROOM_PRESETS.classic | typeof ROOM_PRESETS.deep]>).map(([id, preset]) => <label key={id}><input type="radio" name={`${prefix}-preset`} value={id} checked={value.presetId === id} onChange={() => field('presetId', id)}/><span><strong>{preset.focusMinutes} min focus / {preset.shortBreakMinutes} min break</strong><small>4 rounds, then {preset.longBreakMinutes} min long break</small></span></label>)}</fieldset>{active && <p className="focus-caption">The active run keeps its original timings. These settings apply only to the next run.</p>}</>;
}
function VisibilityConsent({ checked, set }: { checked: boolean; set: (value: boolean) => void }) {
  return <label className="focus-check room-visibility"><input type="checkbox" checked={checked} onChange={event => set(event.target.checked)}/>I understand that room members will see my display name and declared focus state. My plan and task details stay private.</label>;
}
function CreateRoom({ query }: { query: string }) {
  const { value: options, error, refresh } = usePublic<RoomOptions>('/options');
  const requested = new URLSearchParams(query).get('offeringId');
  if (!options) return error ? <Notice error>Couldn’t load the shared courses. <button onClick={refresh}>Try again</button></Notice> : <p role="status">Preparing your room…</p>;
  const initialOfferingId = options.offerings.find(item => item.id === requested)?.id ?? '';
  return <CreateRoomForm options={options} initialOfferingId={initialOfferingId}/>;
}
function CreateRoomForm({ options, initialOfferingId }: { options: RoomOptions; initialOfferingId: string }) {
  const { me, ready, busy, act, draft, saveDraft } = useRooms(); const focus = useFocus(); const navigate = useNavigate();
  const [fields, setFields] = useState<RoomFields>(draft ?? { title: '', description: '', language: 'en', topic: '', offeringId: initialOfferingId, presetId: 'classic' });
  const [consent, setConsent] = useState(false); const [review, setReview] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => { if (review) previewRef.current?.focus(); }, [review]);
  const similar = usePublic<RoomDirectory>(`?${new URLSearchParams(fields.offeringId ? { offeringId: fields.offeringId, limit: '3' } : { limit: '3' })}`);
  const conflict = me?.membership?.status === 'active' || !!focus.data?.active;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!review) { setReview(true); return; }
    if (!focus.ids || !consent || conflict) return;
    const response = await act({ type: 'create', deviceId: focus.ids.tab, title: fields.title, description: fields.description, language: fields.language as 'en', topic: fields.offeringId ? null : fields.topic, offeringId: fields.offeringId || null, presetId: fields.presetId, acknowledgeVisibility: true, visibilityVersion: 1 });
    if (response?.receipt.roomId) { saveDraft(null); navigate(`/app/rooms/${response.receipt.roomId}`); }
  }
  return <><a className="learning-back" href="/app/rooms">Back to rooms</a><div className="rooms-intro"><div><p className="learning-kicker">Make room for each other</p><h2>A shared rhythm starts here.</h2><p>Creating a room reserves your seat. Your timer stays off until you join a focus round.</p></div></div>{conflict && <Notice>Finish your current focus and leave its room before creating another. Your draft stays here while you resolve it. <a href={me?.membership?.status === 'active' ? `/app/rooms/${me.membership.roomId}` : '/app/focus'}>Open current focus</a></Notice>}<div className="room-create-grid"><form className="room-form" onSubmit={event => void submit(event)}><MetadataFields value={fields} change={value => { setFields(value); saveDraft(value); setReview(false); }} options={options}/><VisibilityConsent checked={consent} set={setConsent}/>{review && <section className="room-public-preview" ref={previewRef} tabIndex={-1} aria-labelledby="room-preview-title"><h3 id="room-preview-title">Review your room</h3><p>Check these public details, then create your room below.</p><strong dir="auto">{fields.title}</strong><p>{fields.description}</p><p>{options?.offerings.find(value => value.id === fields.offeringId)?.title ?? fields.topic} · {ROOM_LANGUAGES.find(value => value.id === fields.language)?.label} · {ROOM_PRESETS[fields.presetId].label}</p><p>Members see your name only after joining. Any member can start the shared cycle. Focus and breaks then change automatically; each person chooses when to join a focus round.</p></section>}<button disabled={!ready || !focus.ids || !focus.online || busy || review && !consent || conflict || focus.pending.length > 0}>{busy ? 'Creating…' : review ? 'Create and enter room' : 'Preview public details'}</button><p className="focus-caption">Up to {options?.maxOpenOwned ?? 3} open rooms per owner and {options?.maxCreatedPerUtcDay ?? 1} new room per UTC day. A room has {options?.capacity ?? 20} reserved seats including you.</p></form><aside className="room-similar"><h3>There may already be a place for you.</h3><p>Joining an existing room can bring you together sooner.</p>{similar.value?.rooms.map(room => <RoomCard signed key={room.id} room={room}/>)}{similar.value?.rooms.length === 0 && <p>No matching rooms are open right now.</p>}<a href="/app/rooms">Browse all rooms</a></aside></div></>;
}

function JoinRoom({ room, refreshAvailability }: { room: PublicRoom; refreshAvailability: () => void }) {
  const { me, ready, busy, act, now, accesses } = useRooms(); const focus = useFocus();
  const [consent, setConsent] = useState(false); const [confirmSwitch, setConfirmSwitch] = useState(false);
  const usableTime = focus.data?.accountId === focus.owner ? focus.data : null;
  const member = me?.membership; const active = usableTime?.active;
  const live = member?.status === 'active' && Date.parse(member.seatExpiresAt) > now;
  const switching = !!active && active.roomId !== room.id || !!live && member.roomId !== room.id || !!active && !live && active.roomId !== room.id;
  const access = accesses[room.id] ?? null;
  const full = room.reservedCount >= room.capacity;
  const blocked = room.status !== 'open' || access && ['banned', 'removed', 'closed', 'suspended', 'archived'].includes(access.state) && !access.canRejoin;
  async function join() {
    if (!focus.ids || !usableTime || !consent) return;
    if (switching) await act({ type: 'switchToRoom', roomId: room.id, fromRoomId: live ? member!.roomId : null, deviceId: focus.ids.tab, presenceControlVersion: live ? member!.controlVersion : null, expectedTimeRevision: usableTime.revision, fromSessionId: active?.id ?? null, timeControlVersion: active?.controlVersion ?? null, acknowledgeVisibility: true, visibilityVersion: 1 });
    else await act({ type: 'join', roomId: room.id, deviceId: focus.ids.tab, acknowledgeVisibility: true, visibilityVersion: 1 });
  }
  return <section className="room-consent"><h3>{access?.state === 'expired' ? 'Your seat was released.' : full ? 'This room is full right now.' : 'Take a seat, without starting your timer.'}</h3>{access?.state === 'expired' && <p>Your accepted session remains in Activity until its known boundary. Rejoining checks capacity and never duplicates that session.</p>}<p>Members can see your display name and declared state. Your task, notes and plan remain private. No camera, microphone or free chat.</p>{blocked ? <Notice>{access?.state === 'banned' ? 'You are banned from this room.' : access?.state === 'removed' ? 'You were removed from the current run.' : `This room is ${room.status}.`} <a href="/app/rooms">Choose another room</a> or <a href="/app/focus">focus solo</a>.<button className="quiet" onClick={refreshAvailability}>Check room access again</button></Notice> : full ? <div className="room-capacity-recovery"><p>All {room.capacity} seats are reserved, including people reconnecting. Check again or choose another room.</p><div className="focus-actions"><button className="secondary" disabled={!focus.online || busy} onClick={refreshAvailability}>Check for a seat</button><a className="account-button-link" href="/app/rooms">Find another room</a></div></div> : <>{!usableTime && <p className="focus-caption" role="status">{focus.error ? 'Load your saved time before joining.' : 'Checking your saved time before joining…'}</p>}<VisibilityConsent checked={consent} set={setConsent}/>{switching && <label className="focus-check"><input type="checkbox" checked={confirmSwitch} onChange={event => setConfirmSwitch(event.target.checked)}/>Finish my current session and leave its room if this seat is available. If the switch fails, keep my previous focus.</label>}{active?.status === 'needsReview' && <Notice>Review your current session before switching. <a href={`/app/progress/activity/${active.id}`}>Review saved time</a>.</Notice>}<div className="focus-actions"><button disabled={!ready || !usableTime || !focus.online || !focus.ids || busy || !consent || switching && !confirmSwitch || active?.status === 'needsReview' || focus.pending.length > 0 || room.reservedCount >= room.capacity} onClick={() => void join()}>{room.reservedCount >= room.capacity ? 'Room full' : busy ? 'Joining…' : switching ? 'Leave and join this room' : access?.state === 'expired' ? 'Rejoin room' : 'Enter room'}</button><a href="/app/focus">Choose solo instead</a></div></>}{active?.roomId === room.id && <div className="focus-actions"><a href={`/app/progress/activity/${active.id}`}>Open my personal time record</a><a href="/app/focus?switch=solo">Finish and start solo</a></div>}</section>;
}

type PrivateActivity = { value: string; enrollmentId: string; taskId: string; title: string; course: string };
function JoinRound({ snapshot }: { snapshot: RoomSnapshot }) {
  const focus = useFocus(); const rooms = useRooms();
  const usableTime = focus.data?.accountId === focus.owner ? focus.data : null;
  const [category, setCategory] = useState<'work' | 'learning'>(snapshot.room.offering ? 'learning' : focus.profile.intent === 'work' ? 'work' : 'learning');
  const [selection, setSelection] = useState(''); const [activities, setActivities] = useState<PrivateActivity[]>([]); const [activityError, setActivityError] = useState('');
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/learning', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Dima-Account-Id': focus.owner } }).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(({ data }: { data: LearningData }) => {
      if (controller.signal.aborted || data.accountId !== focus.owner) return;
      setActivities(data.state.enrollments.flatMap(enrollment => enrollment.snapshot.courses.flatMap(course => course.modules.flatMap(module => module.tasks.filter(task => enrollment.taskIds.includes(task.id)).map(task => ({ value: JSON.stringify([enrollment.id, task.id]), enrollmentId: enrollment.id, taskId: task.id, title: task.title, course: enrollment.snapshot.title }))))));
    }).catch(() => { if (!controller.signal.aborted) setActivityError('Private activities could not be loaded. You can still focus without linking one.'); });
    return () => controller.abort();
  }, [focus.owner]);
  const member = rooms.me?.membership;
  const ownControl = !!focus.ids && member?.deviceId === focus.ids.tab;
  const room = snapshot.room;
  const remaining = room.phase.endsAt ? Math.max(0, (Date.parse(room.phase.endsAt) - rooms.now) / 1000) : 0;
  async function join(event: FormEvent) {
    event.preventDefault(); if (waiting || !member || !focus.ids || !usableTime || !room.run || !room.phase.roundIndex) return;
    const activity = category === 'learning' ? activities.find(value => value.value === selection) : undefined;
    if (selection && category === 'learning' && !activity) return;
    await rooms.act({ type: 'joinRound', roomId: room.id, deviceId: focus.ids.tab, controlVersion: member.controlVersion, runId: room.run.id, roundIndex: room.phase.roundIndex, expectedTimeRevision: usableTime.revision, category, enrollmentId: activity?.enrollmentId ?? null, taskId: activity?.taskId ?? null });
  }
  if (usableTime?.active) return <><h3>My personal session</h3><ActiveFocus session={usableTime.active} showTitle={usableTime.active.title !== room.title}/></>;
  if (room.phase.kind !== 'focus') return <section className="room-personal"><h3>{room.phase.kind.includes('Break') ? 'Take the break you need.' : room.status !== 'open' ? 'No new rounds in this room.' : snapshot.capabilities.canStartRun ? 'Ready to start the room?' : 'Getting the next cycle ready.'}</h3><p>{room.phase.kind.includes('Break') ? 'This break adds no focus time. When the next round starts, choose Join this focus round to start your timer.' : room.status !== 'open' ? 'Your recorded time stays saved. You can leave and choose another room.' : snapshot.capabilities.canStartRun ? 'Any member can start this cycle. Focus and breaks then change automatically. Join the focus round to start your own timer.' : 'Refresh the room to check whether a new cycle is ready. No host is needed to start it; your personal timer always starts by your choice.'}</p>{snapshot.capabilities.canStartRun && member && focus.ids && <button disabled={!focus.online || !ownControl || rooms.busy || focus.pending.length > 0} onClick={() => void rooms.act({ type: 'startRun', roomId: room.id, deviceId: focus.ids!.tab, controlVersion: member.controlVersion, roomVersion: room.version })}>Start shared cycle</button>}{focus.savedSession && <a href={`/app/progress/activity/${focus.savedSession.id}`}>View my saved session</a>}</section>;
  return <form className="room-personal" onSubmit={event => void join(event)}>
    <p className="focus-caption">In room · Your timer is off</p>
    <h3>{waiting ? 'You’re waiting for the next round.' : 'Ready to focus with the group?'}</h3>
    {!usableTime && <p className="focus-caption" role="status">{focus.error ? 'Load your saved time before joining.' : 'Checking your saved time before joining…'}</p>}
    <p>{formatTime(remaining)} remains in this round. Your timer starts when you join; earlier time is not added.</p>
    {waiting ? <p>Nothing starts automatically. Choose whether to join when the next round begins.</p> : <>
      {remaining < 60 && <Notice>Less than a minute remains. Waiting for the next round may be more useful; you can still choose the remaining time.</Notice>}
      <fieldset className="focus-segment"><legend>My private focus</legend>{(['work', 'learning'] as const).map(value => <label key={value}>
        <input type="radio" name="room-category" checked={category === value} onChange={() => setCategory(value)}/>{value === 'work' ? 'Work' : 'Learning'}
      </label>)}</fieldset>
      {category === 'learning' && <label>Private activity <span className="focus-optional">optional</span><select value={selection} onChange={event => setSelection(event.target.value)}>
        <option value="">No linked activity</option>{activities.map(value => <option key={value.value} value={value.value}>{value.course} · {value.title}</option>)}
      </select></label>}
      {activityError && <p>{activityError}</p>}
      <p className="focus-caption">Other members never see this choice or your task name.</p>
      <button disabled={!usableTime || !focus.online || !ownControl || rooms.busy || focus.pending.length > 0 || !snapshot.capabilities.canJoinRound || remaining <= 0}>{rooms.busy ? 'Joining round…' : 'Join this focus round'}</button>
      {!snapshot.capabilities.canJoinRound && <p className="focus-caption">{snapshot.capabilities.joinRoundReason ?? 'Refresh the room before joining this round.'}</p>}
    </>}
    <button className="quiet" type="button" onClick={() => setWaiting(!waiting)}>{waiting ? 'Show join option' : 'Wait for next round'}</button>
  </form>;
}

function RoomRoundPath({ room }: { room: PublicRoom }) {
  const current = room.phase.roundIndex ?? 0;
  return <ol className="room-round-path" aria-label="Shared cycle rounds">{[1, 2, 3, 4].map(round => {
    const state = room.phase.kind === 'completed' || current > round ? 'Done' : current === round ? room.phase.kind === 'focus' ? 'Focus' : 'Break' : 'Next';
    return <li key={round} data-state={state.toLowerCase()} aria-current={current === round ? 'step' : undefined}><span>Round {round}</span><strong>{state}</strong></li>;
  })}</ol>;
}

function RoomMembers({ snapshot, onAction }: { snapshot: RoomSnapshot; onAction: (kind: string, participant?: RoomParticipant) => void }) {
  const rooms = useRooms(); const focus = useFocus(); const member = rooms.me?.membership;
  const ownTime = focus.data && focus.data.revision >= snapshot.me.timeRevision ? focus.data : null;
  const ownSession = ownTime?.active?.mode === 'room' && ownTime.active.roomId === snapshot.room.id ? ownTime.active : null;
  const ownState = ownSession?.status === 'running' ? 'focusing' : ownSession?.status === 'paused' ? 'paused' : 'watching';
  return <section className="room-members"><div className="room-section-heading"><h3>People in this room</h3><span>{snapshot.room.connectedCount} connected · {snapshot.room.reservedCount} seats reserved</span></div><p className="focus-caption">These are declared states, not verified learning. Private plans and tasks are never shown.</p><ul>{snapshot.participants.map(person => <li key={person.membershipId}><span className="room-avatar" aria-hidden="true">{Array.from(person.displayName)[0]}</span><div><strong dir="auto">{person.displayName}{person.membershipId === member?.id ? ' (you)' : ''}</strong><span><Label value={person.membershipId === member?.id && ownTime ? ownState : person.focus}/> · <Label value={person.presence}/>{person.intent && <> · <Label value={person.intent}/></>}</span></div>{person.isHost && !person.isOwner && <span className="room-role">Room moderator</span>}{person.isOwner && <span className="room-role">Owner</span>}{person.membershipId !== member?.id && <details className="room-person-menu"><summary>Options<span className="sr-only"> for {person.displayName}</span></summary><div><button onClick={() => onAction('report', person)}>Report participant</button><button onClick={() => onAction('block', person)}>Block</button>{snapshot.capabilities.canTransferHost && <button onClick={() => onAction('offerHost', person)}>Offer moderation role</button>}{snapshot.capabilities.canRemove && <button onClick={() => onAction('remove', person)}>Remove from run</button>}{snapshot.capabilities.canBan && <button onClick={() => onAction('ban', person)}>Ban from room</button>}</div></details>}</li>)}</ul>{snapshot.ownBlocks.length > 0 && <details><summary>Blocked participants ({snapshot.ownBlocks.length})</summary><p>Blocking hides permitted identity and interactions between you. It does not remove someone or change reserved seats.</p>{snapshot.ownBlocks.map((block, index) => <button key={block.id} className="secondary" disabled={rooms.busy || !focus.online} onClick={() => void rooms.act({ type: 'unblock', roomId: snapshot.room.id, blockId: block.id })}>Unblock participant {index + 1}</button>)}</details>}{snapshot.bans.length > 0 && snapshot.capabilities.canBan && <details><summary>Room bans ({snapshot.bans.length})</summary>{snapshot.bans.map((ban, index) => <div key={ban.id}><span>Ban {index + 1} · {ban.reason}</span><button disabled={rooms.busy || !focus.online} onClick={() => void rooms.act({ type: 'unban', roomId: snapshot.room.id, banId: ban.id })}>Lift ban</button></div>)}</details>}</section>;
}

function RoomActionDialog({ kind, participant, room, snapshot, close }: { kind: string; participant?: RoomParticipant; room: PublicRoom; snapshot: RoomSnapshot | null; close: () => void }) {
  const rooms = useRooms(); const focus = useFocus(); const [reason, setReason] = useState('other'); const [details, setDetails] = useState(''); const [confirmed, setConfirmed] = useState(false); const [sent, setSent] = useState(false);
  const targetVisible = participant ? snapshot?.participants.some(value => value.membershipId === participant.membershipId) : true;
  const allowed = kind === 'report' || kind === 'leave' && rooms.me?.membership?.status === 'active' || kind === 'close' && (!!snapshot?.capabilities.canClose || !!rooms.accesses[room.id]?.canClose) || kind === 'offerHost' && !!snapshot?.capabilities.canTransferHost && targetVisible || kind === 'remove' && !!snapshot?.capabilities.canRemove && targetVisible || kind === 'ban' && !!snapshot?.capabilities.canBan && targetVisible || kind === 'block' && targetVisible;
  const pendingTimeConflict = focus.pending.length > 0 && !['report', 'block'].includes(kind);
  const title = ({ leave: 'Leave this room?', close: 'Close new admissions?', remove: 'Remove participant from this run?', ban: 'Ban participant from this room?', block: 'Block this participant?', offerHost: 'Offer room moderation?', report: 'Report a concern' } as Record<string, string>)[kind] ?? 'Review room action';
  async function submit(event: FormEvent) {
    event.preventDefault(); const member = rooms.me?.membership; if (!focus.ids || !allowed) return;
    let command: RoomAction | null = null;
    const presence = member ? { roomId: room.id, deviceId: focus.ids.tab, controlVersion: member.controlVersion } : null;
    if (kind === 'leave' && presence && focus.data) command = { ...presence, type: 'leave', expectedTimeRevision: focus.data.revision, fromSessionId: focus.data.active?.id ?? null, timeControlVersion: focus.data.active?.controlVersion ?? null };
    if (kind === 'close') command = { type: 'close', roomId: room.id, roomVersion: room.version };
    if (kind === 'offerHost' && presence && participant) command = { ...presence, type: 'offerHost', targetMembershipId: participant.membershipId, roomVersion: room.version };
    if (kind === 'remove' && presence && participant) command = { ...presence, type: 'remove', targetMembershipId: participant.membershipId, reason: reason as 'other' };
    if (kind === 'ban' && participant) command = { type: 'ban', roomId: room.id, targetMembershipId: participant.membershipId, reason: reason as 'other' };
    if (kind === 'block' && participant) command = { type: 'block', roomId: room.id, targetMembershipId: participant.membershipId };
    if (kind === 'report') command = { type: 'report', roomId: room.id, targetMembershipId: participant?.membershipId ?? null, reason: reason as 'other', details };
    if (!command) return;
    const response = await rooms.act(command); if (response) { if (kind === 'report') setSent(true); else close(); }
  }
  return <Dialog title={title} close={close}>{sent ? <><p>Your report has been recorded. This confirms submission, not a completed review. Your identity is not shown to the reported participant.</p><button onClick={close}>Done</button></> : <form className="room-form" onSubmit={event => void submit(event)}>{participant && <p>{targetVisible ? participant.displayName : "Participant from your previous room view"}</p>}{!allowed && <Notice>Your room permissions changed. Close this dialog and refresh before continuing.</Notice>}<p>{kind === 'leave' ? 'Your room focus ends when the server accepts Leave. Previously accepted time stays saved, and the group clock continues.' : kind === 'close' ? 'New members and new runs are blocked immediately. Existing members can finish the current run before membership ends.' : kind === 'remove' ? 'This ends their room focus and membership and prevents rejoining this run. Earlier accepted time stays saved.' : kind === 'ban' ? 'This ends their room participation and blocks future joining until you lift the ban. Earlier time stays saved.' : kind === 'block' ? 'Your permitted names and interactions are hidden from each other. This does not remove either person from a public room. You can also leave or choose another room.' : kind === 'offerHost' ? 'The participant must accept. Until then, your moderation role stays unchanged. Anyone can start a cycle; the room owner does not change.' : 'Choose the reason that best describes the concern. Do not include private account details.'}</p>{['report', 'remove', 'ban'].includes(kind) && <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>{(kind === 'report' ? ROOM_REPORT_REASONS : ROOM_REMOVAL_REASONS).map(value => <option key={value} value={value}>{value.replaceAll('-', ' ')}</option>)}</select></label>}{kind === 'report' && <label>Additional details <span className="focus-optional">optional</span><textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={500} rows={3}/></label>}<label className="focus-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I understand this action.</label>{rooms.error && <Notice error>{rooms.error}</Notice>}<div className="focus-actions"><button disabled={!allowed || !confirmed || rooms.busy || !focus.online || pendingTimeConflict}>{rooms.busy ? 'Saving…' : kind === 'report' ? 'Submit report' : 'Confirm action'}</button><button type="button" className="secondary" onClick={close}>Cancel</button></div></form>}</Dialog>;
}
function EditRoom({ room, close }: { room: PublicRoom; close: () => void }) {
  const { act, busy, error, snapshot, accesses } = useRooms(); const focus = useFocus(); const { value: options } = usePublic<RoomOptions>('/options');
  const [fields, setFields] = useState<RoomFields>({ title: room.title, description: room.description, language: room.language, topic: room.topic ?? '', offeringId: room.offering?.id ?? '', presetId: room.configuredPreset });
  const canEdit = snapshot?.room.id === room.id && snapshot.capabilities.canEdit || accesses[room.id]?.canEdit;
  async function submit(event: FormEvent) { event.preventDefault(); if (!canEdit) return; if (await act({ type: 'edit', roomId: room.id, roomVersion: room.version, ...fields, language: fields.language as 'en', topic: fields.offeringId ? null : fields.topic, offeringId: fields.offeringId || null })) close(); }
  return <Dialog title="Edit room details" close={close}><form className="room-form" onSubmit={event => void submit(event)}><MetadataFields value={fields} change={setFields} options={options} active={room.run?.status === 'active'}/>{error && <Notice error>{error}</Notice>}<button disabled={busy || !focus.online || !canEdit}>Save room details</button><button type="button" className="secondary" onClick={close}>Cancel</button></form></Dialog>;
}

function RoomView({ roomId }: { roomId: string }) {
  const rooms = useRooms(); const focus = useFocus();
  const { load, snapshotFor, refreshBoundary, clearSnapshot, watchRoom, serverNow } = rooms;
  const publicState = usePublic<PublicRoom>(`/${encodeURIComponent(roomId)}`);
  const [dialog, setDialog] = useState<{ kind: string; person?: RoomParticipant } | null>(null);
  const closeDialog = () => { setDialog(null); publicState.refresh(); void load(roomId); };
  const snapshot = rooms.snapshot?.room.id === roomId ? rooms.snapshot : null;
  const room = snapshot?.room ?? (rooms.me?.room?.id === roomId ? rooms.me.room : publicState.value);
  const member = rooms.me?.membership;
  const live = member?.roomId === roomId && member.status === 'active' && Date.parse(member.seatExpiresAt) > rooms.now;
  const ownControl = live && focus.ids?.tab === member.deviceId;
  useEffect(() => { watchRoom(roomId); void load(roomId); return () => watchRoom(null); }, [load, watchRoom, roomId]);
  useEffect(() => {
    if (live) void snapshotFor(roomId);
    else clearSnapshot();
  }, [live, member?.id, member?.controlVersion, snapshotFor, clearSnapshot, roomId]);
  useEffect(() => {
    if (!room?.phase.endsAt || !live) return;
    const deadline = Date.parse(room.phase.endsAt);
    const delay = deadline - serverNow();
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const result = await refreshBoundary(roomId, deadline);
      if (!cancelled && (result.status === 'unavailable' || result.status === 'retry')) {
        retry = setTimeout(() => { if (!cancelled) void refreshBoundary(roomId, deadline); }, 750);
      }
    };
    const timer = setTimeout(() => void refresh(), Math.max(100, delay + 200));
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(retry); };
  }, [room?.phase.endsAt, serverNow, live, member?.id, member?.controlVersion, refreshBoundary, roomId]);
  useEffect(() => {
    if (!snapshot?.capabilities.claimHostAt || snapshot.capabilities.canClaimHost || !live) return;
    const delay = Date.parse(snapshot.capabilities.claimHostAt) - serverNow();
    const timer = setTimeout(() => void snapshotFor(roomId), Math.max(100, delay + 200));
    return () => clearTimeout(timer);
  }, [snapshot?.capabilities.claimHostAt, snapshot?.capabilities.canClaimHost, serverNow, live, snapshotFor, roomId]);
  const presence = member && focus.ids ? { roomId, deviceId: focus.ids.tab, controlVersion: member.controlVersion } : null;
  if (!room) return <><a href="/app/rooms">Back to rooms</a>{publicState.error ? <Notice error>{publicState.error}<button onClick={publicState.refresh}>Try again</button></Notice> : <p role="status">Opening room…</p>}</>;
  const left = room.phase.endsAt ? Math.max(0, (Date.parse(room.phase.endsAt) - rooms.now) / 1000) : 0;
  const offer = snapshot?.transferOffer;
  const neutralIntent = member?.intent ?? '';
  return <><div className="room-toolbar"><a href="/app/rooms">← Back to rooms</a>{!live && <button className="quiet" onClick={() => { publicState.refresh(); void load(roomId); }}>Refresh availability</button>}{room.status === 'open' && <CopyLink path={`/rooms/${room.id}`} label="Copy room invite link"/>}<details><summary>Room options</summary><div className="room-menu-actions"><button onClick={() => setDialog({ kind: 'report' })}>Report room</button>{(snapshot?.capabilities.canEdit || rooms.accesses[roomId]?.canEdit) && <button onClick={() => setDialog({ kind: 'edit' })}>Edit details / next preset</button>}{(snapshot?.capabilities.canClose || rooms.accesses[roomId]?.canClose) && room.status === 'open' && <button onClick={() => setDialog({ kind: 'close' })}>Close new admissions</button>}{live && <button onClick={() => setDialog({ kind: 'leave' })}>Leave room</button>}</div></details></div><PublicDetails room={room} compact={!!live}/>
    {!live ? <JoinRoom key={room.id} room={room} refreshAvailability={() => { publicState.refresh(); void load(roomId); }}/> : <>
      <div className="room-sync" role="status"><span className={rooms.connection === 'connected' ? 'is-connected' : ''}>{!focus.online ? 'Offline · estimated display' : rooms.connection === 'connected' ? 'Live room updates connected' : 'Reconnecting · checking with the server'}</span><button className="quiet" disabled={!focus.online || rooms.busy} onClick={() => void load(roomId).then(() => snapshotFor(roomId))}>Refresh room</button></div>
      {!ownControl && presence && <Notice>Another tab or device controls your room presence. Viewing does not transfer control.<button disabled={!focus.online || rooms.busy || focus.pending.length > 0} onClick={() => void rooms.act({ type: 'takeControl', ...presence })}>Take room control on this tab</button></Notice>}
      {room.status === 'closed' && <Notice>This room is closed to new members. Its current run can finish; no new run will start.</Notice>}
      {snapshot ? <>
        <div className="room-focus-grid"><section className="room-group-clock"><p className="learning-kicker">Shared room clock · not my recorded time</p>{room.run && <p className="focus-caption">Run rhythm: {ROOM_PRESETS[room.run.presetId].focusMinutes} min focus · {ROOM_PRESETS[room.run.presetId].shortBreakMinutes} min short break · {ROOM_PRESETS[room.run.presetId].longBreakMinutes} min long break.</p>}<h3>{phaseName(room)}{room.phase.roundIndex ? ` · round ${room.phase.roundIndex} of 4` : ''}</h3>{room.phase.endsAt ? <><div role="timer" aria-label="Room phase time remaining" className="room-clock">{formatTime(left)}</div><p>{left <= 0 ? 'This phase has ended. Confirming the next phase…' : room.phase.kind === 'focus' ? 'Everyone sees the same countdown. Pausing your timer does not pause the room.' : 'No focus time is recorded during the break.'}</p></> : <p>Four rounds, one shared rhythm. Each person chooses whether to join each round.</p>}
          <RoomRoundPath room={room}/>
          {!focus.data?.active && <FocusSoundControls/>}
          {snapshot.capabilities.canClaimHost && presence && <details className="room-moderation"><summary>Room moderation</summary><p>The previous moderator is away. You can help manage disruptive participants. Starting a cycle does not need this role.</p><button className="secondary" disabled={!focus.online || !ownControl || rooms.busy} onClick={() => void rooms.act({ type: 'claimHost', ...presence })}>Become room moderator</button></details>}
          {offer?.targetMembershipId === member?.id && Date.parse(offer.expiresAt) > rooms.now && presence && <Notice>You’ve been offered room moderation. This does not control anyone’s saved time.<button disabled={!ownControl || !focus.online || rooms.busy} onClick={() => void rooms.act({ type: 'acceptHost', ...presence, offerId: offer.id })}>Accept moderation role</button></Notice>}
          {offer?.fromMembershipId === member?.id && Date.parse(offer.expiresAt) > rooms.now && <p>Moderation offer sent. Your role stays unchanged until they accept.</p>}
        </section><div className="room-personal-column"><JoinRound key={`${room.run?.id ?? 'lobby'}-${room.phase.roundIndex ?? 0}`} snapshot={snapshot}/></div></div>
        <section className="room-presence-settings"><label>Optional public intention<select value={neutralIntent} disabled={!ownControl || !focus.online || rooms.busy} onChange={event => presence && void rooms.act({ type: 'setIntent', ...presence, intent: event.target.value ? event.target.value as typeof ROOM_INTENTS[number] : null })}><option value="">No intention shown</option>{ROOM_INTENTS.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><p>This neutral label can be seen by members. It never reveals your private task.</p></section>
        {['shortBreak', 'longBreak'].includes(room.phase.kind) && presence && <section className="room-encouragement"><h3>A quiet moment of encouragement</h3><p>One reaction every 30 seconds. No messages or notifications are required.</p><div className="focus-actions"><button className="secondary" disabled={!ownControl || !focus.online || rooms.busy} onClick={() => void rooms.act({ type: 'react', ...presence, reaction: 'wave' })}>Wave</button><button className="secondary" disabled={!ownControl || !focus.online || rooms.busy} onClick={() => void rooms.act({ type: 'react', ...presence, reaction: 'wellDone' })}>Well done</button></div><ul>{snapshot.reactions.slice(-3).map(reaction => { const person = snapshot.participants.find(value => value.membershipId === reaction.membershipId); return person ? <li key={reaction.id}>{person.displayName} · {reaction.kind === 'wave' ? 'waved' : 'well done'}</li> : null; })}</ul></section>}
        <RoomMembers snapshot={snapshot} onAction={(kind, person) => setDialog({ kind, person })}/>
      </> : <Notice>Member details are unavailable until your presence is confirmed. Your private time record remains available. <button disabled={!focus.online} onClick={() => void snapshotFor(roomId)}>Check membership</button></Notice>}
      <div className="room-exit-actions"><button className="secondary" disabled={rooms.busy || !focus.online || !ownControl || focus.pending.length > 0} onClick={() => setDialog({ kind: 'leave' })}>Leave room</button><a href="/app/focus?switch=solo">Set up solo focus</a><a href="/app/progress/activity">My saved time</a></div>
    </>}
    {dialog?.kind === 'edit' ? <EditRoom room={room} close={closeDialog}/> : dialog && <RoomActionDialog kind={dialog.kind} participant={dialog.person} room={room} snapshot={snapshot} close={closeDialog}/>}
  </>;
}

export function RoomsArea({ section, query }: { section: string; query: string }) {
  const rooms = useRooms(); const focus = useFocus();
  const [retryingTime, setRetryingTime] = useState(false);
  async function retryTime() {
    if (retryingTime || !focus.online) return;
    setRetryingTime(true);
    try { await focus.load(); } finally { setRetryingTime(false); }
  }
  const child = section.split('/')[1];
  const joined = !!child && rooms.me?.membership?.roomId === child && rooms.me.membership.status === 'active' && Date.parse(rooms.me.membership.seatExpiresAt) > rooms.now;
  return <div className={`rooms-root${joined ? ' is-joined-room' : ''}`}><FocusTabs/>{!joined && <p className="focus-caption">Viewing a room never joins it or starts a timer.</p>}{rooms.error && <Notice error>{rooms.error}<button className="quiet" onClick={() => void rooms.load(child && child !== 'new' ? child : undefined)}>Refresh my room state</button></Notice>}{focus.error && <Notice error>{focus.error}<button className="quiet" type="button" disabled={!focus.online || retryingTime} onClick={() => void retryTime()}>{retryingTime ? 'Retrying…' : 'Retry time'}</button></Notice>}{focus.storageError && <Notice error>{focus.storageError}</Notice>}<PendingStops/>{child === 'new' ? <CreateRoom query={query}/> : child ? <RoomView key={child} roomId={child}/> : <RoomDirectoryView key={query} signed query={query}/>}</div>;
}
export function CourseRooms({ enrollmentId, offeringId, title, isPrivate }: { enrollmentId: string; offeringId: string; title: string; isPrivate: boolean }) {
  const options = usePublic<RoomOptions>('/options');
  const privateCourse = isPrivate || !!options.value && !options.value.offerings.some(value => value.id === offeringId);
  return <section className="rooms-root"><a className="learning-back" href={`/app/courses/${enrollmentId}`}>Back to {title}</a><nav className="focus-tabs" aria-label="Course sections"><a href={`/app/courses/${enrollmentId}`}>Outline</a><a aria-current="page" href={`/app/courses/${enrollmentId}/people`}>People</a></nav><div className="rooms-intro"><div><h2>Study this course together.</h2><p>Meet in a shared focus room, then return to your own course and plan. Create a room to invite your friends.</p></div></div>{!options.value && !isPrivate ? <Notice>{options.error || "Checking the shared course listing…"} <a href="/app/rooms">Browse topic rooms</a>.</Notice> : privateCourse ? <Notice>This is your private course. Its title is not published to rooms. <a href="/app/rooms">Browse general topic rooms</a>.</Notice> : <><RoomDirectoryView signed compact offeringId={offeringId}/><a className="account-button-link" href={`/app/rooms?offeringId=${encodeURIComponent(offeringId)}`}>Browse rooms for this course</a></>}</section>;
}
