'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type AuthState } from '@/features/auth/actions';
import {
  AuthCard,
  Field,
  SubmitButton,
  ErrorBanner,
} from '@/components/auth/form-ui';

const initial: AuthState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, initial);

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to your Geega Games account."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-800">
            Create an account
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <ErrorBanner message={state.error} />
        {next && <input type="hidden" name="next" value={next} />}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />
        <div className="flex justify-end">
          <Link
            href="/auth/reset-password"
            className="text-xs font-medium text-brand-600 hover:text-brand-800"
          >
            Forgot password?
          </Link>
        </div>
        <SubmitButton>Log in</SubmitButton>
      </form>
    </AuthCard>
  );
}
