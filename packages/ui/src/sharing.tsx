'use client';

import { useState, type FormEvent } from 'react';
import type { SocialSettings } from '@dima/contracts';
import { useFocus } from './focus';
import { ProfileLinkSettings } from './profile-settings';
import { CommunityStatus, useCommunityResource } from './community-data';

export function Sharing() {
  const resource = useCommunityResource<SocialSettings>('/sharing', false, true, { mutationReturnsResource: true });
  return <>
    <div className="community-heading"><div><h2>Your progress. Your audience.</h2><p>New accounts allow follow requests and share progress with accepted followers. You can turn any of these off below.</p></div><a href="/app/progress/circle">Back to Friends</a></div>
    <CommunityStatus {...resource} hasData={!!resource.data}/>
    {resource.data && <SharingForm initial={resource.data} busy={resource.busy} save={value => resource.act('/sharing', { type: 'setSharing', publicProfile: value.publicProfile, bio: value.bio, allowFollow: value.allowFollow, weeklyTime: value.weeklyTime, courseProgress: value.courseProgress, expectedRevision: value.revision })}/>}
    <section className="community-section sharing-other"><h2>Other places you appear</h2><p>These have separate controls. Changing follower settings above won’t change them.</p>
      <dl><div><dt>Leaderboards</dt><dd>Your name and eligible scores appear by default. Hide yourself separately on each board.<a href="/app/progress/leaderboards">Manage leaderboard visibility</a></dd></div>
      <div><dt>Course companions</dt><dd>Your position in a course is optional for each course version. Review it inside the course.<a href="/app/courses">Choose a course</a></dd></div>
      <div><dt>Milestones</dt><dd>Completed public courses stay private until you share a milestone with accepted followers.<a href="/app/progress/milestones">Manage shared milestones</a></dd></div>
      <div><dt>Study rooms</dt><dd>Joining a room shows its members your display name and focus state. Your study plan stays private.<a href="/app/rooms">Open study rooms</a></dd></div></dl>
    </section>
    <details className="community-disclosure"><summary>Optional public page · visible without signing in</summary><p>Your friend link already exists in Friends. A public page is an optional introduction for visitors without an account.</p><ProfileLinkSettings/></details>
    <BlockedPeople/>
    <p className="community-caption">Your email, private course outlines, study plan and detailed session history aren’t shared by these choices.</p>
  </>;
}

function SharingForm({ initial, busy, save }: { initial: SocialSettings; busy: boolean; save: (value: SocialSettings) => Promise<boolean> }) {
  const { owner } = useFocus();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const changedElsewhere = initial.revision !== value.revision;
  const dirty = ['publicProfile', 'bio', 'allowFollow', 'weeklyTime', 'courseProgress'].some(key => value[key as keyof SocialSettings] !== initial[key as keyof SocialSettings]);
  const check = (key: 'publicProfile' | 'allowFollow' | 'weeklyTime' | 'courseProgress', label: string, description: string) => <label className="community-check sharing-choice"><input type="checkbox" aria-label={label} aria-describedby={`sharing-${key}-hint`} checked={value[key]} onChange={event => { setValue({ ...value, [key]: event.target.checked }); setSaved(false); }}/><span><strong>{label}</strong><small id={`sharing-${key}-hint`}>{description}</small></span></label>;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || changedElsewhere || !dirty) return;
    if (await save(value)) { setValue({ ...value, revision: value.revision + 1 }); setSaved(true); }
  }
  return <form className="community-form sharing-form" onSubmit={event => void submit(event)}>
    {changedElsewhere && <div className="community-notice" role="status"><strong>Your saved choices changed elsewhere.</strong><p>Your draft is still here. Load the latest choices before editing again.</p><button type="button" className="secondary" disabled={busy} onClick={() => { setValue(initial); setSaved(false); }}>Use latest sharing choices</button></div>}
    <fieldset disabled={busy || changedElsewhere}><legend>Who can connect with you</legend>
      {check('publicProfile', 'Let signed-in people find my name and bio', 'Makes your shared profile available inside Dima, including through your friend link.')}
      {check('allowFollow', 'Allow people to request to follow me', 'You approve each request. Turning this off stops new requests; it doesn’t remove existing followers.')}
      {value.allowFollow && !value.publicProfile && <p className="sharing-inline-note">Your friend link may be unavailable to new visitors. They can still request to follow you if they find you through another enabled Dima listing.</p>}
      <details className="sharing-bio"><summary>Edit your Dima bio</summary><label>Short bio<textarea maxLength={280} rows={3} value={value.bio} onChange={event => { setValue({ ...value, bio: event.target.value }); setSaved(false); }}/></label></details>
    </fieldset>
    <fieldset disabled={busy || changedElsewhere}><legend>What accepted followers can see</legend>
      {check('weeklyTime', 'Share my weekly time summary with accepted followers', 'A weekly total, without session details.')}
      {check('courseProgress', 'Share my public-course progress with accepted followers', 'Completion progress for public courses. Your private course outlines aren’t included.')}
      <p className="sharing-inline-note">{value.weeklyTime || value.courseProgress ? `After saving, accepted followers can see ${[value.weeklyTime && 'your weekly time', value.courseProgress && 'your public-course progress'].filter(Boolean).join(' and ')}.` : 'With both off, followers see no time or course-progress summaries.'}</p>
    </fieldset>
    <div className="sharing-save"><button disabled={busy || changedElsewhere || !dirty}>{busy ? 'Saving…' : 'Save sharing choices'}</button><span role="status">{saved && !dirty && !changedElsewhere ? 'Sharing choices saved.' : changedElsewhere ? 'Review the latest saved choices.' : dirty ? 'You have unsaved changes.' : 'Your saved choices are shown.'}</span></div>
    <div className="community-actions"><a href={`/app/progress/members/${owner}`}>Open my shared profile</a><a href="/app/progress/circle">Manage followers and your friend link</a></div>
  </form>;
}

function BlockedPeople() {
  const resource = useCommunityResource<{ rows: Array<{ id: string; profileId: string }> }>('/blocks');
  const [notice, setNotice] = useState('');
  return <details className="community-disclosure"><summary>Blocked accounts{resource.data ? ` (${resource.data.rows.length})` : ''}</summary><p>Blocked accounts can’t connect with you here. They may still view a public page while signed out.</p><CommunityStatus {...resource} hasData={!!resource.data}/>{notice && <p role="status">{notice}</p>}{resource.data && (resource.data.rows.length ? resource.data.rows.map((row, index) => <div className="community-row" key={row.id}><span>Blocked account {index + 1}</span><button className="secondary" disabled={resource.busy} onClick={() => void resource.act(`/blocks/${row.id}/revoke`, { type: 'unblock', blockId: row.id, expectedRevision: 0 }).then(ok => { if (ok) setNotice('Account unblocked. Existing sharing choices still apply.'); })}>Unblock account</button></div>) : <p>No blocked accounts.</p>)}</details>;
}
