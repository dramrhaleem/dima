import { Suspense } from 'react';
import { WorkspaceClient } from '../../src/components/workspace-client';

// Keep the account, navigation shell and owner-scoped cache alive across routes.
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <><Suspense fallback={<div className="workspace-initial" role="status">Opening your space…</div>}><WorkspaceClient/></Suspense>{children}</>;
}
