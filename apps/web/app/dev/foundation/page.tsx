import { FoundationPanel } from '@dima/ui';
import { environment } from '../../../src/server/foundation';
export const dynamic = 'force-dynamic';
export default function Page() {
  const env = environment();
  const config = env.DIMA_B0_ENABLED === 'true' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY
    ? { apiBaseUrl: '', supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }
    : null;
  return <FoundationPanel config={config} surface="Workers web" />;
}
