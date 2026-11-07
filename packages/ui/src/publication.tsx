'use client';

import { useState, type FormEvent } from 'react';
import type { CatalogAdministrationItem, Draft, LearningData, Offering, PublicationData, PublicationRequest } from '@dima/contracts';
import { CommunityEmpty, CommunityStatus, useCommunityResource } from './community-data';

function OutlinePreview({ offering }: { offering: Pick<Offering, 'courses' | 'title' | 'sourceUrl'> }) {
  return <details className="community-outline"><summary>Review curriculum · {offering.courses.flatMap(course => course.modules.flatMap(module => module.tasks)).length} activities</summary><p><a href={offering.sourceUrl} target="_blank" rel="noopener noreferrer">Open original source</a></p>{offering.courses.map(course => <section key={course.id}><h3>{course.title}</h3>{course.modules.map(module => <div key={module.id}><strong>{module.title}</strong><ol>{module.tasks.map(task => <li key={task.id}>{task.title}<small>{task.kind} · {task.requirement} · {task.minutes === null ? 'Estimate unknown' : `${task.minutes} min estimated`} · {task.estimateSource}</small></li>)}</ol></div>)}</section>)}</details>;
}

const publicationStatus: Record<PublicationRequest['status'], { label: string; detail: string }> = {
  pending: { label: 'Awaiting admin review', detail: 'An admin will review the outline before it appears in the library. You can keep studying your private course.' },
  approved: { label: 'Approved', detail: 'This outline was approved for the library. Your private course and progress stay separate from the public listing.' },
  rejected: { label: 'Changes requested', detail: 'Read the admin response, update your private draft, then send a revised request.' },
  withdrawn: { label: 'Request withdrawn', detail: 'This request will not be reviewed. You can update your draft and submit it again.' },
};

