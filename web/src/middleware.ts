/**
 * middleware.ts — Refreshes the Supabase auth session on every request and
 * guards protected route groups. Runs on the Edge.
 *
 * Protection model:
 *   /account/*  -> requires any authenticated user
 *   /admin/*    -> requires staff or admin (role from app_metadata claim)
 * Public routes (storefront, auth pages) pass through.
 *
 * NOTE: This is defense-in-depth for UX (redirects). The authoritative access
 * control is RLS + server-side role checks; never rely on middleware alone.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { AppRole } from '@/lib/domain/enums';

const PROTECTED_PREFIXES = ['/account'];
const STAFF_PREFIXES = ['/admin'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() revalidates the token with Supabase (getSession does not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  const needsAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  const needsStaff = STAFF_PREFIXES.some((p) => path.startsWith(p));

  if ((needsAuth || needsStaff) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', path);
    return NextResponse.redirect(url);
  }

  if (needsStaff && user) {
    const role = (user.app_metadata?.role as AppRole | undefined) ?? 'customer';
    if (role !== 'staff' && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image optimization.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
