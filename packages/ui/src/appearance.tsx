'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('dima-appearance-change', onChange);
  return () => window.removeEventListener('dima-appearance-change', onChange);
}
function snapshot() { return document.documentElement.dataset.theme === 'dark'; }
function serverSnapshot() { return false; }

/** Browser-local preference. Does not save the profile or remount any session. */
export function AppearanceToggle() {
  const dark = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <button type="button" className="dima-appearance-toggle" aria-label="Dark mode" aria-pressed={dark}
    onClick={() => window.dispatchEvent(new CustomEvent('dima-appearance-set', { detail: dark ? 'light' : 'dark' }))}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.9 13.2A9 9 0 0 1 10.8 3.1 9 9 0 1 0 20.9 13.2Z"/></svg>
    <span>Dark mode</span><span className="dima-appearance-state" aria-hidden="true">{dark ? 'On' : 'Off'}</span>
  </button>;
}

/** Both variants have identical geometry; CSS chooses before the first paint. */
export function BrandLogo({ className = '', width = 151, height = 52, alt = 'ديمة — Dima' }: { className?: string; width?: number; height?: number; alt?: string }) {
  return <span className={`dima-brand-logo ${className}`}>
    <img className="dima-logo-light" src="/brand/logo-horizontal.svg" width={width} height={height} alt={alt}/>
    <img className="dima-logo-dark" src="/brand/logo-horizontal-dark.svg" width={width} height={height} alt={alt}/>
  </span>;
}
