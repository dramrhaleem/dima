'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AccountProfile as Profile, AccountData as Account } from '@dima/contracts';
import { Avatar } from './avatar';
import { AppearanceToggle, BrandLogo } from './appearance';
import { ProfilePhoto } from './profile-photo';
import { LearningArea, LearningSessionProvider } from './learning';
import { RoomsProvider, RoomSessionStrip, useRooms } from './rooms-provider';
import { RoomsArea } from './rooms';
import { ProgressArea, Notifications } from './community';
import { Contributions, Administration } from './publication';
import { AccountOperations } from './account-operations';
import { FocusArea, FocusProvider, FocusSignOut } from './focus';
import { onboardingEntry } from './onboarding-entry';

type User = { id: string; email?: string };
type Session = { user: User | null; providers: { email: boolean; google: boolean } };
type Loaded = { session: Session; account: Account | null };
class AccountError extends Error { constructor(public code: string, public status: number) { super(code); } }

async function api<T>(path: string, method = 'GET', body?: unknown, owner?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(owner ? { 'X-Dima-Account-Id': owner } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new AccountError(payload?.error?.code ?? 'REQUEST_FAILED', response.status);
  return payload.data as T;
}
function destination(value = '/app/today') {
  try { const decoded = decodeURIComponent(value); if ((decoded.includes('\\') || [...decoded].some(char => char.charCodeAt(0) < 32)) || !decoded.startsWith('/') || decoded.startsWith('//')) return '/app/today'; const url = new URL(value, 'https://dima.invalid'); return url.origin === 'https://dima.invalid' && /^\/(?:app(?:\/|$)|library(?:\/|$)|rooms(?:\/|$))/.test(url.pathname) ? url.pathname + url.search + url.hash : '/app/today'; } catch { return '/app/today'; }
}
let volatileSignOutPending = false;
function signOutBarrier(value?: boolean) {
  if (value !== undefined) volatileSignOutPending = value;
  try {
    if (value === true) localStorage.setItem('dima-signout-pending', '1');
    if (value === false) localStorage.removeItem('dima-signout-pending');
    return volatileSignOutPending || localStorage.getItem('dima-signout-pending') === '1';
  } catch { return volatileSignOutPending; }
}
function notifySignOut() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('dima-account'); channel.postMessage('signout-pending'); channel.close(); } }
function notifyAccount() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('dima-account'); channel.postMessage('changed'); channel.close(); } }
function explain(error: unknown) {
  if (!(error instanceof AccountError)) return 'Couldn’t connect. Your changes are still here. Check your connection and try again.';
  if (error.status === 429) return 'A little too soon. Wait a moment before trying again.';
  if (error.code === 'CODE_SEND_FAILED') return 'We couldn’t send your sign-in code. Please try again shortly.';
  if (error.status === 401 || /OTP|CODE|VERIFY/.test(error.code)) return 'That code is invalid or has expired. Check it or request a new one.';
  if (error.status === 422) return 'Check the highlighted details and try again.';
  if (error.status === 503) return 'This service is temporarily unavailable. Please try again shortly.';
  return 'We couldn’t finish that request. Your changes are still here; please try again.';
}
const iconPaths: Record<string, ReactNode> = {
  today: <><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/></>,
  plan: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h2"/></>,
  courses: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/></>,
  focus: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m3 3 2-2"/></>,
  progress: <><path d="M4 20V4m0 16h17M8 15l4-5 4 2 5-7"/></>,
  library: <><path d="M3 4h4v16H3zM10 4h4v16h-4zm7 1 3-1 3 15-3 1z"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .3c0 1.7-2.5 1.9-2.5 3.7m0 3h.01"/></>,
  contributions: <><path d="M5 3h10l4 4v14H5zM14 3v5h5M9 14h6m-3-3v6"/></>,
  admin: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8 12l3 3 5-6"/></>,
  rooms: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></>,
  notifications: <><path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3zM10 21h4"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
};
function Icon({ name }: { name: string }) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name === 'progress/circle' ? 'rooms' : name] ?? iconPaths.arrow}</svg>; }
function Brand() { return <a className="account-brand" href="/" aria-label="Dima home"><BrandLogo/></a>; }
function Status({ children, error = false }: { children: ReactNode; error?: boolean }) { return <p className={`account-status${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>; }
function goToSignIn(next: string) { window.location.assign(`/auth?next=${encodeURIComponent(destination(next))}`); }

type RefreshOptions = { background?: boolean; force?: boolean };
export function AccountApp({ mode, next = '/app/today', section = 'today' }: { mode: 'auth' | 'onboarding' | 'workspace'; next?: string; section?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const sequence = useRef(0);
  const activeOwner = useRef<string | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const flight = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const lastPassiveAttempt = useRef(0);
  const refreshRef = useRef<(options?: RefreshOptions) => Promise<void>>(async () => {});
  const nextPath = destination(next);
  const currentPath = useRef(nextPath);
  useEffect(() => { currentPath.current = nextPath; }, [nextPath]);

  const invalidate = useCallback(() => { sequence.current++; flight.current = null; }, []);
  const clearOwnedView = useCallback(() => {
    invalidate(); activeOwner.current = null; loadedRef.current = null;
    setLoaded(null); setLocked(true); setRefreshError('');
  }, [invalidate]);
  const finishSignOut = useCallback(async () => {
    signOutBarrier(true); clearOwnedView(); setSignOutPending(true); setSignOutBusy(true); setSignOutError(''); notifySignOut();
    try {
      await api('/auth/logout', 'POST', {});
      signOutBarrier(false); notifyAccount(); window.location.assign('/auth');
    } catch { setSignOutError('Your private view is locked, but sign-out hasn’t finished. Keep this page open and retry when connected. Your server session may still be active.'); }
    finally { setSignOutBusy(false); }
  }, [clearOwnedView]);

  const load = useCallback((options: RefreshOptions = {}): Promise<void> => {
    if (signOutBarrier()) { clearOwnedView(); setSignOutPending(true); return Promise.resolve(); }
    if (flight.current) return flight.current.promise;
    if (options.background && !options.force && Date.now() - lastPassiveAttempt.current < 1500) return Promise.resolve();
    const snapshot = loadedRef.current;
    const expectedOwner = activeOwner.current;
    const keepView = !!snapshot && options.background;
    const generation = ++sequence.current;
    if (options.background && !options.force) lastPassiveAttempt.current = Date.now();
    if (!keepView) setLocked(true);
    setError(''); setRefreshError(''); setSignOutPending(false);
    const promise = (async () => {
      try {
        let session: Session;
        let account: Account | null;
        if (keepView && expectedOwner && mode !== 'auth') {
          // /me verifies the cookie with Auth before returning an owner-bound result.
          // The existing same-owner user/email can be retained without a second session call.
          account = await api<Account>('/me', 'GET', undefined, expectedOwner);
          if (generation !== sequence.current) return;
          if (account.accountId !== expectedOwner) {
            clearOwnedView();
            await refreshRef.current({ force: true });
            return;
          }
          session = snapshot.session;
        } else if (mode === 'auth') {
          session = await api<Session>('/auth/session');
          account = session.user ? await api<Account>('/me') : null;
        } else {
          [session, account] = await Promise.all([api<Session>('/auth/session'), api<Account>('/me')]);
        }
        if (generation !== sequence.current || signOutBarrier()) return;
        if (session.user && account?.accountId !== session.user.id) throw new AccountError('ACCOUNT_CHANGED', 409);
        const previous = loadedRef.current;
        if (account && previous?.account?.accountId === account.accountId && previous.account.profile && (!account.profile || previous.account.profile.revision > account.profile.revision)) {
          account = { ...account, profile: previous.account.profile };
        }
        if (!session.user && mode !== 'auth') { clearOwnedView(); goToSignIn(currentPath.current); return; }
        if (session.user && mode === 'auth') { window.location.replace(account?.profile?.onboarded ? currentPath.current : `/onboarding?next=${encodeURIComponent(currentPath.current)}`); return; }
        if (session.user && mode === 'workspace' && !account?.profile?.onboarded) { window.location.replace(`/onboarding?next=${encodeURIComponent(currentPath.current)}`); return; }
        if (session.user && mode === 'onboarding' && account?.profile?.onboarded) { window.location.replace(currentPath.current); return; }
        const result = { session, account };
        activeOwner.current = session.user?.id ?? null; loadedRef.current = result;
        setLoaded(result); setLocked(false);
      } catch (reason) {
        if (generation !== sequence.current) return;
        if (reason instanceof AccountError && reason.status === 401 && mode !== 'auth') { clearOwnedView(); goToSignIn(currentPath.current); return; }
        if (reason instanceof AccountError && reason.code === 'ACCOUNT_CHANGED') { clearOwnedView(); setError('Your account changed. Reconnect to open the current account.'); return; }
        if (keepView && loadedRef.current === snapshot && activeOwner.current === expectedOwner) setRefreshError('We couldn’t check for updates. Your current view and changes are still here.');
        else if (keepView && loadedRef.current?.session.user?.id === expectedOwner) setRefreshError('We couldn’t check for updates. Your current view and changes are still here.');
        else setError('We couldn’t load your account. Check your connection and try again.');
      } finally {
        if (flight.current?.generation === generation) flight.current = null;
      }
    })();
    flight.current = { generation, promise };
    return promise;
  }, [mode, clearOwnedView]);

  useEffect(() => { refreshRef.current = load; }, [load]);
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => { if (live) return load({ force: true }); });
    const refresh = () => { void load({ background: true }); };
    const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const changed = (pending: boolean) => {
      signOutBarrier(pending); clearOwnedView(); setSignOutPending(pending);
      if (!pending) void load({ force: true });
    };
    const storage = (event: StorageEvent) => { if (event.key === 'dima-signout-pending') changed(event.newValue === '1'); };
    window.addEventListener('focus', refresh); window.addEventListener('pageshow', pageShow); document.addEventListener('visibilitychange', visibility);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('dima-account');
    if (channel) channel.onmessage = event => { if (event.data === 'signout-pending') changed(true); else if (event.data === 'changed') changed(false); };
    window.addEventListener('storage', storage);
    return () => { live = false; invalidate(); window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', pageShow); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage); channel?.close(); };
  }, [load, clearOwnedView, invalidate]);
  useEffect(() => {
    const retry = () => { if (signOutPending) void finishSignOut(); else void load({ background: true, force: true }); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [signOutPending, finishSignOut, load]);
  const reducedMotion = loaded?.account?.profile?.reducedMotion ?? false;
  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'standard';
    return () => { delete document.documentElement.dataset.motion; };
  }, [reducedMotion]);
  const update = useCallback((saved: Profile, owner: string) => {
    const previous = loadedRef.current;
    if (activeOwner.current !== owner || previous?.session.user?.id !== owner || previous.account?.accountId !== owner || (previous.account.profile?.revision ?? 0) > saved.revision) return false;
    const result = { ...previous, account: { ...previous.account, profile: saved } };
    loadedRef.current = result; setLoaded(result);
    return true;
  }, []);
  const changed = useCallback((owner?: string) => {
    if (owner && activeOwner.current !== owner) return;
    clearOwnedView(); notifyAccount(); void load({ force: true });
  }, [clearOwnedView, load]);
  return <div className="account-root">
    <a className="skip-link" href="#account-main">Skip to main content</a>
    {signOutPending && <main id="account-main" className="account-loading"><Brand/><div className="account-loading-body"><Icon name="lock"/><h1>Your private view is locked.</h1><Status error={!!signOutError}>{signOutBusy ? 'Finishing sign-out…' : signOutError || 'Finish signing out before opening another account.'}</Status><button disabled={signOutBusy} onClick={() => void finishSignOut()}>{signOutBusy ? 'Signing out…' : 'Retry sign-out'}</button><a className="account-text-link" href="/">Back to home</a></div></main>}
    {locked && !signOutPending && <div className="account-loading" id="account-main" aria-busy={!error}><Brand/><div className="account-loading-body">{error ? <><h1>Let’s reconnect.</h1><Status error>{error}</Status><button onClick={() => void load({ force: true })}>Try again</button><a className="account-text-link" href="/">Back to home</a></> : <><span className="account-loading-mark" aria-hidden="true"/><p role="status">Opening your space…</p></>}</div></div>}
    <div hidden={locked}>
      {refreshError && <div className="account-refresh-note" role="status"><span>{refreshError}</span><button className="account-link-button" onClick={() => void load({ background: true, force: true })}>Retry update</button></div>}
      {loaded && (mode === 'auth' ? <SignIn providers={loaded.session.providers} next={nextPath}/> : loaded.session.user && loaded.account ? mode === 'onboarding' ? <Onboarding key={loaded.session.user.id} user={loaded.session.user} profile={loaded.account.profile} next={nextPath} onUpdate={update} onChanged={changed}/> : <Workspace key={loaded.session.user.id} section={section} query={new URL(nextPath, "https://dima.invalid").search} user={loaded.session.user} profile={loaded.account.profile!} role={loaded.account.role} onUpdate={update} onChanged={changed} onSignOut={finishSignOut}/> : null)}
    </div>
  </div>;
}

function SignIn({ providers, next }: { providers: Session['providers']; next: string }) {
  const [email, setEmail] = useState(''); const [token, setToken] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('error') ? 'Sign-in wasn’t completed. You can try again or use an email code.' : ''); const [failed, setFailed] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('error')); const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (sent) document.getElementById('signin-code')?.focus(); }, [sent]);
  useEffect(() => { if (!cooldown) return; const timeout = setTimeout(() => setCooldown(n => Math.max(0, n - 1)), 1000); return () => clearTimeout(timeout); }, [cooldown]);
  async function send() { setBusy(true); setFailed(false); setMessage(''); try { await api('/auth/otp', 'POST', { email: email.trim(), next }); setSent(true); setToken(''); setCooldown(60); setMessage('Code requested. Check your inbox, including spam.'); } catch (error) { setFailed(true); setMessage(explain(error)); } finally { setBusy(false); } }
  async function submit(event: FormEvent) { event.preventDefault(); if (!sent) { await send(); return; } setBusy(true); setFailed(false); setMessage(''); try { const data = await api<{ next: string }>('/auth/verify', 'POST', { email: email.trim(), token: token.trim(), next }); notifyAccount(); window.location.assign(destination(data.next)); } catch (error) { setFailed(true); setMessage(explain(error)); setBusy(false); } }
  async function google() { setBusy(true); setFailed(false); try { const data = await api<{ url: string }>('/auth/google', 'POST', { next }); const url = new URL(data.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid provider URL'); window.location.assign(url.href); } catch (error) { setFailed(true); setMessage(explain(error)); setBusy(false); } }
  return <div className="auth-page"><header className="account-public-header"><Brand/><AppearanceToggle/><a href="/" className="account-text-link">Back to home <Icon name="arrow"/></a></header><main id="account-main" className="auth-layout">
    <section className="auth-story"><span className="account-eyebrow">A little, often.</span><h1>Your next step <br/>starts here.</h1><p>A space for learning, focused work, and finding your rhythm again.</p><div className="account-path" aria-hidden="true"><i/><i/><i/><i/><i/></div><div className="auth-reassurance"><Icon name="lock"/><p>Your plans stay private. Sharing is a choice you make.</p></div></section>
    <section className="auth-card" aria-labelledby="signin-title"><span className="account-step">Your space, on any device</span><h2 id="signin-title">{sent ? 'Check your email' : 'Welcome to Dima'}</h2><p>{sent ? <>Enter the code sent to <strong className="account-email">{email}</strong>.</> : 'Sign in or create an account. No password to remember.'}</p>
      {!sent && <><button className="account-google" disabled={busy || !providers.google} onClick={() => void google()} aria-describedby={!providers.google ? 'google-unavailable' : undefined}><span aria-hidden="true" className="google-g">G</span>Continue with Google</button>{!providers.google && <p id="google-unavailable" className="account-caption">Google sign-in is currently unavailable.{providers.email ? ' Use email below.' : ''}</p>}<div className="account-divider"><span>or use your email</span></div></>}
      {!providers.email && <p className="account-caption" role="status">Email sign-in is temporarily unavailable.{providers.google ? ' You can continue with Google.' : ' Please try again shortly.'}</p>}
      <form onSubmit={event => void submit(event)} aria-busy={busy}>
        {!sent ? <><label htmlFor="signin-email">Email address</label><input id="signin-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></> : <><label htmlFor="signin-code">Email code</label><input id="signin-code" name="token" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter your code" required pattern="[0-9]{6,10}" minLength={6} maxLength={10} value={token} onChange={event => setToken(event.target.value.replace(/\D/g, ''))} disabled={busy}/></>}
        <button className="account-primary-full" disabled={busy || !providers.email}>{busy ? sent ? 'Verifying…' : 'Requesting code…' : sent ? 'Verify and continue' : 'Send email code'}{!busy && <Icon name="arrow"/>}</button>
      </form>
      {sent && <div className="auth-code-actions"><button className="account-link-button" disabled={busy || cooldown > 0} onClick={() => void send()}>{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button><button className="account-link-button" disabled={busy} onClick={() => { setSent(false); setToken(''); setMessage(''); }}>Change email</button></div>}
      {message && <Status error={failed}>{message}</Status>}
      <p className="auth-legal">Read our <a href="/terms">terms</a> and <a href="/privacy">privacy information</a> before continuing.</p>
    </section>
  </main><footer className="account-public-footer">Small steps. A rhythm that lasts.<span>ديمة</span></footer></div>;
}

function blankProfile(): Profile { return { displayName: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', intent: 'learning', appearance: 'light', reducedMotion: false, onboarded: false, revision: 0 }; }
function Onboarding({ user, profile, next, onUpdate, onChanged }: { user: User; profile: Profile | null; next: string; onUpdate: (p: Profile, owner: string) => boolean; onChanged: (owner?: string) => void }) {
  return <div className="onboarding-page"><header className="account-public-header"><Brand/><AppearanceToggle/><span className="account-caption">Make yourself at home</span></header><main id="account-main" className="onboarding-layout"><div><span className="account-eyebrow">Start with your rhythm</span><h1>A space that <br/>fits you.</h1><p>Three small details. You can change them anytime.</p><ol className="onboarding-outline"><li><span>01</span>What should we call you?</li><li><span>02</span>Keep your days in sync.</li><li><span>03</span>Choose where to begin.</li></ol><p className="account-caption">Your progress is personal. Your starting choice never locks you into one kind of account.</p></div><section className="account-panel"><ProfileForm user={user} profile={profile ?? blankProfile()} onboarding next={next} onUpdate={onUpdate} onChanged={onChanged}/></section></main></div>;
}

function ProfileForm({ user, profile, onboarding = false, next = '/app/today', onUpdate, onChanged }: { user: User; profile: Profile; onboarding?: boolean; next?: string; onUpdate: (p: Profile, owner: string) => boolean; onChanged: (owner?: string) => void }) {
  const [draft, setDraft] = useState<Profile>(() => ({ ...profile })); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [failed, setFailed] = useState(false); const [conflict, setConflict] = useState(false); const [latest, setLatest] = useState<Profile | null>(null); const [validation, setValidation] = useState<Record<string, string>>({});
  const pending = useRef<{ signature: string; operationId: string } | null>(null);
  const owner = user.id;
  const entry = onboardingEntry(destination(next), draft.intent);
  const [baseline, setBaseline] = useState<Profile>(() => ({ ...profile }));
  const dirty = (['displayName', 'timezone', 'intent', 'reducedMotion'] as const).some(key => draft[key] !== baseline[key]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const timezones = useMemo(() => ['UTC', ...Intl.supportedValuesOf('timeZone')], []);
  const field = <K extends keyof Profile>(key: K, value: Profile[K]) => { setDraft(d => ({ ...d, [key]: value })); setMessage(''); setValidation(v => ({ ...v, [key]: '' })); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const isDraft = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft'; const errors: Record<string, string> = {};
    if (!isDraft && !draft.displayName.trim()) errors.displayName = 'Enter a name to continue.';
    try { new Intl.DateTimeFormat('en', { timeZone: draft.timezone }).format(); } catch { errors.timezone = 'Choose a valid time zone, such as Africa/Cairo.'; }
    setValidation(errors); if (Object.keys(errors).length) { document.getElementById(errors.displayName ? 'display-name' : 'time-zone')?.focus(); return; }
    setBusy(true); setFailed(false); setMessage('');
    const body = { displayName: draft.displayName.trim(), timezone: draft.timezone, intent: draft.intent, appearance: draft.appearance, reducedMotion: draft.reducedMotion, onboarded: onboarding ? !isDraft : true, expectedRevision: draft.revision };
    const signature = JSON.stringify(body); if (pending.current?.signature !== signature) pending.current = { signature, operationId: crypto.randomUUID() };
    try {
      const saved = await api<Account>('/me', 'PATCH', { ...body, operationId: pending.current.operationId }, owner);
      if (!alive.current) return;
      if (saved.accountId !== owner || !saved.profile) { onChanged(owner); return; }
      const fresh = saved.profile;
      if (!onUpdate(fresh, owner)) return;
      setBaseline({ ...fresh });
      setDraft({ ...fresh }); pending.current = null; setConflict(false); setLatest(null); setMessage(isDraft ? 'Draft saved. You can pick up here next time.' : 'Changes saved.');
      if (onboarding && !isDraft) window.location.assign(entry.href);
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof AccountError && reason.code === 'ACCOUNT_CHANGED') { onChanged(owner); return; }
      if (reason instanceof AccountError && reason.status === 401) { onChanged(owner); return; }
      setFailed(true); if (reason instanceof AccountError && reason.status === 409) { setConflict(true); setMessage('Your settings changed on another device. Your draft is still here. Review the latest version before saving.'); } else setMessage(explain(reason));
    } finally { if (alive.current) setBusy(false); }
  }
  async function review() { setBusy(true); try { const account = await api<Account>('/me', 'GET', undefined, owner); if (!alive.current) return; if (account.accountId !== owner) { onChanged(owner); return; } if (account.profile) setLatest({ ...account.profile }); } catch (reason) { if (!alive.current) return; if (reason instanceof AccountError && (reason.status === 401 || reason.code === 'ACCOUNT_CHANGED')) onChanged(owner); else { setFailed(true); setMessage(explain(reason)); } } finally { setBusy(false); } }
  return <form className="profile-form" onSubmit={event => void save(event)} aria-busy={busy}>
    <h2>{onboarding ? 'Your starting point' : 'Profile & preferences'}</h2>
    <label htmlFor="display-name">What should we call you?</label><input id="display-name" name="displayName" autoComplete="nickname" maxLength={80} value={draft.displayName} onChange={event => field('displayName', event.target.value)} aria-invalid={!!validation.displayName} aria-describedby={validation.displayName ? 'name-error' : undefined} disabled={busy}/>{validation.displayName && <p id="name-error" className="account-field-error">{validation.displayName}</p>}
    <label htmlFor="time-zone">Your time zone</label><input id="time-zone" name="timezone" list="timezone-options" autoComplete="off" value={draft.timezone} onChange={event => field('timezone', event.target.value)} aria-invalid={!!validation.timezone} aria-describedby="timezone-help timezone-error" disabled={busy}/><datalist id="timezone-options">{timezones.map(zone => <option key={zone} value={zone}/>)}</datalist><p id="timezone-help" className="account-caption">{onboarding ? 'Detected from this device. Check it matches your day.' : 'Used for your local day. Changing it won’t rewrite your history; review your saved learning plan after changing the time zone.'}</p><p id="timezone-error" className="account-field-error">{validation.timezone}</p>
    <fieldset disabled={busy} className="intent-options"><legend>{onboarding ? 'What brings you here?' : 'Your starting view'}</legend><label className={draft.intent === 'learning' ? 'is-selected' : ''}><input type="radio" name="intent" value="learning" checked={draft.intent === 'learning'} onChange={() => field('intent', 'learning')}/><Icon name="courses"/><span><strong>Plan learning</strong><small>Choose a course, then plan your study days.</small></span></label><label className={draft.intent === 'work' ? 'is-selected' : ''}><input type="radio" name="intent" value="work" checked={draft.intent === 'work'} onChange={() => field('intent', 'work')}/><Icon name="focus"/><span><strong>Track work</strong><small>Start a work timer. No course needed.</small></span></label></fieldset>
    {!onboarding && <div className="profile-comfort"><h3>Make it comfortable</h3><div className="appearance-setting"><AppearanceToggle/><p className="account-caption">Appearance changes instantly and is saved on this browser. Light is the default.</p></div><label className="account-checkbox"><input type="checkbox" checked={draft.reducedMotion} onChange={event => field('reducedMotion', event.target.checked)} disabled={busy}/><span>Reduce motion<small>Keep transitions minimal. Your device preference is always respected.</small></span></label></div>}
    {message && <Status error={failed}>{message}</Status>}
    {conflict && <div className="account-conflict"><button type="button" className="secondary" onClick={() => void review()} disabled={busy}>Review latest version</button>{latest && <div><h3>Latest saved settings</h3><dl><div><dt>Name</dt><dd>{latest.displayName || 'Not set'}</dd></div><div><dt>Time zone</dt><dd>{latest.timezone}</dd></div><div><dt>Starting view</dt><dd>{latest.intent}</dd></div><div><dt>Reduce motion</dt><dd>{latest.reducedMotion ? 'On' : 'Off'}</dd></div></dl><p className="account-caption">Using this version replaces your unsaved form. Your draft stays here until you choose.</p><button type="button" className="secondary" onClick={() => { if (!onUpdate(latest, owner)) return; setBaseline(latest); setDraft(latest); setConflict(false); setLatest(null); setFailed(false); setMessage('Latest settings loaded. Review and edit before saving.'); pending.current = null; }}>Use latest saved settings</button></div>}</div>}
    {onboarding && <p className="account-caption">Your display name and eligible scores join leaderboards automatically. You can hide yourself from each board anytime. Follow requests are on, and accepted followers can see your progress summaries. You can change this in Privacy & sharing. Your plan and session details stay private. <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy details</a></p>}
    <div className="profile-actions"><button type="submit" disabled={busy || conflict || (!onboarding && !dirty)}>{busy ? 'Saving…' : onboarding ? entry.label : 'Save changes'}<Icon name="arrow"/></button>{!onboarding && dirty && <button type="button" className="account-link-button" disabled={busy || conflict} onClick={() => { setDraft({ ...baseline }); setMessage('Unsaved changes discarded.'); setFailed(false); setValidation({}); }}>Discard changes</button>}{onboarding && <button type="submit" value="draft" className="account-link-button" disabled={busy || conflict}>Save draft for later</button>}</div>
    {!onboarding && <p className="account-caption">{dirty ? 'You have unsaved changes. Save or discard them before leaving.' : 'No unsaved changes.'}</p>}
    {onboarding && <p className="account-caption">{entry.detail}</p>}
  </form>;
}

const navigation = [['today', 'Today'], ['plan', 'My Plan'], ['courses', 'My Courses'], ['focus', 'Focus'], ['progress', 'Progress'], ['library', 'Library'], ['progress/circle', 'Friends'], ['rooms', 'Study rooms'], ['contributions', 'Contributions']];
const navigationHints: Record<string, string> = {
  today: 'What to do next', plan: 'Your weekly schedule', courses: 'Courses you have added',
  focus: 'Your personal timer', progress: 'Completed work and time', library: 'Find a course to add',
  'progress/circle': 'Follow and study together', rooms: 'Focus with other people', contributions: 'Share a course outline', admin: 'Manage the platform',
  help: 'How Dima works', settings: 'Profile and preferences', notifications: 'Updates for you',
};
function WorkspaceBreadcrumb({ section, title }: { section: string; title: string }) {
  const [area, child, part] = section.split('/');
  const labels: Record<string, Record<string, string>> = {
    plan: { setup: 'Set your week', recovery: 'Adjust your plan', previews: 'Review plan' },
    courses: { new: 'Create a course', add: 'Choose activities' },
    progress: { activity: 'Session history', circle: 'Friends', sharing: 'Privacy & sharing', milestones: 'Milestones', leaderboards: 'Leaderboards', members: 'Shared profile' },
  };
  const detail = ['progress/circle', 'progress/milestones', 'progress/sharing'].includes(section) ? '' : child ? labels[area]?.[child] ?? (area === 'courses' ? part === 'tasks' ? 'Activity' : part === 'people' ? 'Course community' : 'Course outline' : area === 'library' ? 'Course details' : area === 'rooms' ? child === 'new' ? 'Create a room' : 'Room' : '') : '';
  return <nav className="workspace-breadcrumb" aria-label="Breadcrumb">{area === 'today' ? <span aria-current="page">Today</span> : <><a href="/app/today">Today</a><span aria-hidden="true">/</span>{detail ? <><a href={title === 'Friends' ? '/app/progress/circle' : `/app/${area}`}>{title}</a><span aria-hidden="true">/</span><span aria-current="page">{detail}</span></> : <span aria-current="page">{title}</span>}</>}</nav>;
}
function WorkspaceHeading({ section, title, timezone }: { section: string; title: string; timezone: string }) {
  const rooms = useRooms();
  const [area, roomId] = section.split('/');
  const member = rooms.me?.membership;
  const joined = area === 'rooms' && !!roomId && member?.roomId === roomId && member.status === 'active' && Date.parse(member.seatExpiresAt) > rooms.now;
  useEffect(() => {
    if (joined) document.getElementById('workspace-title')?.focus({ preventScroll: true });
  }, [joined, section]);
  if (joined) return null;
  return <div className="workspace-heading"><div><h1 id="workspace-title" tabIndex={-1}>{title}</h1>{area === 'today' && <p className="workspace-date">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone }).format(new Date())}</p>}</div><span className="account-preview-badge">Beta</span></div>;
}

function Workspace({ section, query, user, profile, role, onUpdate, onChanged, onSignOut }: { section: string; query: string; user: User; profile: Profile; role: Account['role']; onUpdate: (p: Profile, owner: string) => boolean; onChanged: (owner?: string) => void; onSignOut: () => Promise<void> }) {
  const [online, setOnline] = useState(true);
  const active = section.split('/')[0]; const friendsPage = ['progress/circle', 'progress/milestones', 'progress/sharing'].includes(section) || section.startsWith('progress/members/'); const title = friendsPage ? section === 'progress/milestones' ? 'Milestones' : section === 'progress/sharing' ? 'Privacy & sharing' : 'Friends' : navigation.find(([key]) => key === active)?.[1] ?? (active === 'settings' ? 'Settings' : active === 'help' ? 'Help' : active === 'more' ? 'More' : active === 'rooms' ? 'Study rooms' : active === 'notifications' ? 'Notifications' : active === 'admin' ? 'Administration' : 'Your space');
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  useEffect(() => { document.title = `${title} · Dima`; const heading = document.getElementById('workspace-title'); heading?.focus({ preventScroll: true }); }, [title, section]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (profile.reducedMotion || media.matches || document.hidden) return;
    const animation = document.getElementById('account-main')?.animate?.([
      { opacity: .8, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' },
    ], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
    const stop = () => { if (media.matches || document.hidden) animation?.cancel(); };
    media.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    return () => { animation?.cancel(); media.removeEventListener('change', stop); document.removeEventListener('visibilitychange', stop); };
  }, [section, profile.reducedMotion]);

  function navLink(key: string, label: string, mobile = false) {
    const selected = key === (!mobile && friendsPage ? 'progress/circle' : mobile && active === 'rooms' ? 'focus' : active) || mobile && key === 'more' && !['today', 'plan', 'focus', 'rooms', 'courses'].includes(active);
    const hint = !mobile ? navigationHints[key] : undefined;
    return <a key={key} href={`/app/${key}`} aria-label={label} aria-describedby={hint ? `nav-${key}-hint` : undefined} aria-current={selected ? 'page' : undefined} className={`account-nav-link${selected ? ' is-current' : ''}`}><Icon name={key}/><span>{label}{hint && <small id={`nav-${key}-hint`}>{hint}</small>}</span></a>;
  }

  return <LearningSessionProvider><FocusProvider owner={user.id} profile={profile} onIdentityChanged={onChanged}><RoomsProvider><div className="workspace"><aside className="workspace-sidebar"><Brand/><nav aria-label="Main navigation"><div className="sidebar-nav-group"><p className="sidebar-group-title">Your workspace</p>{navigation.filter(([key]) => ['today','plan','courses','focus','progress'].includes(key)).map(([key,label]) => navLink(key,label))}</div><div className="sidebar-nav-group"><p className="sidebar-group-title">Discover</p>{navigation.filter(([key]) => ['library','progress/circle','rooms'].includes(key)).map(([key,label]) => navLink(key,label))}</div></nav><div className="sidebar-bottom"><nav aria-label="Community and account"><details className="sidebar-tools" open={active === 'contributions' || active === 'admin'}><summary>More tools</summary>{navLink('contributions', 'Contributions')}{role === 'admin' && navLink('admin', 'Administration')}</details>{navLink('help', 'Help')}{navLink('settings', 'Settings')}</nav><a className="sidebar-account" href="/app/settings#profile" aria-label="Edit my profile"><Avatar name={profile.displayName} src={profile.avatarUrl}/><span><strong>{profile.displayName}</strong><small>Edit profile</small></span></a><FocusSignOut onSignOut={onSignOut}/></div></aside>
    <div className="workspace-body"><header className="workspace-topbar"><span className="workspace-wordmark"><Brand/></span><WorkspaceBreadcrumb section={section} title={title}/><AppearanceToggle/><a className="workspace-notifications" href="/app/notifications">Notifications</a><a className="account-avatar-link" href="/app/settings#profile" aria-label="Edit my profile"><Avatar name={profile.displayName} src={profile.avatarUrl}/></a></header>
      <main id="account-main" className="workspace-content"><WorkspaceHeading section={section} title={title} timezone={profile.timezone}/>
        {!online && <Status error>You’re offline. Active focus can keep a stop request on this device when storage is available. Other changes need a connection.</Status>}
        {active === 'settings' ? <div className="settings-layout"><section className="account-panel" id="profile"><ProfilePhoto key={user.id} profile={profile} owner={user.id} onUpdate={onUpdate} onChanged={onChanged}/><ProfileForm user={user} profile={profile} onUpdate={onUpdate} onChanged={onChanged}/><AccountOperations accountId={user.id}/></section><aside className="settings-context"><Icon name="lock"/><h2>Your account</h2><p className="account-email">{user.email}</p><p>Your profile preferences are saved to your account. Appearance is saved separately on this browser.</p><div className="settings-divider"/><h3>Privacy & sharing</h3><a href="/app/progress/sharing">Manage what others can see</a><p>Your learning plans and detailed time stay private. Joining a room shares your display name and declared focus state with its members.</p><FocusSignOut className="secondary" onSignOut={onSignOut}/></aside></div> : active === 'rooms' ? <RoomsArea section={section} query={query}/> : active === 'focus' ? <FocusArea section={section} query={query}/> : active === 'progress' ? <ProgressArea section={section} query={query}/> : active === 'notifications' ? <Notifications/> : active === 'contributions' ? <Contributions query={query}/> : active === 'admin' ? role === 'admin' ? <Administration query={query}/> : <Status error>This page is unavailable with your current access.</Status> : ['today', 'courses', 'plan', 'library'].includes(active) ? <LearningArea key={user.id} section={section} query={query} owner={user.id} profile={profile} onIdentityChanged={onChanged}/> : active === 'more' ? <div className="more-links">{[['progress/circle','Friends'],['rooms','Study rooms'],['progress','Progress'],['library','Library'],['contributions','Contributions'],['notifications','Notifications'],...(role === 'admin' ? [['admin','Administration']] : []),['settings','Settings'],['help','Help']].map(([key,label]) => <a href={`/app/${key}`} key={key} aria-label={label} aria-describedby={`more-${key}-hint`}><Icon name={key}/><span>{label}<small id={`more-${key}-hint`}>{navigationHints[key]}</small></span><Icon name="arrow"/></a>)}<FocusSignOut className="secondary" onSignOut={onSignOut}/></div> : <WorkspaceHelp section={active}/>}
      </main><footer className="workspace-footer">A little, often.<span>Make space for the next step.</span></footer>
    </div><nav className="workspace-mobile-nav" aria-label="Mobile navigation">{[['today','Today'],['plan','Plan'],['focus','Focus'],['courses','Courses'],['more','More']].map(([key,label]) => navLink(key,label,true))}</nav>
  </div><RoomSessionStrip section={section}/></RoomsProvider></FocusProvider></LearningSessionProvider>;
}
function WorkspaceHelp({ section }: { section: string }) { if(section === 'help') return <section className="workspace-help"><h2>Choose your next step</h2><p>You can plan a course, start a timer, or study with others. Start with what you need today.</p><ol><li><h3>Bring a course</h3><p>Pick from the library or add your own outline. Required activities are selected for you; previous progress is optional.</p><a href="/app/library">Browse courses</a></li><li><h3>Make a realistic plan</h3><p>Choose your available time and review the schedule before saving. If you miss a day, adjust future work without losing progress.</p><a href="/app/plan">Open my plan</a></li><li><h3>Start one focused session</h3><p>Use a timer for learning or work, or enter a study room. Entering a room leaves your timer off until you join a focus round.</p><a href="/app/focus">Focus alone</a><a href="/app/rooms">Study rooms</a></li><li><h3>Study with friends</h3><p>Share your profile link and accept follow requests. Choose which progress summaries to share, compare course progress, and invite friends into a study room.</p><a href="/app/progress/circle">Find and invite friends</a><a href="/app/progress/leaderboards">Explore leaderboards</a></li></ol><p>Finishing a timer records time. Mark an activity complete separately when you’ve finished the work.</p><nav aria-label="More help"><a href="/app/progress/sharing">Privacy & sharing</a><a href="mailto:support@dima.study">Contact support</a></nav></section>; return <section className="upcoming-state"><span className="upcoming-icon"><Icon name="arrow"/></span><h2>We couldn’t find that page.</h2><p>The link may be out of date. Your courses, plan and saved progress are still in your space.</p><a className="account-button-link" href="/app/today">Back to Today <Icon name="arrow"/></a><a className="account-text-link" href="/app/help">Open help</a></section>; }
