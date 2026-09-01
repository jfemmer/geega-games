'use client';

import { useActionState } from 'react';
import { updatePasswordAction, type AuthState } from '@/features/auth/actions';
import {
  AuthCard,
  Field,
  SubmitButton,
  ErrorBanner,
} from '@/components/auth/form-ui';

const initial: AuthState = {};

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initial);

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Choose a new password for your account."
    >
      <form action={formAction} className="space-y-4">
        <ErrorBanner message={state.error} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.password}
          placeholder="At least 8 characters"
        />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.confirmPassword}
        />
        <SubmitButton>Update password</SubmitButton>
      </form>
    </AuthCard>
  );
}
