import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logoutAction } from '@/features/auth/actions';

export const metadata: Metadata = {
  title: 'My account',
  robots: { index: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ password_updated?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account');

  const sp = await searchParams;
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();

  const name = profile?.first_name
    ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}`
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      {sp.password_updated === '1' && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          Your password has been updated.
        </div>
      )}
      <h1 className="text-2xl font-bold text-neutral-900">
        {name ? `Welcome, ${name}` : 'My account'}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">{user.email}</p>

      <div className="mt-8 rounded-xl border border-brand-100 bg-brand-50 p-6">
        <p className="text-sm text-brand-900">
          Your account is ready. Online checkout is coming soon — you can browse
          the catalog now, and we’ll email you when purchasing goes live.
        </p>
      </div>

      <div className="mt-8">
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:border-brand-300"
          >
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
