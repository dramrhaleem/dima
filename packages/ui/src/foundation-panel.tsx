'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { BrandLogo } from './appearance';
import { createFoundationClient } from '@dima/client';
import { ApiError, type FoundationCheck, type FoundationConfig } from '@dima/contracts';

export function FoundationPanel({ config, surface }: { config: FoundationConfig | null; surface: string }) {
  const client = useMemo(() => config ? createFoundationClient(config) : null, [config]);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Use a disposable test account. No real course data belongs here.');
  const [error, setError] = useState(false);
  const [checks, setChecks] = useState<FoundationCheck[]>([]);
  const [label, setLabel] = useState('My first saved check');

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(false);
    try { await action(); }
    catch (reason) {
      setError(true);
      setStatus(reason instanceof ApiError && reason.code === 'SIGN_IN_FAILED'
        ? 'Could not sign in. Check the test account details and local Auth service, then retry.'
        : 'The check could not finish. Your input is kept. Check the local services and retry.');
    } finally { setBusy(false); }
  }

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const signup = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'signup';
    void run(async () => {
      setChecks([]); setAuthenticated(false); setLabel('My first saved check');
      await client!.authenticate(String(values.get('email')), String(values.get('password')), signup);
      form.reset();
      setAuthenticated(true);
      setStatus('Signed in. Save a check, then reload it from the database.');
    });
  }

  return <div className="foundation-page">
    <a className="skip-link" href="#main">Skip to foundation check</a>
    <header className="brandbar">
      <BrandLogo width={166} height={57}/>
      <span className="environment-label">Local development · B0</span>
    </header>
    <main id="main" className="foundation-layout">
      <section className="intro" aria-labelledby="title">
        <h1 id="title">A foundation for<br />lasting progress.</h1>
        <p>This small check connects the interface, authenticated API and database. It is a development tool, not the learning platform.</p>
        <dl className="system-list">
          <div><dt>Interface</dt><dd>{surface}</dd></div>
          <div><dt>Data</dt><dd>Local PostgreSQL + Auth</dd></div>
          <div><dt>Next milestone</dt><dd>Accounts &amp; first learning journey</dd></div>
        </dl>
        <p className="footnote">The approved landing and brand assets are preserved separately. This screen does not replace them.</p>
      </section>
      <section className="check-panel" aria-labelledby="check-title" aria-busy={busy}>
        <h2 id="check-title">Check the connection</h2>
        {!config ? <p className="notice">The foundation check is disabled. Configure the local test environment to run it. It stays disabled by default for deployment.</p> : <>
          {!authenticated ? <form onSubmit={authenticate}>
            <label htmlFor="email">Test email</label>
            <input id="email" name="email" type="email" autoComplete="username" placeholder="you@example.test" required disabled={busy} />
            <label htmlFor="password">Test password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" minLength={10} required disabled={busy} />
            <div className="actions">
              <button type="submit" value="signin" disabled={busy}>Sign in</button>
              <button className="secondary" type="submit" value="signup" disabled={busy}>Create test account</button>
            </div>
          </form> : <>
            <form onSubmit={event => { event.preventDefault(); void run(async () => { await client!.save(label); setChecks(await client!.list()); setStatus('Saved to the database. Reload the saved checks to verify.'); }); }}>
              <label htmlFor="label">Check label</label>
              <input id="label" value={label} onChange={event => setLabel(event.target.value)} maxLength={120} required disabled={busy} />
              <div className="actions"><button disabled={busy || !label.trim()} type="submit">Save check</button>
                <button className="secondary" type="button" disabled={busy} onClick={() => void run(async () => { setChecks(await client!.list()); setStatus('Loaded your saved checks from the database.'); })}>Reload saved checks</button></div>
            </form>
            <div className="saved-list"><h3>Saved checks</h3>{checks.length ? <ul>{checks.map(check => <li key={check.id}>{check.label}</li>)}</ul> : <p>No checks loaded yet. Save one or reload your existing checks.</p>}</div>
            <button className="quiet" disabled={busy} onClick={() => { setChecks([]); setAuthenticated(false); setLabel('My first saved check'); void run(async () => { await client!.signOut(); setStatus('Signed out. Local account data has been cleared.'); }); }}>Sign out</button>
          </>}
          <p className={error ? 'feedback error' : 'feedback'} role="status" aria-live="polite">{busy ? 'Checking…' : status}</p>
        </>}
      </section>
    </main>
    <footer className="foundation-footer">Dima · Small steps. Lasting progress.<span>Development proof — no production data</span></footer>
  </div>;
}