export function Contributions({ query }: { query: string }) {
  const params = new URLSearchParams(query);
  const cursor = params.get('cursor'), focusedDraft = params.get('draft');
  const filters = new URLSearchParams();
  if (cursor) filters.set('cursor', cursor);
  if (focusedDraft) filters.set('draft', focusedDraft);
  const resource = useCommunityResource<PublicationData>(`/publication-requests${filters.size ? `?${filters}` : ''}`);
  const [form, setForm] = useState<{ draft: string | null; open: boolean } | null>(null);
  const setCreating = (open: boolean) => setForm({ draft: focusedDraft, open });
  const [sentFor, setSentFor] = useState<{ draft: string | null } | null>(null);
  const setSent = (value: boolean) => setSentFor(value ? { draft: focusedDraft } : null);
  const sent = sentFor !== null && sentFor.draft === focusedDraft;
  const pending = focusedDraft && resource.data?.requests.some(request => request.status === 'pending');
  const latest = resource.data?.requests.reduce<PublicationRequest | undefined>((newest, request) => !newest || request.createdAt > newest.createdAt ? request : newest, undefined);
  const creating = form !== null && form.draft === focusedDraft ? form.open : !!focusedDraft && latest?.status !== 'approved';
  const showForm = creating && !pending && (!focusedDraft || !!resource.data);
  const nextPage = new URLSearchParams(focusedDraft ? { draft: focusedDraft } : {});
  if (resource.data?.nextCursor) nextPage.set('cursor', resource.data.nextCursor);
  return <div className="community-root">
    <div className="community-heading"><div><h2>Share a course with the library.</h2><p>Create privately, request an admin review, then let others study the approved outline. Your progress, plan and notes stay private.</p></div>{!pending && <button className="secondary" onClick={() => { setCreating(!creating); setSent(false); }}>{showForm ? 'Close request form' : 'Request publication'}</button>}</div>
    {focusedDraft && <div className="community-actions"><a href={`/app/courses/new?draft=${encodeURIComponent(focusedDraft)}`}>Edit private course</a><a href="/app/contributions">All my requests</a></div>}
    {sent && <div className="community-notice" role="status"><strong>Request sent to the admin.</strong><p>You can follow its status here. Your course stays private until approval.</p></div>}
    {showForm && <Submission key={focusedDraft ?? 'choose'} initialDraft={focusedDraft ?? ''} onSaved={() => { setCreating(false); setSent(true); void resource.reload(); }}/>}<CommunityStatus {...resource} hasData={!!resource.data}/>
    {resource.data && <>{resource.data.canReview && <a href="/app/admin">Open admin review queue</a>}{resource.data.requests.length ? <div className="community-list">{resource.data.requests.map(request => <article className="community-section" key={request.id}>
      <div className="community-heading"><div><h3>{request.snapshot.title}</h3><p>{request.snapshot.provider} · {request.snapshot.language}</p></div><span className={`community-badge is-${request.status}`}>{publicationStatus[request.status].label}</span></div>
      <p>{publicationStatus[request.status].detail}</p><p className="community-caption">Submitted {new Date(request.createdAt).toLocaleDateString('en')} · The outline as it was when you submitted it</p>
      {request.decisionReason && <div className="community-notice"><strong>Admin response</strong><p>{request.decisionReason}</p></div>}
      <OutlinePreview offering={request.snapshot}/><div className="community-actions">
        {request.status === 'pending' && <button className="secondary" disabled={resource.busy} onClick={() => void resource.act('/publication-requests', { type: 'withdraw', requestId: request.id, expectedRevision: request.revision })}>Withdraw request</button>}
        <a href={`/app/courses/new?draft=${encodeURIComponent(request.draftId)}`}>Edit private course</a>
        {(request.status === 'rejected' || request.status === 'withdrawn') && (!focusedDraft || request.id === latest?.id) && <a href={`/app/contributions?draft=${encodeURIComponent(request.draftId)}`} onClick={() => { setCreating(true); setSent(false); }}>Prepare revised request</a>}
        {request.status === 'approved' && <a href={`/app/library/${request.offeringId}`}>View library listing</a>}
      </div>{request.status === 'pending' && <p className="community-caption">Need to change this request? Withdraw it, save your draft changes, then submit again.</p>}
    </article>)}</div> : !showForm && <CommunityEmpty title="No publication requests yet."><p>Create a course for yourself, then request publication when its outline is ready.</p><a href="/app/courses/new">Create my own course</a></CommunityEmpty>}
    <div className="community-actions">{cursor && <a href={focusedDraft ? `/app/contributions?draft=${encodeURIComponent(focusedDraft)}` : '/app/contributions'}>Most recent requests</a>}{resource.data.nextCursor && <a href={`/app/contributions?${nextPage}`}>Older requests</a>}</div></>}
  </div>;
}

