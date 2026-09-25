# SEO playbook — Geega Games

How Geega Games ranks for people **buying** and **selling** Magic: The Gathering
cards: nationwide by mail, locally in St. Louis, and in person within about a
6-hour drive. This file covers what the site does, the keywords each page
targets, and the off-site work that decides local rankings. The site can't
handle that off-site part on its own.

_Last updated: 2026-09-25_

---

## 1. What searchers type

Keyword research tools (Keyword Planner, Ahrefs, Semrush) weren't available
when this was written, so the clusters below come from search results,
competitor pages, and the questions sellers ask on forums. They're ranked by
intent and by how realistic it is to rank. Once Search Console has 4–8 weeks
of data, check them against real impressions.

### Selling, nationwide (mail-in)
| Query shape | Target page |
|---|---|
| sell mtg collection · sell magic the gathering collection · sell my magic cards | `/sell-my-collection` |
| sell magic cards · sell mtg cards online · where to sell magic cards · best place to sell mtg collection | `/sell-my-collection` |
| we buy magic cards · mtg collection buyer · magic card buyer | `/sell-my-collection` |
| mtg buylist · sell mtg singles · get an offer on magic cards | `/sell` |

Competitors: Card Kingdom, TCGplayer, Star City Games and big-store buylists
lead on price-per-card and mail-in. Geega can't win on buylist breadth. The
edge is **people instead of a spreadsheet**: unsorted collections are fine,
someone looks at every card, and **we come to you**. Mail-in buylists can't
offer that last one, and every sell page leads with it.

### Selling, St. Louis (meet up)
| Query shape | Target page |
|---|---|
| sell magic cards st louis · sell mtg cards st louis · sell magic collection st louis | `/sell-magic-cards/st-louis` |
| mtg buyer st louis · who buys magic cards in st louis | `/sell-magic-cards/st-louis` |
| sell magic cards near me · who buys mtg cards near me | **Google Business Profile** (map pack), then the St. Louis page |

"Near me" searches are decided almost entirely by the Google Business Profile
(proximity, relevance and prominence). The page supports it but can't rank in
the map pack on its own. See section 3.

### Selling, regional (we drive to you, ~6 hours)
| Query shape | Target page |
|---|---|
| sell magic cards kansas city · sell mtg collection chicago · sell magic cards nashville … | `/sell-magic-cards/<area>` |

There are 16 area pages: Columbia MO, Kansas City, Springfield MO, Springfield IL,
Peoria, Champaign–Urbana, Chicago, Indianapolis, Evansville, Louisville,
Nashville, Memphis, Little Rock, Tulsa, Des Moines and the Quad Cities. Each one
has its own drive time, route, nearby towns and written intro, so none of them
is a copy of another with the city name swapped.

**Doorway-page rule.** Only add an area the owner will really drive to. Write
its intro from scratch, and never bulk-generate city pages. Google's spam
policies penalize pages "targeted at specific regions or cities that funnel
users to one page". What keeps these pages safe is the real, place-specific
detail on each one. `tests/seoRoutes.test.ts` fails the build when two intros
are the same text with the city swapped.

### Selling, research stage (before they're ready)
| Query shape | Target page |
|---|---|
| how much is my mtg collection worth · how to tell if magic cards are valuable · are old magic cards worth anything | `/guides/how-much-is-my-mtg-collection-worth` |
| inherited magic cards · what to do with old magic card collection · sell estate mtg collection | `/guides/inherited-magic-card-collection` |
| sell mtg bulk · how to sell bulk magic cards · mtg bulk buylist | `/guides/how-to-sell-bulk-magic-cards` |

Most sellers start here. Guides also earn links, and AI answers (ChatGPT
search, Perplexity, Google AI Overviews) quote them, which now matters as much
as the blue links.

### Selling other things (referred to a buying partner)
| Query shape | Target page |
|---|---|
| sell pokemon cards st louis · sell pokemon cards · sell pokemon card collection | `/sell-pokemon-cards` |
| sell one piece cards · sell one piece tcg collection | `/sell-one-piece-cards` |
| sell video games st louis · sell retro games · sell video game collection | `/sell-video-games` |

Geega Games doesn't buy these categories itself. Each page says plainly that a
trusted buying partner makes the offer. The shared form (`ReferralLeadForm` →
`POST /api/referral-leads`) stores the lead in `referral_leads` and emails
`SELL_LEADS_NOTIFICATION_EMAIL` a message that can be forwarded to the partner as-is:
- it includes signed photo links that last 7 days;
- replying to it reaches the seller.

