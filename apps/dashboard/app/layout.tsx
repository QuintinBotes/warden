import type { Metadata } from 'next';
import '@warden/design-system/sentinel.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Warden Dashboard',
  description:
    'Quality gate, coverage, and flake signals rendered over the Sentinel design system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="signal">
      <body>{children}</body>
    </html>
  );
}
