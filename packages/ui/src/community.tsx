'use client';
import { Friends } from './friends';
import { Sharing } from './sharing';

import { useEffect, useState } from 'react';
import { Avatar } from './avatar';
import { useRankingMotion } from './ranking-motion';
import type { CircleData, ProgressData, RankingSnapshot, SocialNotification, SocialPerson } from '@dima/contracts';
import { FocusArea, useFocus } from './focus';
import { MilestonesSection } from './milestones';
import { RhythmGoalSettings } from './profile-settings';
import { useNavigate } from './navigation';
import { CommunityEmpty, CommunityStatus, shortTime, useCommunityResource } from './community-data';

export function ProgressArea({ section, query }: { section: string; query: string }) {
  const tab = section.split('/')[1] ?? 'overview';
  const community = ['circle', 'milestones', 'sharing', 'members'].includes(tab);
  return <div className={`community-root${tab === 'overview' ? ' community-overview' : ''}`}>
    {!community && <nav className="focus-tabs" aria-label="Progress sections">{[['overview', 'Overview'], ['activity', 'Activity'], ['circle', 'Community'], ['leaderboards', 'Leaderboards']].map(([key, label]) => <a key={key} href={key === 'overview' ? '/app/progress' : `/app/progress/${key}`} aria-current={tab === key || key === 'circle' && community ? 'page' : undefined}>{label}</a>)}</nav>}
    {community && <nav className="community-subnav" aria-label="Community sections">{[['circle','Friends'],['milestones','Milestones'],['sharing','Privacy & sharing']].map(([key,label])=><a key={key} href={`/app/progress/${key}`} aria-current={tab===key||key==='circle'&&tab==='members'?'page':undefined}>{label}</a>)}</nav>}
    {tab === 'activity' ? <FocusArea section={section} query={query}/> : tab === 'circle' ? <Friends key={query} query={query}/> : tab === 'milestones' ? <MilestonesSection/> : tab === 'sharing' ? <Sharing/> : tab === 'leaderboards' ? <Leaderboards query={query}/> : tab === 'members' ? <SharedProfile key={section} id={section.split('/')[2] ?? ''}/> : <ProgressOverview query={query}/>}</div>;
}
function ProgressOverview({ query }: { query: string }) {
  const period = new URLSearchParams(query).get('period') === 'month' ? 'month' : 'week';
  const resource = useCommunityResource<ProgressData>(`/progress?period=${period}`);
  const { data } = resource;
  const emptyPeriod = data && !data.courses.length && !data.time.learningSeconds && !data.time.workSeconds && !data.time.pendingSeconds && !data.rhythm.activeDays;
  const planLabels: Record<string, string> = { 'not-planned': 'No plan yet', fits: 'Fits saved availability', late: 'Forecast after target', provisional: 'Approximate durations', unscheduled: 'Some work is unscheduled', conflict: 'Schedule needs review', paused: 'Plan paused', complete: 'Complete in saved plan' };
  return <><div className="community-heading"><div><h2>Your progress at a glance.</h2><p>See what you’ve completed and the time you’ve recorded.</p></div><nav className="community-period" aria-label="Progress period"><a href="/app/progress?period=week" aria-current={period === 'week' ? 'page' : undefined}>This week</a><a href="/app/progress?period=month" aria-current={period === 'month' ? 'page' : undefined}>This month</a></nav></div><CommunityStatus {...resource} hasData={!!data}/>{data && (emptyPeriod ? <section className="community-empty"><h2>No recorded time this {period} yet.</h2><p>Start a focus session for learning or work. Your saved sessions will appear here; course progress is tracked separately.</p><div className="community-actions"><a className="account-button-link" href="/app/focus">Start a focus session</a><a href="/app/progress/activity">View session history</a></div><p>Want to follow a course too? <a href="/app/library">Find a course</a>.</p></section> : <>
    {data.courses.length > 0 && <section className="community-section"><div className="community-heading"><h2>Your courses</h2><a href="/app/courses">My courses</a></div><p>Progress across your selected required activities. Optional work stays separate.</p><details className="community-breakdown"><summary>About these percentages</summary><p>Activities can count differently depending on their type. Progress includes work completed before joining Dima; it does not measure hours or certify mastery. Open a course to review its saved scope.</p></details>{data.courses.length ? <div className="community-list">{data.courses.map(course => <a className="community-course-row" key={course.enrollmentId} href={`/app/courses/${course.enrollmentId}`}><div><strong>{course.title}</strong><span>{course.completedSteps} of {course.requiredSteps} required activities</span></div><div className="community-coverage"><strong>{course.percentage === null ? course.classificationNeeded ? 'Classification needed' : 'Not applicable' : `${course.percentage}%`}</strong>{course.percentage !== null && <progress aria-label={`${course.title} weighted coverage`} max={100} value={course.percentage}/>}</div></a>)}</div> : null}</section>}
    <div className="community-columns"><section className="community-section"><h2>Time recorded</h2><dl className="community-metrics"><div><dt>Learning</dt><dd>{shortTime(data.time.learningSeconds)}</dd></div><div><dt>Work</dt><dd>{shortTime(data.time.workSeconds)}</dd></div></dl><details className="community-breakdown"><summary>How this time is recorded</summary><dl className="community-metrics"><div><dt>Timer</dt><dd>{shortTime(data.time.timerSeconds)}</dd></div><div><dt>Manual personal time</dt><dd>{shortTime(data.time.manualSeconds)}</dd></div><div><dt>Pending / active</dt><dd>{shortTime(data.time.pendingSeconds)}</dd></div></dl><p className="community-caption">Course completion does not add hours. Pending time is separate from accepted history.</p></details><a href="/app/progress/activity">View activity</a></section><section className="community-section"><h2>Your rhythm</h2><p className="community-rhythm"><strong>{data.rhythm.activeDays}</strong> active {data.rhythm.activeDays === 1 ? 'day' : 'days'}{period === 'week' && data.rhythm.goal !== null && ` · weekly goal ${data.rhythm.goal}`}</p><p>Small days count. Rest belongs here too.</p><details><summary>What counts as an active day?</summary><p>A new learning completion or at least 10 finalized, non-pending recorded minutes. Active days use UTC; weeks run Monday–Sunday. Shorter sessions remain in your activity.</p>{data.rhythm.days.length > 0 && <p>{data.rhythm.days.join(' · ')}</p>}</details><a href="/app/plan">Review my weekly plan</a></section></div>
    {!data.courses.length && <section className="community-course-invite"><div><h2>No courses yet</h2><p>Choose one when you’re ready. Work sessions don’t require a course.</p></div><a className="account-button-link" href="/app/library">Explore the library</a></section>}
    <section className="community-section"><div className="community-heading"><h2>Saved plan status</h2><a href="/app/plan">Review plan</a></div><p>{data.planHealth.outcomes.some(outcome => outcome.forecastDate && outcome.forecastDate > outcome.targetDate) ? 'Forecast after target' : planLabels[data.planHealth.status] ?? 'Review saved plan'}{data.planHealth.missingEstimates>0 && ` · ${data.planHealth.missingEstimates} activities need an estimate`}</p>{data.planHealth.provisionalEstimates>0 && <details className="community-breakdown"><summary>About approximate durations</summary><p>{data.planHealth.provisionalEstimates} activity durations are starting estimates. Update them when you know more; they do not all need correction before you begin.</p></details>}{data.planHealth.outcomes.map(outcome => <div className="community-row" key={outcome.enrollmentId}><a href={`/app/courses/${outcome.enrollmentId}`}>{data.courses.find(course => course.enrollmentId === outcome.enrollmentId)?.title ?? 'Open course'}</a><span>Target {outcome.targetDate} · Forecast {outcome.forecastDate ?? 'not yet known'}</span></div>)}</section><p className="community-caption">Time window: {new Date(data.window.start).toLocaleDateString('en', { timeZone: 'UTC' })}–{new Date(Date.parse(data.window.end) - 1).toLocaleDateString('en', { timeZone: 'UTC' })} · UTC. Course coverage is cumulative; plan status describes your latest saved plan.</p>
  </>)}{data && <details className="community-disclosure"><summary>Set or adjust your weekly goal</summary><RhythmGoalSettings/></details>}</>;
}

