'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RankingSnapshot } from '@dima/contracts';

/** Animate only differences observed during one uninterrupted, fresh viewing session. */
export function useRankingMotion(data: RankingSnapshot | null, identity: string, healthy: boolean) {
  const list = useRef<HTMLOListElement>(null);
  const announcement = useRef<HTMLParagraphElement>(null);
  const previous = useRef<{ identity: string; at: number; data: RankingSnapshot; positions: Map<string, number> } | null>(null);
  const effects = useRef<Animation[]>([]);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const reset = () => {
      previous.current = null;
      effects.current.forEach(animation => animation.cancel()); effects.current = [];
      if (expiry.current) clearTimeout(expiry.current);
      list.current?.querySelectorAll('[data-advanced]').forEach(row => row.removeAttribute('data-advanced'));
      if (announcement.current) announcement.current.textContent = '';
    };
    const visibility = () => { if (document.hidden) reset(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', reset);
    return () => { reset(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', reset); };
  }, []);
  useLayoutEffect(() => {
    const before = previous.current;
    const root = list.current;
    effects.current.forEach(animation => animation.cancel()); effects.current = [];
    if (expiry.current) clearTimeout(expiry.current);
    root?.querySelectorAll('[data-advanced]').forEach(row => row.removeAttribute('data-advanced'));
    if (announcement.current) announcement.current.textContent = '';
    if (!data || !root || !healthy || document.hidden) { previous.current = null; return; }
    const elements = [...root.querySelectorAll<HTMLElement>('[data-profile]')];
    const positions = new Map(elements.map(element => [element.dataset.profile!, element.offsetTop]));
    const now = Date.now();
    previous.current = { identity, at: now, data, positions };
    const continuous = before && before.identity === identity && now - before.at < 45000
      && before.data.correctedAt === data.correctedAt && before.data.scoringVersion === data.scoringVersion
      && before.data.requiredWeight === data.requiredWeight
      && before.data.window?.start === data.window?.start && before.data.window?.end === data.window?.end
      && Date.parse(data.calculatedAt) > Date.parse(before.data.calculatedAt);
    if (!continuous) return;
    const reduced = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const old = new Map(before.data.rows.map(row => [row.profileId, row]));
    if (data.rows.some(row => old.has(row.profileId) && row.score < old.get(row.profileId)!.score)) return;
    const advanced = data.rows.filter(row => old.has(row.profileId) && row.score > old.get(row.profileId)!.score).slice(0, 6);
    if (!advanced.length) return;
    const notices: string[] = [];
    for (const element of elements) {
      const row = data.rows.find(value => value.profileId === element.dataset.profile)!;
      const previousRow = old.get(row.profileId);
      const previousY = before.positions.get(row.profileId);
      const deltaY = previousY === undefined ? 0 : previousY - element.offsetTop;
      if (!reduced && previousRow && previousRow.rank !== row.rank && deltaY && Math.abs(deltaY) < 900) {
        effects.current.push(element.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' }));
      }
      if (!advanced.some(value => value.profileId === row.profileId)) continue;
      const delta = row.score - previousRow!.score;
      const value = data.unit === 'weight' && data.requiredWeight ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(delta / data.requiredWeight * 100)}% of course` : data.unit === 'seconds' ? delta < 60 ? `${Math.floor(delta)} sec` : `${Math.floor(delta / 60)} min` : `${delta} points`;
      element.setAttribute('data-advanced', 'true');
      const label = element.querySelector('.community-score-gain');
      if (label) label.textContent = `+${value}`;
      notices.push(`${row.displayName} added ${value}`);
    }
    if (notices.length && announcement.current) announcement.current.textContent = `${notices.join('. ')}.`;
    expiry.current = setTimeout(() => { elements.forEach(element => element.removeAttribute('data-advanced')); }, 4500);
  }, [data, identity, healthy]);
  return { list, announcement };
}
