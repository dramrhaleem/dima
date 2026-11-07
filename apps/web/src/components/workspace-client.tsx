'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useTransition, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AccountApp } from '../../../../packages/ui/src/account';
import { NavigationProvider } from '../../../../packages/ui/src/navigation';

export function WorkspaceClient() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const positions = useRef(new Map<string, number>());
  const nextScroll = useRef<{ key: string; back: boolean; hash: string } | null>(null);
  const location = `${pathname}${search.size ? `?${search}` : ''}`;
  const navigate = useCallback((href: string) => {
    const target = new URL(href, window.location.href);
    positions.current.set(window.location.pathname + window.location.search, window.scrollY);
    nextScroll.current = { key: target.pathname + target.search, back: false, hash: target.hash };
    startTransition(() => router.push(href, { scroll: false }));
  }, [router]);
  useEffect(() => {
    const restore = () => { nextScroll.current = { key: window.location.pathname + window.location.search, back: true, hash: window.location.hash }; };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const remember = () => { positions.current.set(location, window.scrollY); };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [location]);
  useLayoutEffect(() => {
    const target = nextScroll.current;
    if (!target || target.key !== location) return;
    nextScroll.current = null;
    if (target.hash) document.getElementById(decodeURIComponent(target.hash.slice(1)))?.scrollIntoView();
    else window.scrollTo({ top: target.back ? positions.current.get(location) ?? 0 : 0, behavior: 'instant' });
  }, [location]);
  function follow(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/app/')) return;
    if (url.hash && url.pathname === pathname && url.search === window.location.search) return;
    event.preventDefault();
    if (url.href !== window.location.href) navigate(url.pathname + url.search + url.hash);
  }
  const section = pathname.replace(/^\/app\/?/, '') || 'today';
  return <NavigationProvider navigate={navigate}><div onClick={follow}>
    {pending && <div className="workspace-route-progress" role="status" aria-label="Opening page"/>}
    <AccountApp mode="workspace" section={section} next={location}/>
  </div></NavigationProvider>;
}