function SharedProfile({ id }: { id: string }) {
  const { owner } = useFocus();
  const [message, setMessage] = useState('');
  const circle = useCommunityResource<CircleData>('/circle', true);
  const relationship = circle.data?.following.some(row => row.profileId === id) ? 'Following' : circle.data?.outgoing.some(row => row.profileId === id) || message && circle.loading ? 'Request pending' : circle.data?.incoming.some(row => row.profileId === id) ? 'Respond to request' : null;
  const resource = useCommunityResource<{ profileId: string; displayName: string; bio: string; canRequestFollow?: boolean; weeklyTimeSeconds?: number; courses?: Array<{ scopeId: string; title: string; requiredWeight: number; completedWeight: number }> }>(`/profiles/${encodeURIComponent(id)}/shared`, true);
  const data = resource.data;
  return <><a href="/app/progress/circle">Back to Friends</a>{message && <p role="status">{message}</p>}<CommunityStatus {...resource} hasData={!!data}/>{data && <section className="community-section"><h2>{data.displayName}</h2><p>{data.bio}</p>{data.weeklyTimeSeconds !== undefined && <p>Shared weekly time: <strong>{shortTime(data.weeklyTimeSeconds)}</strong></p>}{data.courses?.map(course => {
    const percent = course.requiredWeight > 0 ? Math.min(100, Math.max(0, Math.round(course.completedWeight / course.requiredWeight * 100))) : null;
    return <div className="community-row" key={course.scopeId}><div><strong>{course.title}</strong><a href={`/app/progress/leaderboards?scope=${encodeURIComponent(course.scopeId)}&period=overall`}>Compare course progress</a></div><div className="community-coverage"><strong>{percent === null ? 'No comparable progress yet' : `${percent}% complete`}</strong>{percent !== null && <progress aria-label={`${course.title} shared course progress`} max={100} value={percent}/>}</div></div>;
  })}{data.weeklyTimeSeconds === undefined && !data.courses?.length && <p>No progress shared with you yet. Each person chooses what accepted followers can see.</p>}{id === owner && <a href="/app/progress/sharing">Edit what friends can see</a>}{id !== owner && <div className="community-actions"><CommunityStatus {...circle} hasData={!!circle.data}/>{relationship ? <a href="/app/progress/circle">{relationship} · Manage in Friends</a> : data.canRequestFollow === false ? <p>Not accepting follow requests</p> : <button disabled={resource.busy || !circle.data || circle.loading} onClick={() => void resource.act('/follow-requests', { type: 'follow', targetId: id, expectedRevision: 0 }).then(saved => { if (saved) { setMessage('Follow request sent. You can manage it in Friends.'); void circle.reload(); } })}>Request to follow</button>}<button className="secondary" disabled={resource.busy} onClick={() => void resource.act('/blocks', { type: 'block', targetId: id, expectedRevision: 0 })}>Block account</button></div>}</section>}</>;
}