function Submission({ initialDraft, onSaved }: { initialDraft: string; onSaved: () => void }) {
  const resource = useCommunityResource<LearningData>('/learning');
  const [draftId, setDraftId] = useState(initialDraft);
  const draft = resource.data?.state.drafts.find(value => value.id === draftId);
  return <section className="community-section"><h2>Request library publication</h2><CommunityStatus {...resource} hasData={!!resource.data}/>{resource.data && <>{resource.data.state.drafts.length ? <><label>Saved private course<select value={draftId} onChange={event => setDraftId(event.target.value)}><option value="">Choose a saved course</option>{resource.data.state.drafts.map(value => <option value={value.id} key={value.id}>{value.title}</option>)}</select></label>{initialDraft && !draft && <p role="status">This saved course is unavailable. Choose another course or return to My Courses.</p>}{draft && <DraftSubmission key={draft.id} draft={draft} busy={resource.busy} submit={fields => resource.act('/publication-requests', { type: 'submit', draftId: draft.id, expectedRevision: resource.data!.state.revision, rightsAttested: true, ...fields }).then(saved => { if (saved) onSaved(); return saved; })}/>}</> : <p>No saved private courses yet. <a href="/app/courses/new">Create one first</a>.</p>}</>}</section>;
}
function DraftSubmission({ draft, busy, submit }: { draft: Draft; busy: boolean; submit: (value: SubmissionFields) => Promise<boolean> }) {
  const history = useCommunityResource<PublicationData>(`/publication-requests?draft=${encodeURIComponent(draft.id)}`);
  const latest = history.data?.requests.reduce<PublicationRequest | undefined>((newest, request) => !newest || request.createdAt > newest.createdAt ? request : newest, undefined);
  return <><CommunityStatus {...history} hasData={!!history.data}/>{history.data && (history.data.requests.some(request => request.status === 'pending') ? <div className="community-notice"><strong>This course is already awaiting admin review.</strong><p>Open the existing request to follow its status or withdraw it before sending changes.</p><a href={`/app/contributions?draft=${encodeURIComponent(draft.id)}`}>View existing request</a></div> : <SubmissionForm key={`${draft.id}-${latest?.id ?? 'new'}`} draft={draft} previous={latest} busy={busy} submit={submit}/>)}</>;
}
type SubmissionFields = { provider: string; summary: string; language: string; scopeLabel: string; orderPolicy: string; sourceNotes: string };
function SubmissionForm({ draft, previous, busy, submit }: { draft: Draft; previous?: PublicationRequest; busy: boolean; submit: (value: SubmissionFields) => Promise<boolean> }) {
  const [fields, setFields] = useState<SubmissionFields>(() => previous ? { provider: previous.snapshot.provider, summary: previous.snapshot.summary, language: previous.snapshot.language, scopeLabel: previous.snapshot.scopeLabel, orderPolicy: previous.snapshot.orderPolicy, sourceNotes: previous.sourceNotes } : { provider: '', summary: '', language: 'English', scopeLabel: 'All activities in this outline.', orderPolicy: 'Follow the activities in their listed order.', sourceNotes: '' });
  const [rights, setRights] = useState(false);
  const input = (key: keyof SubmissionFields, label: string, maximum: number, multiline = false) => <label>{label}{multiline ? <textarea required minLength={key === 'sourceNotes' ? 5 : 1} maxLength={maximum} rows={3} value={fields[key]} onChange={event => setFields({ ...fields, [key]: event.target.value })}/> : <input required maxLength={maximum} value={fields[key]} onChange={event => setFields({ ...fields, [key]: event.target.value })}/>}</label>;
  async function save(event: FormEvent) { event.preventDefault(); if (rights) await submit(fields); }
  return <form className="community-form" onSubmit={event => void save(event)}><fieldset disabled={busy}><legend>What others will see</legend><h3>{draft.title}</h3><p>The latest saved outline will be sent for review. Save any changes in the course editor first.</p>{previous?.decisionReason && <div className="community-notice"><strong>Previous admin response</strong><p>{previous.decisionReason}</p></div>}<OutlinePreview offering={draft}/>{input('provider', 'Original provider or author', 120)}{input('language', 'Course language', 60)}{input('summary', 'What this course covers', 2000, true)}{input('scopeLabel', 'What is included or left out', 1000, true)}{input('orderPolicy', 'Study order and prerequisites', 2000, true)}{input('sourceNotes', 'Sources and permission to share', 2000, true)}<label className="community-check"><input required type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)}/>I have the right to share this outline and have checked its original sources. It does not include protected course content or someone else’s private information.</label><p className="community-caption">Only the outline and these details go to the admin. Approval makes the reviewed outline available in the library; your progress and study plan remain private.</p><button disabled={!rights}>{busy ? 'Sending request…' : 'Send to admin for review'}</button></fieldset></form>;
}

