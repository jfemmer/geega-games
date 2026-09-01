import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Geega Games — Magic: The Gathering Singles',
    template: '%s | Geega Games',
  },
  description:
    'Buy Magic: The Gathering singles, sell your cards, and trade in your collection at Geega Games.',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  ),
  openGraph: {
    title: 'Geega Games',
    description: 'Magic: The Gathering singles, trade-ins, and more.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