export function CoursePeople({ offeringId, isPrivate }: { offeringId: string; isPrivate: boolean }) {
  return isPrivate ? <p className="community-caption">Private course outlines are not listed among public course peers.</p> : <PublicCoursePeople key={offeringId} offeringId={offeringId}/>;
}
function PublicCoursePeople({ offeringId }: { offeringId: string }) {
  const resource = useCommunityResource<{ rows: SocialPerson[]; visible: boolean; revision: number; unavailable?: boolean }>(`/offerings/${encodeURIComponent(offeringId)}/people`, true);
  return <section className="community-root community-section"><div className="community-heading"><div><h2>People learning this course</h2><p>Only people who chose to appear here. Room membership does not opt you in.</p></div><a href={`/app/progress/leaderboards?offering=${encodeURIComponent(offeringId)}`}>Course leaderboard</a></div><CommunityStatus {...resource} hasData={!!resource.data}/>{resource.data && <><p>{resource.data.unavailable && 'This course is no longer publicly available. '}{resource.data.visible ? 'You appear among this course’s peers.' : 'You are not listed among this course’s peers.'}</p><button className="secondary" disabled={resource.busy || resource.data.unavailable && !resource.data.visible} onClick={() => void resource.act('/people/visibility', { type: 'setPeople', offeringId, visible: !resource.data!.visible, expectedRevision: resource.data!.revision })}>{resource.data.visible ? 'Stop appearing here' : 'Show my display name here'}</button><div className="community-list">{resource.data.rows.length ? resource.data.rows.map(person => <a className="community-row" key={person.profileId} href={`/app/progress/members/${person.profileId}`}>{person.displayName}<span>View shared profile</span></a>) : <p>No one has chosen to appear here yet.</p>}</div></>}</section>;
}

