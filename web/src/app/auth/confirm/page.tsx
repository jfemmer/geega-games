import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Confirmation',
  robots: { index: false },
};

// Friendly landing when a confirmation/reset link is invalid or expired — never
// a raw error. Offers the obvious next steps.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const isError = sp.error === '1';

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-brand">
          {isError ? 'Link expired or invalid' : 'Confirmed'}
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          {isError
            ? 'That link may have already been used or expired. You can request a new one, or log in if you’ve already confirmed.'
            : 'Your email is confirmed. You can now log in.'}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/login"
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Go to log in
          </Link>
          {isError && (
            <Link
              href="/auth/reset-password"
              className="text-sm font-medium text-brand-600 hover:text-brand-800"
            >
              Request a new link
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
