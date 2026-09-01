/**
 * /auth/callback — Handles the click from confirmation and password-reset emails.
 *
 * Supabase appends either a `code` (PKCE) or `token_hash` + `type` to this URL.
 * We exchange it for a session (written to cookies), then redirect to `next`.
 * On any failure we send the user to a friendly error state rather than letting
 * the link dead-end — that dead-end is exactly what makes auth feel unfinished.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/account';

  const supabase = await createClient();

  // Newer PKCE flow: ?code=...
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // OTP / older flow: ?token_hash=...&type=...
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Anything else: friendly error page, not a dead end.
  return NextResponse.redirect(`${origin}/auth/confirm?error=1`);
}