function Leaderboards({ query }: { query: string }) {
  const params = new URLSearchParams(query);
  const discovery = useCommunityResource<RankingSnapshot>('/leaderboards/time?period=week&category=all', true);
  const scopes = discovery.data?.scopes ?? [];
  const offering = params.get('offering');
  const scope = params.get('scope') ?? (offering ? scopes.find(value => value.offeringId === offering)?.id ?? '' : '');
  if (offering && !scope) return <><h2>Course leaderboard</h2><CommunityStatus {...discovery} hasData={!!discovery.data}/>{discovery.data && <p>This course has no comparable public scope yet. Your personal progress is still saved.</p>}<a href="/app/progress/leaderboards">View global time leaderboard</a></>;
  return <LeaderboardView key={scope || 'time'} query={query} scope={scope} scopes={scopes}/>;
}
function LeaderboardView({ query, scope, scopes }: { query: string; scope: string; scopes: NonNullable<RankingSnapshot['scopes']> }) {
  const params = new URLSearchParams(query);
  const navigate = useNavigate();
  const period = scope ? params.get('period') === 'week' ? 'week' : 'overall' : params.get('period') === 'month' ? 'month' : 'week';
  const category = ['learning', 'work'].includes(params.get('category') ?? '') ? params.get('category')! : 'all';
  const resource = useCommunityResource<RankingSnapshot & { unavailable?: boolean }>(scope ? `/leaderboards/course/${encodeURIComponent(scope)}?period=${period}` : `/leaderboards/time?period=${period}&category=${category}`, true, true);
  const data = resource.data;
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const { list: rankingListRef, announcement: rankingAnnouncementRef } = useRankingMotion(data, `${scope}:${period}:${category}`, !resource.error && online);
  const { reload, busy, loading, error } = resource;
  useEffect(() => {
    const connected = () => { setOnline(true); if (!document.hidden) void reload(); };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && navigator.onLine && !busy && !loading && !error) void reload(); }, 20000);
    return () => clearInterval(timer);
  }, [reload, busy, loading, error]);
  const course = scopes.find(value => value.id === scope);
  const canParticipate = data?.participation.canParticipate !== false;
  const { owner } = useFocus();
  const ownResult = data?.rows.find(row => row.profileId === owner);
  const ownCourse = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.get('return') ?? '');
  const courseHref = ownCourse ? `/app/courses/${params.get('return')}` : course ? `/app/library/${encodeURIComponent(course.offeringId)}` : '/app/courses';
  const percentage = (score: number) => data?.requiredWeight && data.requiredWeight > 0 ? Math.min(100, Math.max(0, score / data.requiredWeight * 100)) : null;
  const formatPercent = (score: number) => { const value = percentage(score); return value === null ? null : `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)}%`; };
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(query); next.delete('offering');
    if (scope) next.set('scope', scope);
    next.set(key, value); if (key === 'scope') { next.set('period', value ? 'overall' : 'week'); next.delete('return'); }
    navigate(`/app/progress/leaderboards?${next}`);
  };
  return <>
    <header className="community-board-intro">{scope && <a className="community-board-back" href={courseHref}>← {ownCourse ? 'Back to course' : course ? 'Explore this course' : 'My courses'}</a>}<h2>{scope ? course?.title ?? 'Course leaderboard' : 'A little friendly competition.'}</h2><p>{scope ? 'Learn together. See your place and the progress others are making through the same course.' : 'See how your focused time adds up alongside the community.'}</p></header>
    <div className="community-filters">
      <label>Leaderboard<select value={scope} onChange={event => change('scope', event.target.value)}><option value="">Global time</option>{scopes.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>
      <label>Window<select value={period} onChange={event => change('period', event.target.value)}><option value="week">{scope ? 'Progress this week' : 'This week'}</option><option value={scope ? 'overall' : 'month'}>{scope ? 'Overall course progress' : 'This month'}</option></select></label>
      {!scope && <label>Activity<select value={category} onChange={event => change('category', event.target.value)}><option value="all">Learning and work</option><option value="learning">Learning</option><option value="work">Work</option></select></label>}
    </div>
    <div className="community-board-live"><span className={`community-update-dot${error || !online ? ' is-paused' : ''}`} aria-hidden="true"/><span>{!online ? 'Offline · showing the last received results' : error ? 'Updates paused · retry below' : 'Updates every 20 seconds while this page is open'}</span>{scope && ownCourse && <a href={`${courseHref}#course-companions`}>See classmates in the outline</a>}</div>
    <CommunityStatus {...resource} hasData={!!data}/>
    <p ref={rankingAnnouncementRef} className="community-motion-announcement" role="status" aria-live="polite" aria-atomic="true"/>
    {data && <section className="community-section community-board">
      <div className="community-ranking-heading"><div><h3>{scope ? period === 'overall' ? 'Course leaderboard' : 'This week’s progress' : 'Focus time'}</h3><p>{scope ? period === 'overall' ? 'Completed required work across the full course, including previous learning.' : 'New required work completed this week, shown as a share of the full course.' : category === 'learning' ? 'Finalized learning sessions.' : category === 'work' ? 'Finalized work sessions.' : 'Finalized focus sessions for learning and work.'}</p></div>{data.window && <span className="community-caption">{new Date(data.window.start).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – {new Date(Date.parse(data.window.end) - 1).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · UTC</span>}</div>
      <div className="community-board-visibility">
        <div><strong>{data.unavailable ? 'This leaderboard is unavailable' : !canParticipate ? 'Explore this course’s leaderboard' : data.participation.enabled ? 'Leaderboard visibility is on' : 'You’re hidden from this leaderboard'}</strong>
          <p>{data.unavailable ? 'You can still hide any previously shared result.' : !canParticipate ? 'Add this course to take part. Your other leaderboard choices stay separate.' : data.participation.enabled ? 'Your display name and eligible score appear to signed-in members once you have a result.' : 'Your time and progress are still saved. This choice applies to every period on this leaderboard.'}</p>
        </div>
        {(canParticipate || data.participation.enabled) && <button className="secondary" disabled={resource.busy || data.unavailable && !data.participation.enabled} onClick={() => void resource.act('/leaderboards/participation', { type: 'setParticipation', board: scope ? 'course' : 'time', scopeId: scope || null, enabled: !data.participation.enabled, expectedRevision: data.participation.revision })}>{resource.busy ? 'Saving…' : data.participation.enabled ? 'Hide me from this leaderboard' : 'Show me on this leaderboard'}</button>}
        {!canParticipate && !data.unavailable && course && <a href={`/app/library/${encodeURIComponent(course.offeringId)}`}>Explore this course</a>}
      </div>
      {data.rows.length > 0 && <p className="community-your-position" role="status">{!data.participation.enabled ? 'You’re hidden. You can still follow the competition.' : ownResult ? <>Your place: <strong>#{ownResult.rank}</strong> · {scope ? `${formatPercent(ownResult.score) ?? `${ownResult.score} points`} ${period === 'overall' ? 'completed' : 'added this week'}` : shortTime(ownResult.score)}</> : canParticipate ? 'Your name appears when you have a qualifying result in the top 50.' : 'Add this course to join the challenge.'}</p>}
      {data.rows.length ? <ol ref={rankingListRef} className={`community-ranking${scope ? ' is-course-ranking' : ''}`} aria-label={scope ? 'Course rankings' : 'Focus time rankings'}>{data.rows.map(row => {
        const percent = scope ? percentage(row.score) : null;
        return <li className={`${row.profileId === owner ? 'is-you ' : ''}${row.rank <= 3 ? 'is-leading' : ''}`} key={row.profileId} data-profile={row.profileId}>
          <span className="community-rank" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
          <div className="community-competitor"><div className="community-competitor-name"><Avatar name={row.displayName} src={(row as typeof row & { avatarUrl?: string | null }).avatarUrl} size="small"/>{row.profileVisible ? <a href={`/app/progress/members/${row.profileId}`}>{row.displayName}</a> : <span className="community-ranking-name">{row.displayName}</span>}{row.profileId === owner && <span className="community-you-label">You</span>}{row.rank === 1 && <span className="community-leader-label">{data.rows.filter(value => value.rank === 1).length > 1 ? 'Joint lead' : 'Leading'}</span>}</div>{percent !== null && <progress aria-label={`${row.displayName}: ${period === 'overall' ? 'course progress' : 'course progress added this week'}`} value={percent} max={100}/>}</div>
          <div className="community-ranking-score"><span className="community-score-burst" aria-hidden="true"><i/><i/><i/><i/><i/><i/></span><span className="community-score-gain" aria-hidden="true"/><strong>{data.unit === 'seconds' ? shortTime(row.score) : formatPercent(row.score) ?? `${row.score} points`}</strong>{scope && <span>{period === 'overall' ? 'completed' : 'this week'}</span>}</div>
        </li>;
      })}</ol> : <CommunityEmpty title={scope ? period === 'overall' ? 'Start the course challenge.' : 'A fresh week. A fresh start.' : 'The next result could be yours.'}><p>{scope ? 'Complete a required activity in your course outline to join the ranking. Your recorded hours are counted separately.' : 'Finish a focus session to add eligible time. Manual entries stay in your personal record.'}</p><a className="account-button-link" href={scope ? courseHref : '/app/focus'}>{scope ? ownCourse ? 'Continue my course' : course ? 'Explore this course' : 'Open my courses' : 'Set up focus'}</a></CommunityEmpty>}
      <details className="community-breakdown"><summary>How this leaderboard works</summary><p>{scope ? `Everyone is compared against the same course version and required activities (${data.requiredWeight ?? 'unknown'} weighted units). ${period === 'overall' ? 'Overall includes work completed before Dima.' : 'This week counts new completion credit in this UTC week.'}` : 'Only eligible, finalized timer time counts. Pauses, manual entries and pending time are excluded.'} The top 50 positive scores are listed. Equal scores share a rank. {scope && 'Course percentages use this full shared scope, which can differ from your personal selection. '}Your plans, task details and individual sessions stay private.</p></details>
      <div className="community-heading"><small>Updated {new Date(data.calculatedAt).toLocaleString('en')}</small><button className="quiet" disabled={resource.loading} onClick={() => void resource.reload()}>Refresh results</button></div>
    </section>}
  </>;
}

export function Notifications() {
  const resource = useCommunityResource<{ rows: SocialNotification[] }>('/notifications', true);
  const rows = resource.data?.rows ?? [];
  return <div className="community-root"><div className="community-heading"><div><h2>Your updates</h2><p>Opening an update never accepts a request or changes your sharing choices.</p></div>{rows.some(row => !row.readAt) && <button className="secondary" disabled={resource.busy} onClick={() => void resource.act('/notifications/read', { type: 'readNotifications', ids: rows.filter(row => !row.readAt).slice(0, 50).map(row => row.id), expectedRevision: 0 })}>Mark as read</button>}</div><CommunityStatus {...resource} hasData={!!resource.data}/>{resource.data && (rows.length ? <div className="community-list">{rows.map(row => <article className="community-row" key={row.id}><div><strong>{row.available ? row.type === 'follow-request' ? 'A new follow request' : 'A follow request was accepted' : 'This update is no longer available'}</strong><span>{new Date(row.createdAt).toLocaleString('en')}{!row.readAt && ' · Unread'}</span></div>{row.available && <a href="/app/progress/circle">View requests</a>}</article>)}</div> : <CommunityEmpty title="You’re all caught up."><p>New follow requests and responses will appear here.</p></CommunityEmpty>)}</div>;
}
