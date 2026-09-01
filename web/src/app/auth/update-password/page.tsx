import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';

export const metadata: Metadata = {
  title: 'Set new password',
  robots: { index: false },
};

// Reachable only with the session established by the reset link (/auth/callback).
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/reset-password');
  return <UpdatePasswordForm />;
}
