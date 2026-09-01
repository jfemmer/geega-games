import Link from 'next/link';
import { formatCents, SHIPPING } from '@/lib/domain/pricing';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-bold text-brand">Geega Games</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/cards" className="font-medium text-neutral-700 hover:text-brand">
            Browse
          </Link>
          <Link href="/login" className="font-medium text-neutral-700 hover:text-brand">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white transition hover:bg-brand-700"
          >
            Sign up
          </Link>
        </nav>
      </div>
      <p className="mt-4 text-lg text-neutral-700">
        Browse our Magic: The Gathering singles. Online checkout is coming
        soon — create an account now and we’ll email you the moment it goes live.
      </p>
      <div className="mt-8 rounded-xl border border-brand-100 bg-brand-50 p-6">
        <h2 className="font-semibold text-brand-800">Shipping (server-authoritative)</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-700">
          <li>Tracked: {formatCents(SHIPPING.TRACKED_CENTS)} (free at {formatCents(SHIPPING.FREE_TRACKED_THRESHOLD_CENTS)}+)</li>
          <li>PWE: {formatCents(SHIPPING.PWE_CENTS)}</li>
        </ul>
      </div>
    </main>
  );
}
