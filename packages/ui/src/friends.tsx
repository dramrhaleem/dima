'use client';

import { useState, type FormEvent } from 'react';
import type { CircleData, FollowRelationship, SocialSettings } from '@dima/contracts';
import { Avatar } from './avatar';
import { useFocus } from './focus';
import { followTarget } from './profile-link';
import { CommunityStatus, useCommunityResource } from './community-data';

export function Friends({ query }: { query: string }) {
  const { owner } = useFocus();
  const resource = useCommunityResource<CircleData>('/circle', true, true, { mutationReturnsResource: true, preserveOnMutationError: true });
  const sharing = useCommunityResource<SocialSettings>('/sharing', false, true, { mutationReturnsResource: true });
  const [target, setTarget] = useState(() => new URLSearchParams(query).get('invite') ?? '');
  const [targetError, setTargetError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const invitation = `https://dima.study/app/progress/members/${owner}`;
  const canInvite = !!sharing.data?.publicProfile && sharing.data.allowFollow;
  const data = resource.data;
  const mutual = data?.following.filter(row => data.followers.some(follower => follower.profileId === row.profileId)) ?? [];
  const following = data?.following.filter(row => !data.followers.some(follower => follower.profileId === row.profileId)) ?? [];
  const followers = data?.followers.filter(row => !data.following.some(follower => follower.profileId === row.profileId)) ?? [];

  async function copyInvitation() {
    if (!sharing.data || sharing.busy) return;
    setCopyState('idle');
    if (!canInvite && !await sharing.act('/sharing', { type: 'setSharing', publicProfile: true, allowFollow: true, bio: sharing.data.bio, weeklyTime: sharing.data.weeklyTime, courseProgress: sharing.data.courseProgress, expectedRevision: sharing.data.revision })) return;
    try { await navigator.clipboard.writeText(invitation); setCopyState('copied'); }
    catch { setCopyState('manual'); }
  }
  async function follow(event: FormEvent) {
    event.preventDefault(); setNotice('');
    const id = followTarget(target);
    if (!id) { setTargetError('Use a Dima profile link or username.'); return; }
    if (id === owner) { setTargetError('That’s your own link. Send it to a friend, or paste theirs here.'); return; }
    if (data?.following.some(row => row.profileId === id)) { setTargetError('You already follow this person. Open their progress below.'); return; }
    if (data?.outgoing.some(row => row.profileId === id)) { setTargetError('Your request is already waiting for their response.'); return; }
    setTargetError('');
    if (await resource.act('/follow-requests', { type: 'follow', targetId: id, expectedRevision: 0 })) { setTarget(''); setNotice('Request sent. Your friend can accept it in Friends.'); }
  }
  async function respond(row: FollowRelationship, action: 'accept' | 'decline' | 'cancel' | 'revoke', message: string) {
    setNotice('');
    if (await resource.act(action === 'revoke' ? `/relationships/${row.id}/revoke` : `/follow-requests/${row.id}/${action}`, { type: action, relationshipId: row.id, expectedRevision: row.revision })) setNotice(message);
  }
  function person(row: FollowRelationship, kind: 'mutual' | 'following' | 'followers' | 'incoming' | 'outgoing') {
    const requestedBack = data?.outgoing.some(value => value.profileId === row.profileId);
    const reverse = data?.followers.find(value => value.profileId === row.profileId);
    return <article className="friend-row" key={row.id}>
      <Avatar name={row.displayName}/><div className="friend-identity"><a href={`/app/progress/members/${row.profileId}`}>{row.displayName}</a><span>{kind === 'mutual' ? 'You follow each other' : kind === 'following' ? 'You follow their shared progress' : kind === 'followers' ? requestedBack ? 'Your follow-back request is pending' : 'Follows your shared progress' : kind === 'incoming' ? 'Wants to follow you' : 'Waiting for their response'}</span></div>
      <div className="friend-actions">
        {kind === 'incoming' && <><button disabled={resource.busy} onClick={() => void respond(row, 'accept', `${row.displayName} now follows you. Follow back to request their shared progress.`)}>Accept request</button><button className="secondary" disabled={resource.busy} onClick={() => void respond(row, 'decline', 'Request declined.')}>Decline</button></>}
        {kind === 'outgoing' && <button className="secondary" disabled={resource.busy} onClick={() => void respond(row, 'cancel', 'Request cancelled.')}>Cancel request</button>}
        {kind === 'followers' && !requestedBack && row.canRequestFollow === false && <span className="community-caption">Not accepting follow requests</span>}
        {kind === 'followers' && !requestedBack && row.canRequestFollow !== false && <button disabled={resource.busy} onClick={() => { setNotice(''); void resource.act('/follow-requests', { type: 'follow', targetId: row.profileId, expectedRevision: 0 }).then(ok => { if (ok) setNotice('Follow-back request sent. They need to accept it before you appear as friends.'); }); }}>Follow back</button>}
        {['mutual', 'following', 'followers'].includes(kind) && <details className="friend-manage"><summary aria-label={`Manage connection with ${row.displayName}`}>Manage</summary><div><button className="secondary" disabled={resource.busy} onClick={() => void respond(row, 'revoke', kind === 'followers' ? 'Follower removed.' : 'You stopped following this person.')}>{kind === 'followers' ? 'Remove follower' : 'Unfollow'}</button>{kind === 'mutual' && reverse && <button className="secondary" disabled={resource.busy} onClick={() => void respond(reverse, 'revoke', 'Follower removed. You still follow their shared progress.')}>Remove follower</button>}</div></details>}
      </div>
    </article>;
  }
  return <>
    <div className="community-heading"><div><h2>Good company. Steady progress.</h2><p>Exchange links, follow each other, and make time to study together.</p></div><button className="secondary" disabled={resource.loading || resource.busy} onClick={() => void resource.reload()}>{resource.loading ? 'Updating friends…' : 'Refresh friends'}</button></div>
    <section className="community-connect" aria-label="Connect with friends">
      <div className="community-invite"><h3>Your friend link</h3><p>Send this to a friend. They sign in, request to follow you, and you choose whether to accept.</p>
        <label className="friend-link-field">Your personal link<input readOnly value={invitation} onFocus={event => event.currentTarget.select()} spellCheck={false}/></label>
        <CommunityStatus {...sharing} hasData={!!sharing.data}/>
        <button disabled={!sharing.data || sharing.busy || sharing.loading} onClick={() => void copyInvitation()}>{sharing.busy ? 'Enabling requests…' : canInvite ? 'Copy my friend link' : 'Enable requests & copy link'}</button>
        {copyState !== 'idle' && <p role="status" className="friend-copy-status">{copyState === 'copied' ? 'Link copied. Send it to your friend.' : 'Your link is ready. Select the field above and copy it manually.'}</p>}
        {sharing.data && <><p className="community-caption">{canInvite ? 'Requests are on. You approve each follower.' : 'Requests through this link are off. Enabling them makes your name and bio visible to signed-in people. Your progress stays under your existing sharing choices.'}</p><a className="friend-privacy-link" href="/app/progress/sharing">{sharing.data.weeklyTime || sharing.data.courseProgress ? 'Review what friends can see' : 'Progress is private · Choose what to share'}</a></>}
      </div>
      <form className="community-follow-form" onSubmit={event => void follow(event)}><h3>Add someone you know</h3><label>Dima profile link or username<input required value={target} onChange={event => { setTarget(event.target.value); setTargetError(''); setNotice(''); }} placeholder="Paste your friend’s link" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!targetError} aria-describedby={targetError ? 'follow-target-error' : 'follow-explanation'}/></label><p id="follow-explanation" className="community-caption">They’ll receive a request. Following each other lets you both see the progress you choose to share.</p><button disabled={resource.busy || resource.loading || !target.trim()}>Request to follow</button>{targetError && <p id="follow-target-error" role="alert">{targetError}</p>}</form>
    </section>
    {notice && <p role="status" className="friend-notice">{notice}</p>}<CommunityStatus {...resource} hasData={!!data}/>
    {data && <>
      {!!data.incoming.length && <section className="community-section"><h2>Requests for you <span className="community-count">{data.incoming.length}</span></h2><p>Accept to share only the summaries you’ve enabled. Follow back if you want to see theirs.</p>{data.incoming.map(row => person(row, 'incoming'))}</section>}
      <section className="community-section"><div className="community-heading"><h2>Your friends <span className="community-count">{mutual.length}</span></h2><a href="/app/rooms">Study together</a></div>{mutual.length ? mutual.map(row => person(row, 'mutual')) : <p>{following.length || followers.length ? 'Follow each other to appear here together. Your one-way connections are below.' : 'Your study circle starts with one friend. Share your link or paste theirs above.'}</p>}</section>
      {!!followers.length && <section className="community-section"><h2>Following you <span className="community-count">{followers.length}</span></h2>{followers.map(row => person(row, 'followers'))}</section>}
      {!!following.length && <section className="community-section"><h2>People you follow <span className="community-count">{following.length}</span></h2>{following.map(row => person(row, 'following'))}</section>}
      {!!data.outgoing.length && <details className="community-disclosure" open><summary>Requests you sent ({data.outgoing.length})</summary>{data.outgoing.map(row => person(row, 'outgoing'))}</details>}
    </>}
    <nav className="community-next-links" aria-label="Learn together"><a href="/app/progress/leaderboards">Compete on leaderboards</a><a href="/app/progress/milestones">Celebrate milestones</a></nav>
  </>;
}