Sellers must tick a consent box before anything is shared. This is required by
the privacy policy, which now names the buying partner as a recipient.

Local competitors for these searches: PayMore's St. Louis pages, local game and
card shops, and Facebook Marketplace. Our angle is meetups instead of a store
visit, mixed or unsorted collections welcome, and shipping from anywhere.

### Buying
| Query shape | Target page |
|---|---|
| mtg singles · buy mtg singles online · cheap mtg singles | `/`, `/shop` |
| [card name] · buy [card name] · [card name] price | `/shop/card/<slug>` |
| [set name] singles | `/shop/set/<code>` |
| mtg singles st louis · magic the gathering store st louis | Google Business Profile + `/` |

Be realistic here: TCGplayer, Card Kingdom and Scryfall hold the organic
results for card names. The practical way a small shop gets card-name traffic
is **Google Merchant Center free listings** (Shopping tab and product
results). See section 4.

---

## 2. What the site does now (technical)

**The core fix: every page now ships its own HTML.** Before this change, the
site was a client-rendered SPA with one `index.html`. Every URL, including
`/sell-my-collection`, served the homepage's title and a canonical tag
pointing at the **homepage**, with an empty `<body>`. JavaScript rewrote it
afterward. Google's guidance says not to do this: a canonical in the raw HTML
that JavaScript later changes sends conflicting signals. Crawlers that don't
run JavaScript saw the homepage on every URL. That includes Bing in many cases,
GPTBot, ClaudeBot, PerplexityBot, and link previews in iMessage, Facebook and
Discord.

How it works now:

- `npm run build` runs `vite build`, then a `vite build --ssr` of
  `src/prerender.tsx`, then `scripts/prerender.ts`.
- Every route in `src/seo/routes.ts` is rendered to static HTML: header,
  content, footer, the page's own `<title>`, description, canonical, Open
  Graph and JSON-LD. The output is `dist/<route>/index.html`, and `vercel.json`
  rewrites each route to its file.
- Every other path (card and set pages, account, checkout, admin) gets
  `dist/spa.html`, a neutral shell with **no canonical**. The canonical that
  `useSEO` sets is then the only one, which is what Google recommends.
- The page metadata comes from each page's `useSEO(...)` call, so the static
  HTML and the live app can't disagree. The build fails if a registered route
  doesn't call `useSEO`.
- The browser still mounts with `createRoot`, so there's no hydration and no
  mismatch risk. The static markup gets swapped for identical live markup.

**Structured data**
- Site-wide: `OnlineStore` (`src/seo/site.ts`) with the service area. The
  homepage also gets `WebSite`, which gives Google the site name for results.
- Sell pages: `Service` + `areaServed`, `BreadcrumbList`, `FAQPage`.
- Guides: `Article` + `BreadcrumbList`.
- Card pages: `Product` + `AggregateOffer` (unchanged, client-side).
- `LocalBusiness` is deliberately not used: there's no walk-in address.

**Other**
- The sitemap is generated from the same route registry, and area pages and
  guides carry `<lastmod>`.
- `robots.txt` also blocks `/admin` and `/sell/offer` (private offer links).
- The footer has a **Sell** column (collection, St. Louis, guides), so every
  page links to the sell pages.
- The homepage H1 is now "Buy & sell Magic: The Gathering cards" instead of
  "…carefully curated". `/shop` gets an accessible H1.
- `/sell?handoff=local|ship` preselects how the seller wants to hand over the
  cards when they arrive from "Set up a meetup" or "Ship instead".

### Adding a page
1. Build the page and call `useSEO({ title, description, path, jsonLd })`.
2. Wire the route in `src/App.tsx`.
3. Add the path to `src/seo/routes.ts`.
4. Add a matching rewrite in `vercel.json` (the tests fail without one).

---

## 3. Off-site: this decides local rankings

Do these in order. Items 1–3 matter more than anything else in this document
for "st louis" and "near me" searches.

