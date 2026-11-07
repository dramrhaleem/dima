'use client';
import { useRef, useState } from 'react';
import type { Enrollment, LearningData, LearningTask } from '@dima/contracts';
import { effectiveRemaining } from '../../domain/src/recovery';
import type { LearningAction } from './recovery';
type Command = Parameters<LearningAction>[0];

export function QuickCompletion({ data, enrollment, task, busy, act, review }: { data: LearningData; enrollment: Enrollment; task: LearningTask; busy: boolean; act: LearningAction; review: () => void }) {
  const [receipt, setReceipt] = useState<{ eventId: string | null; minutes: number | null } | null>(null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [retrying, setRetrying] = useState(false);
  const pending = useRef<Command | null>(null), flight = useRef(false), attemptedRevision = useRef<number | null>(null);
  const record = enrollment.completions.find(item => item.taskId === task.id);
  const done = record?.completed === true;
  const canUndo = done && receipt !== null && record.workEventId === receipt.eventId;
  const blocked = task.prerequisiteIds.some(id => !enrollment.completions.some(item => item.taskId === id && item.completed));
  async function save() {
    if (busy || flight.current) return;
    if (pending.current?.type === 'undo' && (!receipt || record?.workEventId !== receipt.eventId)) { pending.current = null; setRetrying(false); setError('This completion changed elsewhere. Review the activity before undoing it.'); return; }
    if (pending.current && attemptedRevision.current !== data.state.revision) { pending.current = null; setRetrying(false); setError('Your progress changed. Review this activity, then try again using its updated estimate.'); return; }
    if (!pending.current && done && !canUndo) { review(); return; }
    if (!pending.current && !done && blocked) { setError('Finish the prerequisite activities first. Open Activity details to review them.'); return; }
    if (!pending.current) { attemptedRevision.current = data.state.revision; pending.current = canUndo ? { type: 'undo', enrollmentId: enrollment.id, taskId: task.id } : { type: 'complete', enrollmentId: enrollment.id, taskId: task.id, effortMinutes: effectiveRemaining(data.state, enrollment.id, task.id) }; }
    const command = pending.current;
    flight.current = true; setSaving(true); setError('');
    try {
      const result = await act(command);
      if (!result) { setRetrying(true); setError('Couldn’t confirm the save. Retry, or review the saved-version message.'); return; }
      const saved = result.state.enrollments.find(item => item.id === enrollment.id)?.completions.find(item => item.taskId === task.id);
      setReceipt(command.type === 'complete' && saved?.completed ? { eventId: saved.workEventId ?? null, minutes: command.effortMinutes } : null);
      pending.current = null; setRetrying(false);
    } finally { flight.current = false; setSaving(false); }
  }
  return <div className="quick-completion">
    <button type="button" className="secondary" disabled={busy || saving} onClick={() => void save()}>{saving ? 'Saving…' : retrying ? 'Retry save' : canUndo ? 'Undo' : done ? 'Review completion' : 'Mark activity done'}</button>
    {canUndo && <div className="quick-completion-feedback"><span role="status"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>Completed</span><details><summary>Study estimate · {receipt.minutes === null ? 'unknown' : `${receipt.minutes} min`}</summary><p>{receipt.minutes === null ? 'You can add an estimate in Activity details. Today’s remaining capacity stays unknown until then.' : 'We used the remaining estimate for today’s plan. Earlier work is kept separate.'} No focus time was added.</p><button type="button" className="quiet" disabled={busy} onClick={review}>Review completion</button><a href={`/app/courses/${enrollment.id}/tasks/${task.id}`}>Review study record</a></details></div>}
    {error && <p className="quick-completion-error" role="alert">{error}</p>}
  </div>;
}
