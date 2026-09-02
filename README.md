# Geega Games

Magic: The Gathering singles storefront. **React 19 + TypeScript + Vite**, with
**Supabase** for data and **Vercel Functions** (`/api`) for privileged
server-side work (email signup, confirmation, Resend webhooks). Transactional
email is sent with **Resend** using **React Email** templates.

Browsing the catalog is live. Checkout, cart, and customer accounts are
intentionally disabled and labeled "coming soon" until payments are wired up.

## Local development

```bash
npm install
cp .env.example .env   # then fill in the values (see below)
npm run dev
```

Open the printed localhost URL.

### Scripts
```bash
npm run dev          # Vite dev server
npm run build        # tsc -b (app + api + node projects) then vite build -> dist/
npm run preview      # preview the production build
npm run lint         # oxlint
npm run test         # vitest (unit/integration tests)
npm run email:dev    # preview React Email templates locally
```

## Environment variables

Copy `.env.example` to `.env` for local dev. **Only the Supabase publishable key
may be exposed to the browser** (via a `VITE_` variable). All other secrets are
server-only and must never be prefixed with `VITE_`.

### Browser (safe, `VITE_`-prefixed)
| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (RLS-protected) |
| `VITE_PUBLIC_SITE_URL` | Public site URL used by the UI (optional) |
| `VITE_SUPPORT_EMAIL` | Support email shown in the footer (optional; hidden if empty) |

> A legacy `VITE_SUPABASE_KEY` is still read as a fallback, but rename it to
> `VITE_SUPABASE_PUBLISHABLE_KEY`.

### Server only (never sent to the browser)
| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (server) |
| `SUPABASE_SECRET_KEY` | Supabase secret (service_role) key — bypasses RLS |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret (`whsec_...`) |
| `RESEND_FROM_EMAIL` | Marketing/launch sender, e.g. `Geega Games <updates@geega-games.com>` |
| `RESEND_FROM_ORDERS` | Orders sender, e.g. `Geega Games <orders@geega-games.com>` |
| `RESEND_REPLY_TO` | Reply-to / support address, e.g. `support@geega-games.com` |
| `PUBLIC_SITE_URL` | Base URL used to build links in emails (no trailing slash) |
| `EMAIL_TOKEN_SECRET` | HMAC secret for confirmation/unsubscribe tokens (`openssl rand -base64 48`) |

### Vercel environment scopes
- **Browser `VITE_*` vars:** add to **Production, Preview, and Development**.
- **Server secrets:** add to **Production** and **Preview** (and **Development**
  if you run `vercel dev` locally). Never commit them.

## Architecture

```
src/                 React storefront (browser)
  supabase.ts        Browser Supabase client (publishable key only)
  cards.ts           Catalog fetch
  SignupForm.tsx     Newsletter signup -> POST /api/subscribe
  types/database.ts  Generated Supabase types (regenerate on schema change)
api/                 Vercel Functions (server-only)
  subscribe.ts       POST: create/refresh a pending subscriber, send confirm email
  confirm.ts         GET:  validate token, activate subscriber (branded HTML)
  unsubscribe.ts     GET:  unsubscribe from marketing (branded HTML)
  webhooks/resend.ts POST: verify Svix signature, update delivery/subscriber status
  _lib/              Shared server code (env, admin client, tokens, email service…)
emails/              React Email templates (confirm, confirmed, order confirmation)
supabase/migrations/ SQL migrations
```

## Email: double opt-in + delivery tracking

1. Signup creates/refreshes a `pending` subscriber and emails a confirmation link.
2. The link carries a random token; only its HMAC hash is stored.
3. Confirming activates the subscriber and sends a short "you're on the list" email.
4. Marketing emails include a secure unsubscribe link.
5. A Resend webhook updates `email_deliveries` and flips subscriber status on
   bounce/complaint/suppression. Transactional order emails are never affected
   by a marketing unsubscribe.

Order-confirmation email is built and tested but **not** sent yet: it only fires
from trusted server code once an order's `payment_status = 'paid'`, which
requires a payment provider (see below).

## Regenerating database types
```bash
npx supabase gen types typescript --project-id <project-ref> > src/types/database.ts
```

## Payments

No payment provider is wired up yet. When one is chosen, order confirmations must
be triggered only after a verified server-side payment event (e.g. a
signature-verified Stripe webhook for a completed payment) marks the order paid —
never from a browser success page.
