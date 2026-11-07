'use client';

import { useState } from 'react';

/** Copy only on request; a selectable link still works if clipboard access is denied. */
export function CopyLink({ path, label }: { path: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = `https://dima.study${path}`;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setState('copied'); }
    catch { setState('manual'); }
  }
  return <div className="dima-copy-link"><button type="button" className="secondary" onClick={() => void copy()}>{label}</button>
    {state === 'copied' && <span role="status">Link copied</span>}
    {state === 'manual' && <label>Copy this link<input readOnly value={url} onFocus={event => event.currentTarget.select()}/></label>}
  </div>;
}
