import type { Metadata, Viewport } from 'next';
import '@dima/ui/styles.css';
import '../../../packages/ui/src/account.css';
import '../../../packages/ui/src/learning.css';
import '../../../packages/ui/src/focus.css';
import '../../../packages/ui/src/rooms.css';
import '../../../packages/ui/src/workspace-sizing.css';
export const metadata: Metadata = {
  title: 'Dima · A little, often',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico?v=20261101', sizes: '16x16 32x32 48x48' },
      { url: '/favicon-32.png?v=20261101', type: 'image/png', sizes: '32x32' },
      { url: '/favicon.svg?v=20261101', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png?v=20261101', type: 'image/png', sizes: '1024x1024' }],
  },
};
export const viewport: Viewport = { themeColor: '#FAF9F6' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><head><script src="/appearance.js"/></head><body>{children}</body></html>;
}
