# Geega Games — Admin Dashboard (Mock Phase) — Architecture & Handoff

This document describes the redesigned admin dashboard that now lives under
`src/admin/`. It is a **fully interactive front-end mock**: every screen works,
every workflow completes, but all data is in-memory and **no real emails are
sent, no database is written, and no destructive action touches production**.

The code is structured so the mock data layer can be swapped for real
Supabase + Vercel implementations **without touching a single page or
component**.

---

## 1. How to run it

```bash
npm install
npm run dev        # then open http://localhost:5173/admin_dashboard
```

- Storefront stays at `/`.
- Admin lives at `/admin_dashboard` (and `/admin` redirects to it).
- Verification: `npm run lint` (0 errors), `npm run test` (45 pass),
  `npm run build` (clean).

---

## 2. Routes & sections

The dashboard is a client-routed SPA mounted only for `/admin*` paths. It has
six sections, matching the spec:

| Section | Path | What it does |
|---|---|---|
| Overview | `/admin_dashboard` | KPIs, revenue/orders charts, "needs packing" & low-stock queues, recent activity, date-range toggle (7d/30d/90d/YTD) with period-over-period deltas. |
| Inventory | `/admin_dashboard/inventory` | Dense table with search, filters (stock/status/condition/finish/set), sortable columns, pagination, row selection + bulk bar, CSV export (real) & import (stubbed), Add-card drawer with printing search + **duplicate detection**, detail drawer with **movement-ledger** history and quantity adjustments. |
| Orders | `/admin_dashboard/orders` | Fulfillment-first tabs (**Needs packing** is the default/hero), order detail drawer with an **item-by-item packing checklist**, status workflow (paid → packing → ready → shipped), and a **ship modal** with carrier + tracking + customer-email preview. |
| Announcements | `/admin_dashboard/announcements` | Campaign list + editor with subject/preview/body/button/audience, live **desktop / mobile / plain-text** previews, recipient counts, save-draft, send-test, and send (all simulated with confirmations). |
| Users | `/admin_dashboard/users` | **Customers** sub-view (search/filter, detail, enable/disable) and **Staff** sub-view (invite, change role, disable) with safeguards: you can't demote/disable yourself as owner, and the store must always keep one active owner. |
| Trends | `/admin_dashboard/trends` | Revenue/orders trends, top cards/sets, sales by condition/finish (donuts), inventory value/cost basis/margin, aging buckets, newsletter growth, campaign performance, new vs repeat customers — all with accessible text summaries and date ranges. |

Deep links work: `?item=<id>` (inventory), `?order=<id>` (orders),
`?customer=<id>` (users) open the relevant detail. Global search (press `/`)
spans inventory, orders, and customers.

---

## 3. Directory map

```
src/admin/
  AdminApp.tsx            # root: routing + layout + page switch, wraps ToastProvider
  admin.css               # all styles, scoped under .gg-admin
  types/index.ts          # domain types, aligned 1:1 with Supabase enums
  data/                   # *.mock.ts seed data (the ONLY place fake data lives)
    inventory.mock.ts     # 12 real MTG printings, 14 inventory lines, ledger
    orders.mock.ts        # 7 orders across every status
    misc.mock.ts          # campaigns, customers, staff, analytics generators
    session.mock.ts       # the "signed-in" admin (replace with Supabase auth)
  repositories/
    types.ts              # repository INTERFACES (the swap seam)
    mock.ts               # in-memory implementations + __resetMockState()
    index.ts              # single place the app resolves repositories
  hooks/                  # useRouter, useAsync, useToast, useFocusTrap, useClickOutside
  components/
    ui/                   # Button, Badge, Card, Modal, Field, DataTable, Charts, …
    layout/               # Sidebar, TopBar, AdminLayout, GlobalSearch, PageHeader, nav
  pages/                  # one file per section (+ drawers/modals they own)
```

---

## 4. The swap seam (mock → real)

**Components never import mock data or `mock.ts` directly.** They import typed
repository instances from `src/admin/repositories/index.ts`:

```ts
import { inventoryRepository, orderRepository } from "../repositories";
```

`index.ts` currently binds those names to the mock implementations. To go live,
implement the same interfaces (in `repositories/types.ts`) against real data and
change only the assignments in `index.ts`:

```ts
export const inventoryRepository: InventoryRepository =
  supabaseInventoryRepository;          // reads via Supabase client (RLS)
export const orderRepository: OrderRepository =
  vercelOrderRepository;                // privileged writes via /api/admin/*
```

Because the interfaces are the contract and money/enums already match the DB,
no page or component needs to change.

---

## 5. Recommended Supabase schema

The mock types in `src/admin/types/index.ts` were written against the existing
`src/types/database.ts`. Existing tables (`cards`, `orders`, `order_items`,
`profiles`, `newsletter_subscribers`, `email_deliveries`) already cover much of
this. Recommended additions/extensions:

**New tables**

- `inventory_items` — one sellable line = printing + condition + finish.
  Columns mirror `InventoryItem`: `card_id`/printing ref, `condition`
  (`card_condition`), `finish` (`card_finish`), `quantity int`,
  `price_cents int`, `cost_cents int null`, `storage_location`, `sku`, `notes`,
  `status` (`active|inactive|archived`), `scryfall_price_cents`, timestamps.
  Unique index on `(printing_ref, condition, finish)` to enforce the
  dedupe rule the Add-card flow relies on.