1. **Google Business Profile**, set up as a *service-area business*.
   - Hide the address (there's no storefront). Service areas: St. Louis city
     and county, St. Charles, Jefferson, St. Clair (IL) and Madison (IL)
     counties. Google says to keep service areas within about **2 hours**, so
     don't list Chicago or Nashville. Those are covered by the website's area
     pages.
   - Primary category: **Trading card store**. Secondary: *Hobby store*,
     *Collectibles store*, *Game store*.
   - Add Services: "Sell your Magic: The Gathering collection", "MTG
     collection buying — we come to you", "MTG singles". Add Products with
     photos.
   - Website: `https://geega-games.com/sell-magic-cards/st-louis` for the sell
     side, or the homepage.
   - Post weekly: a recent collection buy (with permission), new arrivals, an
     upcoming trip ("in Kansas City Oct 12, message us").
2. **Reviews.** Reviews carry the most weight in local rankings after the
   profile itself. Ask every seller and every buyer. A direct review link in
   the offer-accepted and order-delivered emails is a cheap follow-up (code
   task). Reply to every review.
3. **Consistent listings** with the same name, website and phone everywhere:
   Bing Places, Apple Business Connect (Apple Maps / Siri), Yelp and Facebook.
   Bing Places also feeds ChatGPT search and Copilot answers.
4. **Search Console + Bing Webmaster Tools.** Verify both, submit
   `https://geega-games.com/sitemap.xml`, and request indexing for
   `/sell-my-collection`, `/sell-magic-cards/st-louis` and the guides. After
   the next deploy, watch Search Console for "Duplicate, Google chose
   different canonical than user" dropping. That was the old bug.
5. **Links and mentions:**
   - Local game stores: they turn away big unsorted collections and bulk.
     Offer to take those (a referral arrangement), and ask for a mention on
     their site or Discord.
   - St. Louis MTG Facebook groups and Discords, r/StLouis (follow each
     community's self-promotion rules; be a member first).
   - Sponsor a local Commander night or tournament prize; event pages link
     back.
   - Short videos: "we drove 4 hours to buy this collection" / "what's in a
     $X estate collection". YouTube and TikTok rank in Google and build
     searches for your brand name.

---

## 4. Next technical steps (not done yet)

- **Google Merchant Center free listings.** Serve a product feed from
  inventory (for example `/api/merchant-feed`) so in-stock singles appear on
  the Shopping tab and in product results for card-name searches. This is the
  biggest buy-side opportunity.
- **Server-rendered card pages.** Google's merchant listing docs warn that
  JavaScript-generated Product markup makes Shopping crawls less reliable.
  Rendering `/shop/card/:slug` with its Product JSON-LD server-side (a Vercel
  function that fills `spa.html`) finishes what the prerender started.
- **Buying-trip schedule.** A small admin-managed list ("Kansas City —
  Oct 12") shown on the matching area page. It's real, changing content that
  gives each area page more unique value and gives sellers a reason to act.
- **Review request emails** (see section 3.2).
- **Data cleanup.** Some in-stock cards produce doubled slugs in the sitemap
  (`temple-garden-temple-garden`, `steam-vents-steam-vents`), and one card has
  two URLs (`ugin-eye-of-the-storms` and `ugin-eye-of-the-storms-ugin-eye-of-the-storms`).
  The inventory `card_name` for those rows looks like "Name // Name". Fix the
  rows so each card has one clean URL.

## 5. Content backlog (one new guide every 2–4 weeks)

- How to ship Magic cards safely (by value tier)
- Sell cards one by one vs. as a collection: which gets you more
- Local store vs. buylist vs. collection buyer: where to sell MTG
- The Reserved List, explained for non-players
- How to identify Alpha, Beta, Unlimited and Revised cards
- Selling sealed MTG product (booster boxes, old packs, precons)
- Most valuable cards from specific old sets (one page per set: Revised,
  4th Edition, Ice Age…). These are high-volume "is my card worth anything"
  searches.

## 6. Decisions for the owner

These change what the pages should say. Update the copy once they're settled:

- **Cash at meetups?** Pages say PayPal Goods & Services or store credit,
  because that's what the offer flow supports. "Sell magic cards for cash" is
  a real search, and meeting in person with cash is a strong pitch.
- **Minimum collection size for long trips?** The pages say we'll "talk
  through the collection first (a few photos) so the trip makes sense". If
  there's a real minimum, say so.
- **Small local sales:** the St. Louis page promises meetups for "a handful of
  good cards". Keep it or narrow it.
- **Bulk:** "What we buy" includes bulk commons and uncommons. Confirm you
  want to pay for bulk, not only accept it as part of a collection.
- **Drive times** are approximate (always "about"). Adjust any that don't
  match your real trips in `src/seo/sellAreas.ts`.
- **Public phone number and social profiles:** add them to Google Business
  Profile, and to `SITE_JSON_LD.sameAs` in `src/seo/site.ts`.
- The homepage newsletter box still says "Get the launch notice… the moment
  checkout goes live", but checkout is live. It needs new copy.
