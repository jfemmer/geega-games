'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signUpAction, type AuthState } from '@/features/auth/actions';
import {
  AuthCard,
  Field,
  SubmitButton,
  ErrorBanner,
  SuccessBanner,
} from '@/components/auth/form-ui';

const initial: AuthState = {};

export function SignupForm() {
  const [state, formAction] = useActionState(signUpAction, initial);

  // After a successful signup we show the "check your email" confirmation state
  // instead of the form.
  if (state.success) {
    return (
      <AuthCard
        title="Almost there"
        subtitle="Confirm your email to finish creating your account."
        footer={
          <>
            Already confirmed? <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-800">Log in</Link>
          </>
        }
      >
        <SuccessBanner message={state.success} />
        <p className="mt-4 text-sm text-neutral-600">
          We sent a confirmation link to your inbox. Click it and you’ll be
          signed in automatically. The link can take a minute to arrive; check
          spam if you don’t see it.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Join Geega Games to build your collection and check out faster."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-800">
            Log in
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <ErrorBanner message={state.error} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="First name"
            name="firstName"
            autoComplete="given-name"
            error={state.fieldErrors?.firstName}
          />
          <Field
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            error={state.fieldErrors?.lastName}
          />
        </div>
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
          autoComplete="new-password"
          required
          error={state.fieldErrors?.password}
          placeholder="At least 8 characters"
        />
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.confirmPassword}
        />
        <SubmitButton>Create account</SubmitButton>
        <p className="text-center text-xs text-neutral-400">
          You’ll get a confirmation email to verify your address.
        </p>
      </form>
    </AuthCard>
  );
}
