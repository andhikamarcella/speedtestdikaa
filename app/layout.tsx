import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SpeedTest Vercel',
  description: 'Measure download, upload, and HTTP latency directly from a Vercel-hosted Next.js app.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