- `inventory_movements` — **append-only ledger**. `inventory_item_id`,
  `delta int`, `previous_quantity`, `resulting_quantity`, `reason`
  (enum: `manual_add|manual_remove|correction|order_reserved|order_shipped|order_cancelled|import`),
  `related_order_id null`, `admin_id`, `created_at`. Quantity is **never**
  written directly — it's the running total of this ledger, so stock is always
  auditable.
- `campaigns` — matches `Campaign`: subject, preview_text, body, button,
  `audience` enum, `status` enum, recipient/delivered/bounce/open/click counts,
  `scheduled_at`, `sent_at`.
- `staff_members` (or extend `profiles` with a role) — `role`
  (`owner|administrator|fulfillment|inventory`), `status` (`active|disabled`).
- `admin_activity` — audit log of privileged actions for the Overview feed.

**Extensions to existing tables**

- `orders`: add `carrier`, `tracking_number`, `shipping_method`,
  `internal_notes`; you already have the status/payment enums used here.
- `order_items`: a `packed boolean default false` supports the packing
  checklist (or store packing state in a side table if you prefer immutable
  line items).

**RLS approach**

- Storefront/customer reads stay behind existing customer RLS.
- Admin reads: a `is_staff()` / `has_role()` security-definer function checks the
  caller's `staff_members` row; policies allow staff to select admin tables.
- Admin **writes** should not be done straight from the browser. Route them
  through Vercel Functions (below) using the service role, after verifying the
  caller's Supabase JWT and role server-side. This keeps privileged operations
  (inventory adjustments, shipping, sending campaigns, changing roles) out of
  client reach even if RLS is misconfigured.

---

## 6. Recommended Vercel endpoints

Privileged/side-effecting actions map cleanly to `/api/admin/*` functions:

| Endpoint | Replaces mock method |
|---|---|
| `POST /api/admin/inventory` | `inventory.create` |
| `PATCH /api/admin/inventory/:id` | `inventory.update` / `archive` |
| `POST /api/admin/inventory/:id/adjust` | `inventory.adjustQuantity` (writes a ledger row in a transaction) |
| `GET /api/admin/printings?q=` | `inventory.searchPrintings` (proxy Scryfall, cache results) |
| `POST /api/admin/orders/:id/status` | `orders.setStatus` |
| `POST /api/admin/orders/:id/pack` | `orders.toggleItemPacked` |
| `POST /api/admin/orders/:id/ship` | `orders.ship` (writes tracking, sends the **one** shipment email idempotently via the existing Resend service) |
| `POST /api/admin/campaigns` / `:id/send` | `campaigns.save` / `send` (batch send through Resend with rate limiting; store per-recipient delivery rows) |
| `POST /api/admin/staff/invite` etc. | `users.invite/setStaffRole/setStaffStatus` (re-check owner safeguards server-side) |

Guidelines carried over from the mock's design:

- **Idempotent shipment emails**: key the send on order id + "shipped" so a
  retry or double-click can't email the customer twice.
- **Campaign batching**: send in chunks, persist progress, and reflect
  `queued → sending → sent` so the UI's existing status badges stay accurate.
- **Ledger writes are transactional**: adjust quantity and insert the movement
  row in one transaction so the running total can never drift.

---

## 7. Accessibility, responsiveness, and safety

- Keyboard: focus-visible rings everywhere; modals/drawers trap focus, restore
  it on close, and close on Escape; global search on `/`.
- Screen readers: tables use `<caption>`, `scope`, and `aria-sort`; charts have
  text summaries / `aria-label`s; toasts are polite live regions; status uses
  badges **and** text, not color alone.
- Responsive: collapsible rail on desktop, off-canvas drawer nav under 860px,
  secondary table columns hide on small screens, drawers go full-width on phones.
- `prefers-reduced-motion` disables animations.
- All styles are scoped under `.gg-admin`, so nothing leaks into the storefront.
- The admin bundle is lazy-loaded — storefront visitors never download it.

---

## 8. What's mocked (and clearly labelled as such)

- Sending any email (campaigns, test sends, shipment confirmations) — simulated.
- CSV **import** — parses/validates in the real version; here it's a stub that
  writes nothing. CSV **export** is real (downloads current rows).
- Sign-out and a couple of secondary buttons show an informational toast.
- The "signed-in" admin comes from `data/session.mock.ts`.

Everything else — filtering, sorting, pagination, quantity adjustments with
ledger entries, the full packing→shipping workflow, campaign status transitions,
role/status changes with safeguards, and all analytics — runs against the
in-memory repositories and behaves as it will in production.

---

## 9. Files changed / added

**Added**

- `src/admin/**` — the entire dashboard (types, data, repositories, hooks,
  components, pages, `admin.css`).
- `tests/adminRepositories.test.ts` — 16 tests for the repository behaviors.

**Modified**

- `src/main.tsx` — mounts the admin app (lazy) for `/admin*`; storefront path
  unchanged.
- `vercel.json` — SPA rewrite so deep links / refresh work under
  `/admin_dashboard`, with `/api/*` explicitly excluded.

**Not touched** — the storefront app, its components, and the API routes.

---

## 10. Test / build results

- `npm run lint` — 0 errors (12 non-blocking warnings, mostly the standard
  "setState in effect" data-loading pattern).
- `npm run test` — 45 passing (29 pre-existing + 16 new admin tests).
- `npm run build` — succeeds; admin ships as a separate ~33 kB gzipped chunk.