export function Administration({ query }: { query: string }) {
  const catalog = new URLSearchParams(query).get('view') === 'catalog';
  return <div className="community-root"><nav className="focus-tabs" aria-label="Administration"><a href="/app/admin" aria-current={!catalog ? 'page' : undefined}>Review queue</a><a href="/app/admin?view=catalog" aria-current={catalog ? 'page' : undefined}>Published catalog</a></nav>{catalog ? <CatalogAdministration query={query}/> : <ReviewQueue query={query}/>}</div>;
}
function ReviewQueue({ query }: { query: string }) {
  const cursor = new URLSearchParams(query).get('cursor');
  const resource = useCommunityResource<PublicationData>(`/admin/reviews?status=pending${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h2>Courses awaiting your review</h2><p>Only the submitted curriculum is shown. Learner progress and private plans are not part of a review.</p><CommunityStatus {...resource} hasData={!!resource.data}/>{resource.data && <>{resource.data.requests.length ? resource.data.requests.map(request => <ReviewRequest key={request.id} request={request} busy={resource.busy} decide={(decision, reason) => resource.act('/admin/reviews', { type: 'review', requestId: request.id, decision, reason, expectedRevision: request.revision }).then(saved => { if (saved) window.dispatchEvent(new Event('dima-catalog-changed')); return saved; })}/>) : <CommunityEmpty title="Nothing awaiting review."><p>New curriculum submissions will appear here.</p></CommunityEmpty>}<div className="community-actions">{cursor && <a href="/app/admin">Newest requests</a>}{resource.data.nextCursor && <a href={`/app/admin?cursor=${encodeURIComponent(resource.data.nextCursor)}`}>Older requests</a>}</div></>}</>;
}
function ReviewRequest({ request, busy, decide }: { request: PublicationRequest; busy: boolean; decide: (decision: 'approve' | 'reject', reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  return <article className="community-section"><h3>{request.snapshot.title}</h3><p>{request.snapshot.provider} · {request.snapshot.language} · {request.status}</p><p>{request.snapshot.summary}</p><p>{request.snapshot.scopeLabel}</p><p>{request.snapshot.orderPolicy}</p><div className="community-notice"><strong>Contributor’s source and rights notes</strong><p>{request.sourceNotes}</p></div><OutlinePreview offering={request.snapshot}/>{request.status === 'pending' && <div className="community-form"><label>Decision reason<textarea minLength={5} maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)}/></label><p>Approval publishes this exact curriculum snapshot. Explain source checks or the changes needed.</p><div className="community-actions"><button disabled={busy || reason.trim().length < 5} onClick={() => void decide('approve', reason)}>Approve and publish</button><button className="secondary" disabled={busy || reason.trim().length < 5} onClick={() => void decide('reject', reason)}>Request changes</button></div></div>}</article>;
}
function CatalogAdministration({ query }: { query: string }) {
  const cursor = new URLSearchParams(query).get('cursor');
  const resource = useCommunityResource<{ offerings: CatalogAdministrationItem[]; nextCursor: string | null }>(`/admin/catalog${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return <><h2>Catalog availability</h2><p>Withdrawing a listing removes public availability. Existing learners retain their saved curriculum and progress.</p><CommunityStatus {...resource} hasData={!!resource.data}/>{resource.data && <>{resource.data.offerings.map(offering => <CatalogEntry key={offering.id} offering={offering} busy={resource.busy} save={reason => resource.act('/admin/catalog', { type: 'setPublication', offeringId: offering.id, published: offering.status !== 'published', reason, expectedRevision: offering.revision }).then(saved => { if (saved) window.dispatchEvent(new Event('dima-catalog-changed')); return saved; })}/>)}{!resource.data.offerings.length && <CommunityEmpty title="No contributed listings here yet."/>}<div className="community-actions">{cursor && <a href="/app/admin?view=catalog">Newest listings</a>}{resource.data.nextCursor && <a href={`/app/admin?view=catalog&cursor=${encodeURIComponent(resource.data.nextCursor)}`}>Older listings</a>}</div></>}</>;
}
function CatalogEntry({ offering, busy, save }: { offering: CatalogAdministrationItem; busy: boolean; save: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  return <details className="community-section"><summary>{offering.title} · {offering.status}</summary><p>{offering.provider} · Version {offering.version}</p><label>Reason for changing availability<textarea rows={2} minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}/></label><button className="secondary" disabled={busy || reason.trim().length < 5} onClick={() => void save(reason)}>{offering.status === 'published' ? 'Withdraw public listing' : 'Publish reviewed listing'}</button></details>;
}
