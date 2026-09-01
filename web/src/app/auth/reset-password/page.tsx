import type { Metadata } from 'next';
import { ResetRequestForm } from '@/components/auth/ResetRequestForm';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false },
};

export default function ResetPasswordPage() {
  return <ResetRequestForm />;
}
