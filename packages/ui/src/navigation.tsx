'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

// The web supplies its router; standalone clients can supply their own adapter.
const NavigationContext = createContext<(href: string) => void>(href => window.location.assign(href));
export function NavigationProvider({ navigate, children }: { navigate: (href: string) => void; children: ReactNode }) {
  return <NavigationContext.Provider value={navigate}>{children}</NavigationContext.Provider>;
}
export function useNavigate() {
  const navigate = useContext(NavigationContext);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // A late save may update data, but must not redirect after leaving its form.
  return useCallback((href: string) => { if (live.current) navigate(href); }, [navigate]);
}
