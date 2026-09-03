// MOCK DATA — not from the production database.

import type {
  AdminActivity,
  Campaign,
  Customer,
  DateRangeKey,
  OverviewMetrics,
  StaffMember,
  TimeSeriesPoint,
  TrendMetrics,
} from "../types";

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600000).toISOString();

/* -------------------------- Campaigns -------------------------- */

export const CAMPAIGNS_SEED: Campaign[] = [
  {
    id: "cmp_1",
    name: "Modern Horizons 3 restock",
    subject: "Fresh MH3 singles just landed",
    previewText: "New staples in stock — grab them before they're gone.",
    body:
      "We just added a big batch of Modern Horizons 3 singles to the shop, " +
      "including the staples you've been asking about. Stock is limited, so " +
      "have a look while the good stuff is still here.",
    buttonText: "Browse new arrivals",
    buttonUrl: "https://geega-games.com/",
    audience: "active_subscribers",
    status: "sent",
    recipientCount: 842,
    deliveredCount: 828,
    bounceCount: 9,
    openCount: 396,
    clickCount: 141,
    createdAt: daysAgo(12),
    sentAt: daysAgo(11),
    scheduledAt: null,
  },
  {
    id: "cmp_2",
    name: "Weekend Commander sale",
    subject: "20% off Commander staples this weekend",
    previewText: "Two days only — stock up on your deck's backbone.",
    body:
      "This weekend only, take 20% off a hand-picked set of Commander " +
      "staples. From ramp to removal, it's a good moment to round out a deck.",
    buttonText: "Shop the sale",
    buttonUrl: "https://geega-games.com/",
    audience: "active_subscribers",
    status: "sending",
    recipientCount: 851,
    deliveredCount: 512,
    bounceCount: 4,
    openCount: 210,
    clickCount: 63,
    createdAt: daysAgo(1),
    sentAt: null,
    scheduledAt: null,
  },
  {
    id: "cmp_3",
    name: "Holiday hours + shipping cutoff",
    subject: "Order by Dec 18 for holiday delivery",
    previewText: "Our shipping cutoff and holiday hours, all in one place.",
    body:
      "A quick heads-up on holiday shipping cutoffs and our adjusted hours " +
      "so your cards arrive in time.",
    buttonText: null,
    buttonUrl: null,
    audience: "active_subscribers",
    status: "draft",
    recipientCount: 851,
    deliveredCount: 0,
    bounceCount: 0,
    openCount: null,
    clickCount: null,
    createdAt: daysAgo(2),
    sentAt: null,
    scheduledAt: null,
  },
  {
    id: "cmp_4",
    name: "Buylist bump — dual lands",
    subject: "We're paying more for your dual lands",
    previewText: "Buylist prices are up on a bunch of lands.",
    body:
      "Our buylist prices just went up on original dual lands and shock " +
      "lands. If you've been sitting on extras, now's a good time to sell.",
    buttonText: "See buylist",
    buttonUrl: "https://geega-games.com/",
    audience: "confirmed_recent",
    status: "queued",
    recipientCount: 604,
    deliveredCount: 0,
    bounceCount: 0,
    openCount: null,
    clickCount: null,
    createdAt: hoursAgo(5),
    sentAt: null,
    scheduledAt: hoursAgo(-19),
  },
  {
    id: "cmp_5",
    name: "March newsletter",
    subject: "What's new at Geega this month",
    previewText: "New arrivals, events, and a few staff picks.",
    body:
      "Here's a roundup of what's new this month: fresh arrivals, upcoming " +
      "in-store events, and a few staff picks worth a look.",
    buttonText: "Read more",
    buttonUrl: "https://geega-games.com/",
    audience: "active_subscribers",
    status: "failed",
    recipientCount: 830,
    deliveredCount: 118,
    bounceCount: 2,
    openCount: 44,
    clickCount: 9,
    createdAt: daysAgo(30),
    sentAt: daysAgo(30),
    scheduledAt: null,
  },
];

/* -------------------------- Customers -------------------------- */

