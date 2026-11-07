'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { LearningData, PlanPreview } from '@dima/contracts';
import { effectiveRemaining } from '../../domain/src/recovery';
import { calendarDays, courseDuration } from './planning-time';
import { PLANNER_VERSION } from '@dima/contracts/policy';
import { useNavigate } from './navigation';
import type { LearningAction } from './recovery';

const date = (day: string) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
export const weeklyTime = (minutes: number) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60 ? `${minutes >= 60 ? ' ' : ''}${minutes % 60}m` : minutes === 0 ? '0 min' : ''}`;
export function planEditPath(preview: PlanPreview) { return `/app/plan/${preview.mode === 'initial' ? 'setup' : 'recovery'}?preview=${preview.id}`; }

export function RefreshPlanButton({ preview, data, busy, act, children = 'Refresh this preview', secondary = false }: { preview: PlanPreview; data: LearningData; busy: boolean; act: LearningAction; children?: ReactNode; secondary?: boolean }) {
  const navigate = useNavigate();
  async function refresh() {
    const saved = await act({ type: 'preview', availability: { ...preview.availability, startDate: preview.availability.startDate < data.localDay ? data.localDay : preview.availability.startDate }, targets: Object.fromEntries(data.state.enrollments.map(course => [course.id, preview.targets[course.id] ?? course.targetDate])), controls: preview.controls, mode: data.state.plan ? 'recovery' : 'initial' });
    if (saved?.previewId) navigate(`/app/plan/previews/${saved.previewId}`);
  }
  return <button type="button" className={secondary ? 'secondary' : undefined} disabled={busy} onClick={() => void refresh()}>{busy ? 'Updating the forecast…' : children}</button>;
}

export function PlanOutcomes({ preview, data, saved = false }: { preview: PlanPreview; data: LearningData; saved?: boolean }) {
  const start = preview.availability.startDate > preview.localDay ? preview.availability.startDate : preview.localDay;
  return <div className={`plan-forecasts${saved ? ' is-saved' : ''}`}>{preview.result.outcomes.map(outcome => {
    const course = data.state.enrollments.find(value => value.id === outcome.enrollmentId);
    const paused = outcome.status === 'paused';
    const gap = outcome.forecastDate ? calendarDays(outcome.targetDate, outcome.forecastDate) : null;
    const late = gap !== null && gap > 0;
    const unknown = outcome.unknownEffort || preview.result.unscheduled.some(item => item.enrollmentId === outcome.enrollmentId && (item.minutes === null || item.minutes === 0));
    const old = preview.result.plannerVersion !== PLANNER_VERSION;
    const duration = !old && !paused && outcome.forecastDate ? courseDuration(start, outcome.forecastDate) : null;
    const selected = course?.taskIds ?? [];
    const finished = selected.filter(id => course?.completions.some(item => item.taskId === id && item.completed)).length;
    const left = selected.filter(id => !course?.completions.some(item => item.taskId === id && item.completed));
    const amounts = left.map(id => effectiveRemaining(data.state, outcome.enrollmentId, id));
    const knownMinutes = amounts.reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0);
    const incompleteEstimate = amounts.some(minutes => minutes === null || minutes === 0);
    return <article className="plan-forecast-row" key={outcome.enrollmentId}>
      <div className="plan-course-identity"><h3>{saved && course ? <a href={`/app/courses/${course.id}`}>{course.snapshot.title}<span className="plan-course-link-hint">Open course outline</span></a> : course?.snapshot.title ?? 'Course'}</h3>
        {course && <div className="plan-course-completion"><progress value={finished} max={Math.max(1, selected.length)} aria-label={`${course.snapshot.title}: ${finished} of ${selected.length} activities complete`}/><span>{finished} of {selected.length} activities complete</span></div>}
      </div>
      <div className="plan-course-forecast">
        {duration && <p className="plan-duration"><strong>{duration}</strong><span>{saved ? 'Estimated plan length when saved' : 'From your plan start'} · {date(start)}</span></p>}
        <dl><div><dt>{saved ? 'Estimated finish when saved' : 'Estimated finish at this pace'}</dt><dd>{old ? 'Refresh the forecast' : outcome.status === 'complete' ? 'Already complete' : outcome.forecastDate ? date(outcome.forecastDate) : paused ? 'Paused' : unknown ? 'Estimates needed' : 'Review the schedule'}</dd></div><div><dt>Your target</dt><dd>{date(outcome.targetDate)}</dd></div></dl>
        {!old && <p className={`plan-outcome-note${late ? ' is-later' : ''}`}>{outcome.status === 'complete' ? 'Your completed work stays saved.' : paused ? 'Your work is kept. Choose a resume date when you’re ready.' : !outcome.forecastDate ? unknown ? 'Add the missing estimates to forecast the full course.' : 'Some work needs attention before we can forecast the full course.' : gap === 0 ? 'On your target date.' : late ? `${gap} ${gap === 1 ? 'day' : 'days'} after your target${saved ? ' in the saved forecast' : ' at this pace'}.` : `${Math.abs(gap!)} ${gap === -1 ? 'day' : 'days'} before your target${saved ? ' in the saved forecast' : ' at this pace'}.`}</p>}
        {course && <p className="plan-workload-note">{left.length === 0 ? 'All selected activities are complete.' : `${left.length} ${left.length === 1 ? 'activity' : 'activities'} left · ${incompleteEstimate ? 'At least ' : ''}${weeklyTime(knownMinutes)} of estimated work${saved ? ' remaining now' : ' remaining'}.${incompleteEstimate ? ' Some estimates still need review.' : ''}`}</p>}
      </div>
    </article>;
  })}</div>;
}

type AttentionKind = 'estimate' | 'dependency' | 'capacity';
function attentionKind(item: PlanPreview['result']['unscheduled'][number]): AttentionKind {
  if (item.minutes === null || item.minutes === 0) return 'estimate';
  return /prerequisite|dependency/i.test(item.reason) ? 'dependency' : 'capacity';
}
export function PlanningBacklog({ preview, data }: { preview: PlanPreview; data: LearningData }) {
  const remaining = preview.result.unscheduled.filter(item => !data.state.enrollments.find(course => course.id === item.enrollmentId)?.completions.some(done => done.taskId === item.taskId && done.completed));
  if (!remaining.length) return null;
  if (preview.result.plannerVersion !== PLANNER_VERSION) return <p className="plan-context-note">This saved schedule uses an earlier planner. <a href="/app/plan">Review your plan for an updated forecast</a>.</p>;
  const labels = { estimate: ['Confirm remaining work', 'A few estimates are missing or need review. You can plan the known work while keeping these activities visible.'], dependency: ['Review prerequisites', 'Some activities depend on work that is not yet included or scheduled.'], capacity: ['Adjust your available time', 'Some work still does not fit within the supported forecast. Review study days, pauses and pinned work.'] };
  return <section className="plan-attention" aria-labelledby="plan-attention-title"><h3 id="plan-attention-title">Activities needing attention</h3>{(['estimate', 'dependency', 'capacity'] as const).map(kind => {
    const group = remaining.filter(item => attentionKind(item) === kind);
    if (!group.length) return null;
    return <div className="plan-attention-group" key={kind}><div><h4>{labels[kind][0]} <span>· {group.length}</span></h4><p>{labels[kind][1]}</p></div>{kind === 'capacity' && <a className="learning-link is-secondary" href={planEditPath(preview)}>Adjust study time</a>}<details><summary>View {group.length} {group.length === 1 ? 'activity' : 'activities'}</summary><ul>{group.map(item => {
      const course = data.state.enrollments.find(course => course.id === item.enrollmentId);
      const task = course?.snapshot.courses.flatMap(part => part.modules.flatMap(module => module.tasks)).find(task => task.id === item.taskId);
      const href = `/app/courses/${item.enrollmentId}/tasks/${encodeURIComponent(item.taskId)}${kind === 'estimate' ? `?action=remaining&plan=${preview.id}` : ''}`;
      return <li key={`${item.enrollmentId}:${item.taskId}`}><span><strong>{task?.title ?? 'Activity'}</strong><small>{course?.snapshot.title}{item.minutes !== null ? ` · ${item.minutes} min remaining` : ''}</small></span><a href={href}>{kind === 'estimate' ? 'Review estimate' : 'Open activity'}</a></li>;
    })}</ul></details></div>;
  })}</section>;
}

export function PlanPreviewScreen({ data, preview, busy, act, children, comparison, paused, previousPreview }: { data: LearningData; preview?: PlanPreview; busy: boolean; act: LearningAction; children: ReactNode; comparison?: ReactNode; paused?: ReactNode; previousPreview?: PlanPreview }) {
  const navigate = useNavigate();
  const [acknowledged, setAcknowledged] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);
  if (!preview) return <div className="plan-context-note"><h2>This preview is no longer available.</h2><p>Your saved plan and progress are still here.</p><a href="/app/plan/setup">Create a new preview</a></div>;
  const result = preview.result;
  const stale = result.plannerVersion !== PLANNER_VERSION || preview.baseRevision !== data.state.revision || preview.localDay !== data.localDay || preview.timezone !== data.timezone || Date.parse(preview.expiresAt) <= clock;
  const blocked = !!result.conflicts?.length || result.status === 'conflict';
  const draftOnly = !result.blocks.length && !!result.unscheduled.length;
  const total = preview.availability.weekdayMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const completed = data.state.enrollments.reduce((sum, course) => sum + course.completions.filter(item => item.completed).length, 0);
  const faster = preview.advice?.status === 'adjustable' && preview.advice.suggestedWeekdayMinutes;
  const canApply = !busy && !stale && !blocked && !draftOnly && (!result.unscheduled.length || acknowledged);
  async function apply() { if (!canApply || !preview) return; const saved = await act({ type: 'apply', previewId: preview.id, acknowledgeUnscheduled: acknowledged }); if (saved) navigate('/app/today'); }
  async function previewFaster() {
    if (!preview || !faster || stale || busy) return;
    setChoosing(true);
    const saved = await act({ type: 'preview', availability: { ...preview.availability, weekdayMinutes: faster }, targets: preview.targets, controls: preview.controls, mode: data.state.plan ? 'recovery' : 'initial' });
    setChoosing(false);
    if (saved?.previewId) navigate(`/app/plan/previews/${saved.previewId}?from=${preview.id}`);
  }
  return <div className="plan-review">
    <a className="learning-back" href={planEditPath(preview)}>← Adjust my week</a>
    <ol className="plan-flow-steps" aria-label="Planning steps">{!data.state.plan ? <><li>1. Personalize your course</li><li>2. Review your week</li><li aria-current="step">3. Review your finish</li><li>4. Save and start</li></> : <><li>1. Choose your time</li><li aria-current="step">2. Review your finish</li><li>3. Save and study</li></>}</ol><header className="plan-review-heading"><h2>Review your study plan.</h2><p>See how long each course will take at this pace. Save only when the week feels manageable.</p></header>
    {previousPreview && <div className="plan-alternative-note"><p>This alternative changes your weekly time. Your saved plan has not changed.</p><RefreshPlanButton secondary preview={previousPreview} data={data} busy={busy} act={act}>Preview previous pace</RefreshPlanButton></div>}
    {stale ? <section className="plan-context-note" role="status"><h3>Update this preview before choosing.</h3><p>Your progress or planning rules changed. Refresh with your saved choices to see the current forecast.</p><RefreshPlanButton preview={preview} data={data} busy={busy} act={act}/></section> : <>
      <div className={`plan-options${faster ? ' has-alternative' : ''}`}><section className="plan-current-pace" aria-label="Your proposed pace"><div className="plan-pace-heading"><h3>{previousPreview ? 'The faster plan' : 'With your available time'}</h3><p><strong>{weeklyTime(total)}</strong> per week · {preview.availability.weekdayMinutes.filter(minutes => minutes > 0).length} study days</p></div>
        <PlanOutcomes preview={preview} data={data}/>
        {!!result.conflicts?.length && <div className="plan-conflicts" role="alert"><h4>Resolve these choices first</h4><ul>{result.conflicts.map((conflict, index) => <li key={index}>{conflict.message}{conflict.day && ` (${date(conflict.day)})`}</li>)}</ul><a href={planEditPath(preview)}>Review dates and pinned work</a></div>}
        {preview.advice?.status !== 'adjustable' && preview.advice?.reason && preview.advice.status !== 'on-track' && <p className="plan-advice-note">{preview.advice.reason}</p>}
        <div className="plan-save"><div>{!draftOnly && !!result.unscheduled.length && <label className="learning-choice"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>I understand that {result.unscheduled.length} {result.unscheduled.length === 1 ? 'activity remains' : 'activities remain'} unscheduled. Keep them visible in my plan.</span></label>}<p>{completed > 0 ? `${completed} completed activities stay saved. ` : ''}{draftOnly ? 'Adjust the settings or resolve the activities below before saving a schedule.' : 'Saving makes this your active plan. You can adjust it later.'}</p></div>{draftOnly ? <a className="learning-link" href={planEditPath(preview)}>Adjust my plan</a> : <button disabled={!canApply} onClick={() => void apply()}>{busy && !choosing ? 'Saving your plan…' : blocked ? 'Resolve conflicts before applying' : result.status === 'paused' ? 'Apply pause' : result.unscheduled.length ? 'Apply feasible part' : preview.mode === 'recovery' || preview.mode === 'undo' ? 'Save revised plan' : 'Save this plan'}</button>}</div>
      </section>
      {faster && <section className="plan-faster-pace" aria-label="Faster plan option">
        <h3>To meet your target{result.outcomes.length === 1 ? '' : 's'}</h3>
        <p className="plan-alternative-time"><strong>{weeklyTime(preview.advice!.suggestedWeeklyMinutes!)}</strong> per week</p>
        <p>{weeklyTime(preview.advice!.suggestedWeeklyMinutes! - total)} more per week, on the same study days.</p><p className="plan-daily-comparison">{Math.min(...faster.filter(Boolean)) === Math.max(...faster.filter(Boolean)) ? weeklyTime(faster.find(Boolean)!) : `${weeklyTime(Math.min(...faster.filter(Boolean)))}–${weeklyTime(Math.max(...faster.filter(Boolean)))}`} per study day</p>
        <p className="learning-footnote">Enough time for your current targets, based on the activity estimates.</p>
        <button className="secondary" disabled={busy} onClick={() => void previewFaster()}>{choosing ? 'Building the alternative…' : 'Preview faster plan'}</button>
        <p className="plan-action-hint">Review the new dates before saving. Your active plan stays unchanged.</p>
        <details><summary>Daily time for this option</summary><dl className="plan-proposed-days">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <div key={day}><dt>{day}</dt><dd>{faster[index] ? weeklyTime(faster[index]) : 'Rest'}</dd></div>)}</dl><p className="learning-footnote">Rest days, pinned work and pauses stay unchanged.</p></details>
      </section>}</div>
      <PlanningBacklog preview={preview} data={data}/>
      {draftOnly && <p className="plan-context-note">There is no schedulable work in this preview. Adjust your time or resolve the activities above; your current plan stays in place. <a href="/app/plan">Keep draft and return</a></p>}
      {comparison && <details className="plan-details"><summary>What changes from my current plan?</summary>{comparison}</details>}
      {paused}
      {children}
      <details className="plan-details"><summary>How these estimates work{result.provisionalTasks ? ' · some durations are approximate' : ''}</summary><p>Dates are forecasts based on your selected activities and available time. {result.provisionalTasks > 0 && `${result.provisionalTasks} activity durations are starting estimates. `}{result.missingTasks > 0 && `${result.missingTasks} activities need a remaining-work estimate. `}Record completed or partial work, then review your plan as you learn. Estimates do not add tracked hours.</p></details>
    </>}
  </div>;
}
