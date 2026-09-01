import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Log in to your Geega Games account.',
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/account');
  const sp = await searchParams;
  const next = sp.redirect && sp.redirect.startsWith('/') ? sp.redirect : undefined;
  return <LoginForm next={next} />;
}
