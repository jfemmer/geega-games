'use server';

/**
 * actions.ts — Server Actions for authentication.
 *
 * All auth mutations run here, server-side, using the SSR Supabase client so the
 * session is written to httpOnly cookies (never localStorage — that was the
 * legacy vulnerability). Inputs are validated with Zod; the browser only ever
 * sends email/password strings.
 *
 * Email confirmation is ON: signUp sends a confirmation email (Supabase built-in
 * for now; Resend SMTP later — no code change needed). The confirmation link
 * routes to /auth/callback, which exchanges the code for a session.
 */
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// ---- Validation schemas -----------------------------------------------------
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer'); // bcrypt/Supabase limit

const signupSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

// ---- Result type for useActionState ----------------------------------------
export interface AuthState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
}

function firstFieldErrors(
  issues: z.ZodIssue[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

// ---- Sign up ----------------------------------------------------------------
export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const { email, password, firstName, lastName } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The confirmation link in the email points here.
      emailRedirectTo: `${SITE_URL}/auth/callback?next=/account`,
      // Stored in raw_user_meta_data; the handle_new_user() trigger copies
      // first/last name into profiles on confirm.
      data: {
        first_name: firstName ?? null,
        last_name: lastName ?? null,
      },
    },
  });

  if (error) {
    return { error: humanizeAuthError(error.message) };
  }

  // If email confirmation is required, Supabase returns a user with an empty
  // identities array and no session. Show the "check your email" state.
  const needsConfirmation =
    data.user && data.user.identities && data.user.identities.length === 0;

  if (needsConfirmation) {
    // This specific shape means the email is ALREADY registered. Supabase
    // returns success (to avoid leaking which emails exist), but we can nudge.
    return {
      success:
        'That email may already be registered. Check your inbox — if you have an account, use “Forgot password” to sign in.',
    };
  }

  return {
    success:
      'Account created. Check your email for a confirmation link to finish signing up.',
  };
}

// ---- Log in -----------------------------------------------------------------
export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: firstFieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Supabase returns "Email not confirmed" distinctly — surface it helpfully.
    if (/not confirmed/i.test(error.message)) {
      return {
        error:
          'Your email isn’t confirmed yet. Check your inbox for the confirmation link, or resend it below.',
      };
    }
    return { error: 'Incorrect email or password.' };
  }

  const nextRaw = formData.get('next');
  const next = typeof nextRaw === 'string' && nextRaw.startsWith('/') ? nextRaw : '/account';
  revalidatePath('/', 'layout');
  redirect(next);
}

// ---- Log out ----------------------------------------------------------------
export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

// ---- Resend confirmation ----------------------------------------------------
export async function resendConfirmationAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { fieldErrors: { email: 'Enter a valid email address' } };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: parsed.data,
    options: { emailRedirectTo: `${SITE_URL}/auth/callback?next=/account` },
  });
  if (error) return { error: humanizeAuthError(error.message) };
  return { success: 'Confirmation email sent. Check your inbox.' };
}

// ---- Request password reset -------------------------------------------------
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { fieldErrors: { email: 'Enter a valid email address' } };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${SITE_URL}/auth/callback?next=/auth/update-password`,
  });
  // Always report success (don't leak which emails are registered).
  if (error && !/rate/i.test(error.message)) {
    return { error: humanizeAuthError(error.message) };
  }
  return {
    success:
      'If an account exists for that email, a password reset link is on its way.',
  };
}

// ---- Update password (after clicking reset link) ----------------------------
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const password = formData.get('password');
  const confirm = formData.get('confirmPassword');
  const p = passwordSchema.safeParse(password);
  if (!p.success) return { fieldErrors: { password: p.error.issues[0].message } };
  if (password !== confirm)
    return { fieldErrors: { confirmPassword: 'Passwords do not match' } };

  const supabase = await createClient();
  // The reset link established a session via /auth/callback; this updates it.
  const { error } = await supabase.auth.updateUser({ password: p.data });
  if (error) return { error: humanizeAuthError(error.message) };

  revalidatePath('/', 'layout');
  redirect('/account?password_updated=1');
}

// ---- Error message cleanup --------------------------------------------------
function humanizeAuthError(message: string): string {
  if (/already registered/i.test(message)) {
    return 'An account with this email already exists. Try logging in.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/weak|password/i.test(message)) {
    return 'Please choose a stronger password (at least 8 characters).';
  }
  return 'Something went wrong. Please try again.';
}
