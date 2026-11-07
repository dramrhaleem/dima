import { createRoot } from 'react-dom/client';
import { FoundationPanel } from '@dima/ui';
import '@dima/ui/styles.css';

// This is a build proof, not an Android application. Only public local configuration.
const env = import.meta.env;
const config = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
  ? { apiBaseUrl: env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787', supabaseUrl: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY }
  : null;
createRoot(document.getElementById('root')!).render(<FoundationPanel config={config} surface="Standalone React client" />);