export const CUSTOMERS_SEED: Customer[] = [
  {
    id: "cus_1",
    firstName: "Alex",
    lastName: "Rivera",
    email: "alex.rivera@example.com",
    createdAt: daysAgo(120),
    lastSignInAt: hoursAgo(6),
    orderCount: 7,
    lifetimeSpendCents: 41850,
    lastOrderAt: hoursAgo(6),
    accountStatus: "active",
    subscriberStatus: "active",
  },
  {
    id: "cus_2",
    firstName: "Morgan",
    lastName: "Lee",
    email: "morgan.lee@example.com",
    createdAt: daysAgo(200),
    lastSignInAt: hoursAgo(20),
    orderCount: 12,
    lifetimeSpendCents: 98230,
    lastOrderAt: hoursAgo(20),
    accountStatus: "active",
    subscriberStatus: "active",
  },
  {
    id: "cus_3",
    firstName: "Priya",
    lastName: "Nair",
    email: "priya.nair@example.com",
    createdAt: daysAgo(75),
    lastSignInAt: hoursAgo(28),
    orderCount: 3,
    lifetimeSpendCents: 12440,
    lastOrderAt: hoursAgo(28),
    accountStatus: "active",
    subscriberStatus: "pending",
  },
  {
    id: "cus_4",
    firstName: "Devin",
    lastName: "Brooks",
    email: "devin.brooks@example.com",
    createdAt: daysAgo(310),
    lastSignInAt: daysAgo(2),
    orderCount: 18,
    lifetimeSpendCents: 156700,
    lastOrderAt: daysAgo(2),
    accountStatus: "active",
    subscriberStatus: "active",
  },
  {
    id: "cus_5",
    firstName: "Casey",
    lastName: "Kim",
    email: "casey.kim@example.com",
    createdAt: daysAgo(45),
    lastSignInAt: daysAgo(3),
    orderCount: 2,
    lifetimeSpendCents: 3890,
    lastOrderAt: daysAgo(3),
    accountStatus: "active",
    subscriberStatus: "unsubscribed",
  },
  {
    id: "cus_6",
    firstName: "Taylor",
    lastName: "Reed",
    email: "taylor.reed@example.com",
    createdAt: daysAgo(500),
    lastSignInAt: daysAgo(5),
    orderCount: 24,
    lifetimeSpendCents: 213400,
    lastOrderAt: daysAgo(9),
    accountStatus: "active",
    subscriberStatus: "active",
  },
  {
    id: "cus_7",
    firstName: "Jamie",
    lastName: "Fox",
    email: "jamie.fox@example.com",
    createdAt: daysAgo(60),
    lastSignInAt: daysAgo(6),
    orderCount: 1,
    lifetimeSpendCents: 0,
    lastOrderAt: daysAgo(6),
    accountStatus: "disabled",
    subscriberStatus: "bounced",
  },
  {
    id: "cus_8",
    firstName: "Robin",
    lastName: "Shah",
    email: "robin.shah@example.com",
    createdAt: daysAgo(15),
    lastSignInAt: daysAgo(1),
    orderCount: 0,
    lifetimeSpendCents: 0,
    lastOrderAt: null,
    accountStatus: "active",
    subscriberStatus: "active",
  },
];

/* -------------------------- Staff -------------------------- */

export const STAFF_SEED: StaffMember[] = [
  {
    id: "stf_1",
    firstName: "Jordan",
    lastName: "Vega",
    email: "jordan@geega-games.com",
    role: "owner",
    status: "active",
    lastActiveAt: hoursAgo(1),
    recentActivity: [
      { id: "sa_1", action: "Shipped order GG-1038", at: hoursAgo(8) },
      { id: "sa_2", action: "Refunded order GG-1030", at: daysAgo(5) },
    ],
  },
  {
    id: "stf_2",
    firstName: "Sam",
    lastName: "Okafor",
    email: "sam@geega-games.com",
    role: "fulfillment",
    status: "active",
    lastActiveAt: hoursAgo(3),
    recentActivity: [
      { id: "sa_3", action: "Started packing GG-1040", at: hoursAgo(3) },
      { id: "sa_4", action: "Marked GG-1039 ready to ship", at: hoursAgo(5) },
    ],
  },
  {
    id: "stf_3",
    firstName: "Riley",
    lastName: "Chen",
    email: "riley@geega-games.com",
    role: "inventory",
    status: "active",
    lastActiveAt: daysAgo(1),
    recentActivity: [
      { id: "sa_5", action: "Imported 40 cards via CSV", at: daysAgo(1) },
    ],
  },
  {
    id: "stf_4",
    firstName: "Dana",
    lastName: "Wolfe",
    email: "dana@geega-games.com",
    role: "administrator",
    status: "disabled",
    lastActiveAt: daysAgo(60),
    recentActivity: [],
  },
];

/* -------------------------- Admin activity -------------------------- */

export const ADMIN_ACTIVITY_SEED: AdminActivity[] = [
  {
    id: "act_1",
    actor: "Sam Okafor",
    action: "started packing",
    target: "GG-1040",
    at: hoursAgo(3),
  },
  {
    id: "act_2",
    actor: "Sam Okafor",
    action: "marked ready to ship",
    target: "GG-1039",
    at: hoursAgo(5),
  },
  {
    id: "act_3",
    actor: "Jordan Vega",
    action: "shipped",
    target: "GG-1038",
    at: hoursAgo(8),
  },
  {
    id: "act_4",
    actor: "Riley Chen",
    action: "added inventory",
    target: "Atraxa, Grand Unifier",
    at: daysAgo(1),
  },
  {
    id: "act_5",
    actor: "Jordan Vega",
    action: "sent campaign",
    target: "Modern Horizons 3 restock",
    at: daysAgo(11),
  },
];

/* -------------------------- Analytics -------------------------- */

