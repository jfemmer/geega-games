'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordResetAction, type AuthState } from '@/features/auth/actions';
import {
  AuthCard,
  Field,
  SubmitButton,
  ErrorBanner,
  SuccessBanner,
} from '@/components/auth/form-ui';

const initial: AuthState = {};

export function ResetRequestForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, initial);

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We’ll email you a link to set a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-800">
            Back to log in
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <ErrorBanner message={state.error} />
        <SuccessBanner message={state.success} />
        {!state.success && (
          <>
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              error={state.fieldErrors?.email}
            />
            <SubmitButton>Send reset link</SubmitButton>
          </>
        )}
      </form>
    </AuthCard>
  );
}
