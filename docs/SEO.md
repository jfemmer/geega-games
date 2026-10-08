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
| where to sell magic cards · best place to sell mtg cards · tcgplayer vs ebay vs buylist | `/guides/where-to-sell-magic-cards` |
| are my old pokemon cards worth anything · how to tell if pokemon cards are valuable | `/guides/are-my-old-pokemon-cards-worth-anything` |
| are my old video games worth money · what old games are worth money | `/guides/are-my-old-video-games-worth-money` |

The guides index (`/guides`) is grouped by topic (`GuideMeta.topic`), and each
sell page links to its own topic's guides (`SellerGuidesSection topic=…`). The
Pokémon and video game guides end with the buying-partner pitch, never "we buy".
Dated facts (marketplace fees, grading prices and waits) say when they were
true, and should be rechecked when the guide's `updated` date is bumped.

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

Each page also has one research section for what most worries that seller
(`insight` in `src/seo/referralPages.ts`): grading for Pokémon, reprint price
swings for One Piece, lowball big-box trade-in offers for video games. Leads are
tracked in the admin **Partner Leads** page (New → Sent to partner → Closed),
which can also copy a lead's details, with 7-day photo links, to text to the
partner.

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
- Card and set pages (`/shop/card/:slug`, `/shop/set/:code`) depend on live
  inventory, so they can't be prerendered. `api/catalog-page.ts` answers them:
  it looks the card or set up and writes the page's own title, description,
  canonical, share-preview image (the card's picture) and product JSON-LD
  into the HTML before sending it, plus a plain summary for readers without
  JavaScript (with the card's picture). The tags come from
  `src/seo/catalog.ts`, the same builders the React pages pass to `useSEO`,
  so the two can't disagree. A card that isn't listed, or a set with nothing
  in stock, is a real **404**. Answers are cached at Vercel's edge for five
  minutes. If the lookup fails, the page falls back to the plain shell and
  the app loads it as before.
- **Every copy for sale has its own address:** `/shop/card/<slug>?listing=<id>`
  (the inventory item's id). It opens the card's page with that copy listed
  first, marked "Selected", and its picture shown — what Google asks of a
  product variant's address. The canonical address is still the card's own
  page. The structured data and the product feed link each copy there.
- A card page's HTML also tells the browser to start fetching the card's
  picture straight away (`<link rel="preload">`, the same files the page's
  `<img>` asks for), and the `<img>` has `fetchpriority="high"`: the picture
  is the largest thing on a phone screen, so this is what makes it appear
  sooner (Largest Contentful Paint).
- App-only pages (login, account, checkout, order tracking… — the list is
  `APP_SHELL_ROUTES` in `src/seo/appRoutes.ts`) get `dist/spa.html`, a neutral
  shell with **no canonical**. The canonical that `useSEO` sets is then the
  only one, which is what Google recommends. All but `/track-order` are also
  sent with `X-Robots-Tag: noindex`.
- **There is no catch-all.** An address nothing above claims gets
  `dist/404.html` with a real 404 status, so a mistyped or retired URL can't
  come back "200 OK" looking like the homepage (a "soft 404"). The build
  fails if `vercel.json` doesn't serve a page in the registries
  (`scripts/vercelRoutes.ts`), because the local dev server answers every
  address and would hide the mistake.
- One card, one address. A card page is found by the card's Scryfall oracle
  id, and its address is the slug of its name. "Reversible" printings (the
  same card on both sides) come from Scryfall with no top-level oracle id and
  a doubled name ("Steam Vents // Steam Vents"); `scryfallOracleId` and
  `scryfallCardName` in `src/admin/services/scryfall.ts` read them from the
  faces, so such a printing joins the card's one page instead of getting a
  second, broken one. The sitemap only lists cards that have an oracle id.
- The addresses of the site that used to be on this domain (`/sell.html`,
  `/tradeIn.html`, `/images/logo.png`…) redirect permanently to the pages
  that replaced them, and a trailing slash redirects to the address without
  one. Both are in `vercel.json` under `redirects`.
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
- Site-wide, on the same `OnlineStore`: **shipping** (`hasShippingService`:
  plain envelope $1.50 and tracked $5.50 below $75, tracked free from $75,
  handled within 2 business days, Monday–Saturday, US only) and **returns**
  (`hasMerchantReturnPolicy`, a link to `/returns`: returns are for our
  mistakes only, which none of the markup's return categories can say without
  overstating it). Built from the same constants checkout and the policy pages
  use (`src/store/lib/money.ts`, `src/store/lib/storePolicies.ts`). Google
  shows these with products ("Free shipping"). Settings entered in Merchant
  Center or Search Console outrank this markup; keep them identical.
- Card pages: one **`Offer` per listing**, in the HTML the server sends
  (`api/catalog-page.ts`) — a `Product` when one copy is for sale, a
  `ProductGroup` with one variant `Product` per copy (own SKU, picture, price
  and `?listing=` address) when there are several — plus `BreadcrumbList`.
  Prices are numbers; condition is `UsedCondition` (see section 6). There is
  no `AggregateOffer` (a price range): Google's merchant listings require an
  `Offer` and say not to describe variants with `AggregateOffer`. A sold-out
  card has no product markup (its page is `noindex`). Set pages:
  `BreadcrumbList`.
- `LocalBusiness` is deliberately not used: there's no walk-in address.

**Other**
- The sitemap is generated from the same route registry, and area pages and
  guides carry `<lastmod>`. Card and set pages carry it too: the last time one
  of their listings changed (`inventory_items.updated_at` — added, repriced,
  sold down), never "now". Bump a content page's `lastmod` in
  `src/seo/routes.ts` when its copy changes meaningfully.
- **Thin set pages are `noindex`.** A set with fewer than 2 in-stock listings
  (`MIN_INDEXABLE_SET_LISTINGS` in `src/seo/catalog.ts`) only repeats that
  card's page, so it asks not to be indexed and the sitemap leaves it out (the
  same rule in both places). It's indexable again as soon as a second listing
  arrives.
- **One host.** Vercel itself answers every address on
  `geega-games.vercel.app` with a permanent (301) redirect to the same address
  on `geega-games.com`, query string included (checked 2026-10-08), so the
  duplicate host needs nothing in `vercel.json`. `www.geega-games.com` is
  redirected by the domain settings in Vercel too, but with a temporary 307
  (see section 4b).
- **Speed.** The fingerprinted files in `/assets/` are cached for a year
  (`immutable`; a changed file gets a new name). The logo is 600×480 and about
  60 KB (it was 1.7 MB, and it's on every page and in every email). The
  favicons are PNGs of the dog head (16 to 192 pixels, plus `/favicon.ico`):
  the old 3.8 MB SVG was downloaded by every browser that supports SVG icons,
  and Google Search doesn't show SVG favicons at all.
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
3. Tell the site how to serve it:
   - a content page: add the path to `src/seo/routes.ts` (it gets prerendered
     and listed in the sitemap) and a rewrite to its `index.html` in
     `vercel.json`;
   - an app-only page (needs sign-in, or has nothing to prerender): add it to
     `APP_SHELL_ROUTES` in `src/seo/appRoutes.ts` and a rewrite to `/spa.html`
     in `vercel.json`, plus a `noindex` header rule unless it belongs in
     `INDEXABLE_APP_SHELL_ROUTES`.

Without step 3 the page works in local dev and is a 404 on the live site.
The build and `tests/vercelRouting.test.ts` both fail first and say which
address is missing.

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

## 4. Product feed: free listings on Google and Bing

`https://geega-games.com/feeds/products.xml` (`api/merchant-feed.ts`,
`api/_lib/merchantFeed.ts`) lists every copy for sale in the format Google
Merchant Center reads (RSS 2.0, Google's `g:` attributes), and Microsoft
Merchant Center reads the same file. With it, in-stock singles can show in
the **free** product listings: Google Search, the Shopping tab, Images, and
Bing's Shopping tab. It costs nothing; expect a little traffic at first, mostly
for specific printings and older sets rather than popular card names.

What's in each item: the listing's id, a title (card — Magic: The Gathering —
set #number, condition, finish), a plain description of the card, the
`?listing=` link, the Scryfall picture at the large size (672×936; Google's
500×500 minimum applies from 2027-01-31), `in stock`, the price checkout
charges, `condition` `used`, brand "Magic: The Gathering", `identifier_exists`
`no` (singles have no barcode), and `item_group_id` (the card's oracle id)
when a card has several copies for sale. Shipping and tax are **not** in the
file: they're set once in each account. If the inventory can't be read in
full the feed answers 503 rather than a short list, because Merchant Center
removes every product missing from a fetched file.

**Owner setup (one time):**
1. **Search Console first**, if it isn't set up: add a *Domain* property for
   `geega-games.com` (DNS verification), submit `/sitemap.xml`. Merchant
   Center can then claim the site without another verification.
2. **Google Merchant Center** (merchants.google.com): create the account for
   Geega Games LLC; verify and claim `https://geega-games.com`; enter the
   business details with the **real business address** (Google's
   misrepresentation policy bans a false or virtual address; the site and the
   Business Profile can still keep it hidden — check what Merchant Center
   makes public before saving).
3. **Shipping** (Settings → Shipping and returns): US only; handling 0–2
   business days, Monday–Saturday; two services — "Plain white envelope" $1.50
   for orders under $75, and "Tracked" $5.50 under $75 / free from $75. Add a
   transit time only if you're comfortable promising it.
4. **Returns:** return policy URL `https://geega-games.com/returns`, and the
   "defective items only" option with the 14-day window if offered.
5. **Tax:** add Missouri (and any other state where checkout collects sales
   tax), matching what checkout charges.
6. **Products → Add products → From a file → scheduled fetch** of
   `https://geega-games.com/feeds/products.xml`, daily (choose an early-morning
   hour). Check *Diagnostics* after the first fetch.
7. **Microsoft Merchant Center** (in Microsoft Advertising): create a store
   for `geega-games.com` (verify through Bing Webmaster Tools), then add a
   feed by *scheduled download* of the same URL. Approved products show free
   in Bing's Shopping tab.

**Keeping it honest:** Merchant Center fetches at most once a day, so a single
that sells can show as available until the next fetch. Google's "automatic
item updates" (on by default) read each page's markup to correct price and
availability in between; leave them on. If listings start getting
"mismatched availability" warnings, the next step is the Merchant API (it
replaces the Content API for Shopping, which reached its sunset on
2026-08-18): update a product the moment it sells. That needs a Google Cloud
project the owner creates.

## 4b. Next technical steps (not done yet)

- **www redirect status.** `www.geega-games.com` redirects to
  `geega-games.com` with a *temporary* 307, which Google doesn't treat as a
  canonical signal. In Vercel → Project → Settings → Domains →
  `www.geega-games.com` → Edit, set the redirect to **308 Permanent**. (No
  code can change this: domain redirects run before `vercel.json`.)
- **Card page content in the HTML.** The tags and product JSON-LD of
  `/shop/card/:slug` are written server-side (`api/catalog-page.ts`), which
  is what Google's merchant listing docs ask for. The visible page is still
  drawn by the app; only a plain `<noscript>` summary is in the HTML. Rendering
  the full card page on the server would give crawlers that don't run
  JavaScript the complete page too.
- **Buying-trip schedule.** A small admin-managed list ("Kansas City —
  Oct 12") shown on the matching area page. It's real, changing content that
  gives each area page more unique value and gives sellers a reason to act.
- **Review request emails** (see section 3.2).

### What makes sellers convert (seller research, 2026-09-25)

What the Magic sell pages now do about the things sellers worry about most:
- **Easy first step:** a one-screen quick photo quote (`QuickPhotoQuote`,
  `#quick-quote`) creates a normal Buying Leads submission tagged
  `source = 'quick_quote'`. Sellers who want to list cards one by one still
  use `/sell`.
- **Trust:** a "What you can count on" box (`TrustSection`) covers protected
  payment (PayPal Goods & Services or store credit), no obligation, a real
  person looking at every card, and the published condition guide.
- **Store credit:** the +20% store credit badge (`STORE_CREDIT_BONUS_PERCENT`)
  sits in each Magic page's hero.
- **Meetup safety:** real police and campus safe-exchange spots, with source
  links, on St. Louis, Kansas City and Springfield (`safeSpots` in
  `src/seo/sellAreas.ts`), plus anti-scam payment tips.
  - The St. Louis meetup list names Washington, MO at the owner's request.
  - Washington has no official exchange zone, so the nearby Union Police
    Department lobby is the listed spot.
  - `tests/prerender.test.tsx` fails if Washington, MO is dropped.
- **Urgency without pressure:** a "Why a current offer matters" section
  covers reprint risk.
- **Phones:** a sticky "Get my free offer" bar (`StickySellCta`) hides while
  the form is on screen.

### Wording pass (seller research, 2026-09-27)

Sellers' biggest worries, across Magic, Pokémon, One Piece and video games:
- lowball offers;
- not knowing what they have;
- the work of listing everything;
- meeting strangers from Marketplace;
- fees and returns;
- offers that change after the cards arrive.

What they praise is a buyer who explains, communicates and pays. The pages now
answer those worries in plain words:
- **First screen:** a short checklist of promises (`HeroPoints`), the real
  TCGplayer rating linking to the reviews (`ShopRatingLine` → `#reviews`), and
  one main button, "Get my free offer", repeated in the sticky bar and at the
  end.
- **Order:** the steps and trust points come before the form. The
  Pokémon/One Piece cross-sell sits after the Magic page's form, not right
  under it.
- **Referral pages:**
  - The partner setup is explained up front: "a buyer we know, not a
    stranger".
  - "Why not just sell it yourself?" is an honest comparison with listing it
    yourself.
  - "How to tell if an offer is fair" covers sold vs. asking prices, and why
    any reseller pays less.
  - New FAQs match what sellers search: "are my old … worth anything",
    rotation, games without cases, untested consoles, a relative's collection.
- **Forms:**
  - Optional fields say why they're asked (phone, ZIP).
  - A positive privacy line sits by the button ("we never sell your details").
  - The success message lists "What happens next".
- **Claims removed:**
  - "Specializes in" and "prices by what collectors pay" were claims about the
    partner that nobody had approved.
  - "Priced by barcode" had no source.
  - "Pays very competitively" is now the approved wording, "buys very
    competitively".

Before adding claims, remember the content rule: no payout percentages, and no
turnaround or reply-time promises, until the owner confirms them (section 6).

## 5. Content backlog (one new guide every 2–4 weeks)

- How to ship Magic cards safely (by value tier)
- Sell cards one by one vs. as a collection: which gets you more
- The Reserved List, explained for non-players
- How to identify Alpha, Beta, Unlimited and Revised cards
- Selling sealed MTG product (booster boxes, old packs, precons)
- Most valuable cards from specific old sets (one page per set: Revised,
  4th Edition, Ice Age…). These are high-volume "is my card worth anything"
  searches.

## 6. Decisions for the owner

These change what the pages should say. Update the copy once they're settled:

- **Condition in Google's terms.** Listings are described to Google as
  `used` (feed) / `UsedCondition` (page markup). Google's `new` means "in its
  original packaging, and has not been opened", which a loose single isn't,
  whatever its grade; the grade (Near Mint…) is in every listing's title. One
  constant changes both: `LISTING_CONDITION` in `src/seo/catalog.ts`.
- **Card pictures.** Listings use Scryfall's scans, which show the card, not
  the copy. Google asks for "the exact item being sold"; for Near Mint copies
  that's close, for played copies and foils less so. Real photos of played or
  expensive copies would be the safer choice over time. Scryfall's terms
  cover "community content" and say nothing about shops.
- **TCGplayer stays separate.** TCGplayer's seller agreement bars steering
  marketplace buyers to another site and marketing to them (inserts, emails),
  on pain of suspension. Don't put the website in TCGplayer orders, and don't
  add TCGplayer buyers to the email list.

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
- **PayPal fee:** PayPal usually charges the person *receiving* a Goods &
  Services payment, which here is the seller. The where-to-sell guide says a
  collection buyer means "no fees". Either cover the fee or disclose it.
- **Reply time and payment timing (Magic):** both Card Kingdom and Star City
  Games publish these. If you have a typical reply time, it's one of the
  strongest things the page could add.
- **The buying partner:** these would be the most persuasive additions to the
  referral pages, but only the partner can confirm them:
  - how they pay (cash at meetups?) and how fast;
  - how quickly they reach out;
  - whether they send prepaid shipping labels, and who pays return shipping
    if an offer changes;
  - whether they take bulk, loose games and broken consoles;
  - whether they can be named, with years in business.