/** Deterministic pseudo-random series so the mock is stable across renders. */
function series(days: number, base: number, variance: number, seed: number): TimeSeriesPoint[] {
  const out: TimeSeriesPoint[] = [];
  let s = seed;
  for (let i = days - 1; i >= 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const rnd = s / 233280;
    const weekendBoost = [0, 6].includes(new Date(now - i * 86400000).getDay())
      ? 1.25
      : 1;
    const value = Math.max(0, Math.round((base + (rnd - 0.5) * variance) * weekendBoost));
    out.push({ date: new Date(now - i * 86400000).toISOString().slice(0, 10), value });
  }
  return out;
}

const DAYS_FOR: Record<DateRangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  ytd: Math.max(
    1,
    Math.round((now - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000),
  ),
};

export function overviewMetricsFor(range: DateRangeKey): OverviewMetrics {
  const days = DAYS_FOR[range];
  const rev = series(days, 32000, 26000, 11);
  const prevRev = series(days, 27000, 24000, 29);
  const revenueCents = rev.reduce((a, p) => a + p.value, 0);
  const revenuePrevCents = prevRev.reduce((a, p) => a + p.value, 0);
  const orders = series(days, 7, 6, 5);
  const orderCount = orders.reduce((a, p) => a + p.value, 0);
  const orderCountPrev = Math.round(orderCount * 0.86);
  return {
    ordersNeedingPacking: 2,
    ordersReadyToShip: 1,
    ordersShippedToday: 1,
    revenueCents,
    revenuePrevCents,
    orderCount,
    orderCountPrev,
    averageOrderValueCents: Math.round(revenueCents / Math.max(1, orderCount)),
    averageOrderValuePrevCents: Math.round(
      revenuePrevCents / Math.max(1, orderCountPrev),
    ),
    totalInventoryUnits: 112,
    lowStockCount: 4,
    activeCustomers: 6,
    activeSubscribers: 851,
  };
}

export function overviewSeriesFor(range: DateRangeKey): {
  revenue: TimeSeriesPoint[];
  orders: TimeSeriesPoint[];
} {
  const days = DAYS_FOR[range];
  return {
    revenue: series(days, 32000, 26000, 11),
    orders: series(days, 7, 6, 5),
  };
}

export function trendMetricsFor(range: DateRangeKey): TrendMetrics {
  const days = DAYS_FOR[range];
  const revenueSeries = series(days, 32000, 26000, 11);
  const orderSeries = series(days, 7, 6, 5);
  const revenue = revenueSeries.reduce((a, p) => a + p.value, 0);
  const orders = orderSeries.reduce((a, p) => a + p.value, 0);
  const inventoryValueCents = 486500;
  const costBasis = 341200;
  return {
    revenueSeries,
    orderSeries,
    averageOrderValueCents: Math.round(revenue / Math.max(1, orders)),
    unitsSold: Math.round(orders * 2.4),
    topCards: [
      { label: "Ragavan, Nimble Pilferer", value: 21, secondary: 115479 },
      { label: "Sheoldred, the Apocalypse", value: 14, secondary: 101500 },
      { label: "Orcish Bowmasters", value: 12, secondary: 35988 },
      { label: "Thoughtseize", value: 11, secondary: 19789 },
      { label: "Fable of the Mirror-Breaker", value: 9, secondary: 22491 },
    ],
    topSets: [
      { label: "Modern Horizons 2", value: 58, secondary: 214300 },
      { label: "Dominaria United", value: 31, secondary: 142600 },
      { label: "The Lord of the Rings", value: 27, secondary: 88900 },
      { label: "Kamigawa: Neon Dynasty", value: 19, secondary: 51200 },
    ],
    salesByCondition: [
      { label: "NM", value: 68 },
      { label: "LP", value: 21 },
      { label: "MP", value: 8 },
      { label: "HP", value: 2 },
      { label: "DMG", value: 1 },
    ],
    salesByFinish: [
      { label: "Nonfoil", value: 74 },
      { label: "Foil", value: 21 },
      { label: "Etched", value: 4 },
      { label: "Glossy", value: 1 },
    ],
    inventoryValueCents,
    estimatedCostBasisCents: costBasis,
    estimatedGrossMarginCents: inventoryValueCents - costBasis,
    lowStockCount: 4,
    agingInventory: [
      { label: "0–30 days", value: 62 },
      { label: "31–60 days", value: 28 },
      { label: "61–90 days", value: 14 },
      { label: "90+ days", value: 8 },
    ],
    newCustomers: Math.round(orders * 0.4),
    repeatCustomers: Math.round(orders * 0.6),
    newsletterGrowth: series(days, 6, 5, 7).map((p, i, arr) => ({
      date: p.date,
      value: 780 + arr.slice(0, i + 1).reduce((a, q) => a + q.value, 0),
    })),
    campaignPerformance: [
      { label: "MH3 restock", value: 47, secondary: 17 },
      { label: "Commander sale", value: 41, secondary: 12 },
      { label: "March newsletter", value: 37, secondary: 8 },
    ],
  };
}
