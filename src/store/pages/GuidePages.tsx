import type { ReactNode } from "react";
import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { NotFoundPage } from "./StaticPages";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import { GUIDES, findGuide, guidePath, type GuideMeta, type GuideTopic } from "../../seo/guides";
import { ST_LOUIS_PATH, sellFormPath } from "../../seo/sellAreas";
import { MAX_DRIVE_HOURS, ORGANIZATION_ID, absoluteUrl, breadcrumbJsonLd } from "../../seo/site";

// Seller guides: /guides and /guides/:slug. These answer the questions people
// search BEFORE they're ready to sell ("how much is my mtg collection worth",
// "are my old pokemon cards worth anything", "where to sell magic cards"),
// which is where most sellers start. Metadata is in src/seo/guides.ts; each
// guide's `topic` decides which sell page its call-to-action points to.
//
// Keep every factual claim here verifiable: no card prices, no payout
// percentages (owner's rule). Anything that can change (marketplace fees,
// grading costs) is dated in the text — re-check it when you bump `updated`.

const TOPIC_HEADINGS: Record<GuideTopic, string> = {
  mtg: "Magic: The Gathering",
  pokemon: "Pokémon",
  video_games: "Video games",
};

/** The end-of-article pitch, matched to who actually buys that category. */
function GuideCta({ topic }: { topic: GuideTopic }) {
  if (topic === "pokemon") {
    return (
      <aside className="gg-collect-cta">
        <h2>Ready to sell your Pokémon cards?</h2>
        <p>
          We&rsquo;ll connect you with the trusted buyer we work with, who buys very competitively —
          meet up around St. Louis, or ship from anywhere in the US.
        </p>
        <Link to="/sell-pokemon-cards" className="gg-btn">
          Sell your Pokémon cards
        </Link>
      </aside>
    );
  }
  if (topic === "video_games") {
    return (
      <aside className="gg-collect-cta">
        <h2>Ready to sell your video games?</h2>
        <p>
          We&rsquo;ll connect you with the trusted buyer we work with, who buys very competitively —
          meet up around St. Louis, or ship from anywhere in the US.
        </p>
        <Link to="/sell-video-games" className="gg-btn">
          Sell your video games
        </Link>
      </aside>
    );
  }
  return (
    <aside className="gg-collect-cta">
      <h2>Want a second pair of eyes?</h2>
      <p>
        We buy Magic collections of every size — ship from anywhere in the US, meet up in St.
        Louis, or we&rsquo;ll drive to you within about {MAX_DRIVE_HOURS} hours. Unsorted is fine.
      </p>
      <Link to="/sell-my-collection" className="gg-btn">
        Sell your collection
      </Link>
    </aside>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function GuidesIndexPage() {
  useSEO({
    title: "Seller Guides: Magic, Pokémon & Video Games | Geega Games",
    description:
      "Plain-English guides for selling Magic: The Gathering cards, Pokémon cards and video games: what your collection is worth, where to sell it, and what to do with an inherited collection.",
    path: "/guides",
    jsonLd: [
      breadcrumbJsonLd([{ name: "Guides", path: "/guides" }]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Seller guides",
        url: absoluteUrl("/guides"),
        publisher: { "@id": ORGANIZATION_ID },
        hasPart: GUIDES.map((g) => ({
          "@type": "Article",
          headline: g.heading,
          url: absoluteUrl(guidePath(g.slug)),
        })),
      },
    ],
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Seller guides</h1>
        <p className="gg-collect-hero-sub">
          Straight answers for people who aren&rsquo;t sure what they have yet — whether it&rsquo;s
          your own old binder, a box of games, or a collection you inherited.
        </p>
      </section>
      {(Object.keys(TOPIC_HEADINGS) as GuideTopic[]).map((topic) => (
        <section className="gg-collect-section" key={topic}>
          <h2>{TOPIC_HEADINGS[topic]}</h2>
          <ul className="gg-guide-links">
            {GUIDES.filter((g) => g.topic === topic).map((guide) => (
              <li key={guide.slug}>
                <Link to={guidePath(guide.slug)}>{guide.heading}</Link>
                <span>{guide.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function GuidePage({ slug }: { slug: string }) {
  const guide = findGuide(slug);
  const Body = GUIDE_BODIES[slug];
  if (!guide || !Body) return <NotFoundPage />;
  return (
    <GuideLayout guide={guide}>
      <Body />
    </GuideLayout>
  );
}

function GuideLayout({ guide, children }: { guide: GuideMeta; children: ReactNode }) {
  const path = guidePath(guide.slug);
  useSEO({
    title: guide.title,
    description: guide.description,
    path,
    jsonLd: [
      breadcrumbJsonLd([
        { name: "Guides", path: "/guides" },
        { name: guide.heading, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: guide.heading,
        description: guide.description,
        datePublished: guide.published,
        dateModified: guide.updated,
        mainEntityOfPage: absoluteUrl(path),
        image: absoluteUrl("/og-image.png"),
        author: { "@id": ORGANIZATION_ID },
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  });

  return (
    <div className="gg-page">
      <article className="gg-prose gg-article">
        <nav className="gg-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/guides">Guides</Link> <span aria-hidden="true">/</span>{" "}
          <span>{guide.heading}</span>
        </nav>
        <h1>{guide.heading}</h1>
        <p className="gg-article-meta">
          By Geega Games · Updated <time dateTime={guide.updated}>{formatDate(guide.updated)}</time>
        </p>
        {children}
        <GuideCta topic={guide.topic} />
        <h2>More guides</h2>
        <ul>
          {/* Same-topic guides first — they're the likeliest next read. */}
          {[...GUIDES]
            .filter((g) => g.slug !== guide.slug)
            .sort((a, b) => Number(b.topic === guide.topic) - Number(a.topic === guide.topic))
            .map((g) => (
              <li key={g.slug}>
                <Link to={guidePath(g.slug)}>{g.heading}</Link>
              </li>
            ))}
        </ul>
      </article>
    </div>
  );
}

function CollectionWorthGuide() {
  return (
    <>
      <p>
        The honest answer for most collections: the value is concentrated in a small number of
        cards. Most commons and uncommons sell for a few cents each, while a handful of rares, older
        cards and in-demand staples usually make up most of what a collection is worth. Your first
        job isn&rsquo;t to price every card — it&rsquo;s to find the ones worth a closer look.
      </p>

      <h2>1. Check the rarity symbol</h2>
      <p>
        Every card printed since mid-1998 has a colored expansion symbol on the right side of the type
        line, just under the art:
      </p>
      <ul>
        <li><strong>Black</strong> — common</li>
        <li><strong>Silver</strong> — uncommon</li>
        <li><strong>Gold</strong> — rare</li>
        <li><strong>Orange-red</strong> — mythic rare (introduced in 2008)</li>
      </ul>
      <p>
        Pull out the gold and orange-red symbols first. Cards printed before then have all-black
        symbols regardless of rarity, and the earliest sets have no symbol at all — which brings us
        to the next check.
      </p>

      <h2>2. Look for old cards</h2>
      <p>
        The oldest cards are where the biggest values tend to live, especially the sets from 1993
        and 1994: Alpha, Beta, Unlimited, Arabian Nights, Antiquities, Legends and The Dark, plus
        the widely printed Revised Edition. A few ways to spot older cards:
      </p>
      <ul>
        <li>
          <strong>No expansion symbol.</strong> Alpha, Beta, Unlimited and Revised cards have no
          symbol at all next to the type line. Alpha and Beta have black borders; Unlimited and
          Revised have white borders.
        </li>
        <li>
          <strong>The old card frame.</strong> Cards printed before mid-2003 use the original
          frame: power and toughness sit on the frame itself rather than in a small box, and the
          text box has a textured, colored border.
        </li>
        <li>
          <strong>The copyright line.</strong> Most cards print a year at the very bottom — a quick
          way to date them. The earliest cards don&rsquo;t have one.
        </li>
        <li>
          <strong>Gold borders on the front</strong> mean a World Championship deck reprint, and
          square corners with a gold-bordered back mean Collectors&rsquo; Edition. Both are
          collectible, but they aren&rsquo;t tournament-legal and are worth far less than the
          originals.
        </li>
      </ul>

      <h2>3. Know about the Reserved List</h2>
      <p>
        In 1996, Wizards of the Coast created the Reserved List: a set of older cards it promised
        never to reprint. It includes the original dual lands (such as Underground Sea and Volcanic
        Island) and many rares from the early sets through the Urza&rsquo;s block of 1999. Because supply is
        fixed, Reserved List cards are often valuable even when they&rsquo;re heavily played.
      </p>

      <h2>4. Don&rsquo;t overlook newer staples</h2>
      <p>
        Age isn&rsquo;t everything. Many valuable cards are recent and in demand because people
        play them — especially in Commander, the most popular way to play. Tutors, fast mana,
        powerful lands and format staples can be worth real money even from sets released in the
        last few years, so check your rares from every era.
      </p>

      <h2>5. Condition matters — a lot</h2>
      <p>
        The same card can be worth dramatically less with whitening on the edges, creases, scratches
        or water damage. Cards are usually graded Near Mint, Lightly Played, Moderately Played,
        Heavily Played or Damaged; our <Link to="/condition-guide">card condition guide</Link> shows
        what each means. Don&rsquo;t try to clean cards, and get anything valuable into a sleeve.
      </p>

      <h2>6. Special printings</h2>
      <p>
        Foils, borderless and extended-art versions, showcase frames, serialized (individually
        numbered) cards and some Japanese alternate-art printings can sell for several times the
        regular version. When in doubt, set it aside.
      </p>

      <h2>How to look up prices</h2>
      <ul>
        <li>
          <strong>Scryfall</strong> is the easiest free card search: find the exact printing (the
          set symbol and collector number help) and it shows current market prices.
        </li>
        <li>
          <strong>Marketplace &ldquo;market price&rdquo;</strong> figures reflect what the card has
          recently sold for. That&rsquo;s the retail side.
        </li>
        <li>
          <strong>Buylist prices</strong> are what stores pay. Any buyer who resells cards pays less
          than retail — that&rsquo;s normal — so compare offers to buylist prices, not to the
          highest retail listing you can find.
        </li>
      </ul>

      <h2>What about the other 95%?</h2>
      <p>
        Most of a big collection is usually bulk — commons, uncommons and lower-value rares. It has
        value in quantity, but it isn&rsquo;t worth pricing card by card. Our{" "}
        <Link to={guidePath("how-to-sell-bulk-magic-cards")}>guide to selling bulk</Link> covers
        what to pull out first and what to do with the rest.
      </p>

      <h2>When it&rsquo;s worth getting an offer</h2>
      <p>
        If you have more than a few hundred cards, any old cards, or just don&rsquo;t want to spend
        your weekends on price lookups, it&rsquo;s usually faster to have someone go through it
        with you. We look at every card, not just the obvious ones, and make one offer on the whole
        collection.
      </p>
    </>
  );
}

function InheritedCollectionGuide() {
  return (
    <>
      <p>
        Finding boxes of Magic: The Gathering cards in an estate, an attic or a closet is more
        common than you&rsquo;d think — the game has been around since 1993. Some collections turn
        out to be worth very little, and some are worth a surprising amount. Either way, a few
        simple steps protect the value until you know which one you have.
      </p>

      <h2>1. Don&rsquo;t throw anything away yet</h2>
      <p>
        Keep all of it until someone who knows the game has looked: loose cards, binders, deck
        boxes, sealed packs and boxes, even cards that look like junk. Unopened product from the
        &rsquo;90s and early 2000s can be worth far more than the cards inside, so don&rsquo;t open
        anything that&rsquo;s still sealed.
      </p>

      <h2>2. Keep it the way you found it</h2>
      <ul>
        <li>Leave binders intact and cards in their sleeves or toploaders.</li>
        <li>Never use rubber bands — they bend and dent cards.</li>
        <li>Don&rsquo;t clean, flatten or write on cards.</li>
        <li>Store boxes somewhere dry, flat and out of direct sun — not a damp basement or a hot garage.</li>
      </ul>
      <p>
        How someone organized their collection also tells a buyer a lot, so resist the urge to
        re-sort everything.
      </p>

      <h2>3. Get a rough idea of the size</h2>
      <p>
        You don&rsquo;t need an exact count. Card storage boxes are sold by capacity
        (&ldquo;1,000-count&rdquo;, &ldquo;5,000-count&rdquo;), so a full box is a quick estimate,
        and each page of a standard binder holds 9 cards per side. Photos of a few binder pages and
        the tops of the boxes are the single most useful thing you can send a buyer.
      </p>

      <h2>4. Look for the obvious signs of value</h2>
      <p>
        You can do a quick first pass without learning the game: gold and orange-red rarity symbols,
        very old cards with no symbol at all, anything in a graded plastic case, and sealed product.
        Our guide to{" "}
        <Link to={guidePath("how-much-is-my-mtg-collection-worth")}>
          what a Magic collection is worth
        </Link>{" "}
        walks through each of these.
      </p>

      <h2>5. Understand your options</h2>
      <ul>
        <li>
          <strong>Sell card by card yourself.</strong> Usually the most money, and by far the most
          work: listing, photos, marketplace fees, shipping and customer questions, often for
          months.
        </li>
        <li>
          <strong>A local game store.</strong> Quick, but many stores only buy the specific cards
          they need, and some won&rsquo;t take large or unsorted collections.
        </li>
        <li>
          <strong>Online buylists.</strong> Good prices for specific cards, but you have to look up,
          list and ship each card yourself.
        </li>
        <li>
          <strong>A collection buyer.</strong> The least work: one offer for everything, bulk
          included, from someone who does the sorting.
        </li>
      </ul>

      <h2>6. Protect yourself</h2>
      <ul>
        <li>Get the offer in writing, and don&rsquo;t let anyone rush you into deciding on the spot.</li>
        <li>
          Be careful with buyers who want to cherry-pick a few cards and leave you with the rest —
          unless that&rsquo;s what you want.
        </li>
        <li>
          Use a payment method with protection. We pay by PayPal Goods &amp; Services (never Friends
          &amp; Family) or store credit worth {STORE_CREDIT_BONUS_PERCENT}% more.
        </li>
        <li>For a collection with clearly high-value cards, a second opinion is always reasonable.</li>
      </ul>

      <h2>7. Keep what matters to you</h2>
      <p>
        Collections often carry memories. If there&rsquo;s a favorite deck or a few cards you want
        to keep, set them aside — any good buyer will make an offer on the rest.
      </p>

      <h2>How we handle inherited collections</h2>
      <p>
        We buy estate and inherited collections as they are — no sorting needed. We&rsquo;re based
        in St. Louis (<Link to={ST_LOUIS_PATH}>local meetups</Link>), we drive to sellers within
        about {MAX_DRIVE_HOURS} hours, and you can <Link to={sellFormPath("ship")}>ship to us</Link>{" "}
        from anywhere in the US.
      </p>
    </>
  );
}

function BulkGuide() {
  return (
    <>
      <p>
        &ldquo;Bulk&rdquo; is the Magic: The Gathering term for cards worth only a few cents each —
        mostly commons and uncommons, plus basic lands, tokens and &ldquo;bulk rares&rdquo; (rares
        and mythics that sell for well under a dollar). Bulk is bought and sold by the thousand
        rather than card by card. Before you sell any, make sure nothing valuable is hiding in it.
      </p>

      <h2>Pull these out before you sell bulk</h2>
      <ul>
        <li>
          <strong>Every rare and mythic</strong> (gold or orange-red set symbol). Most are bulk, but
          check each one — this is where most of the value in a box usually hides.
        </li>
        <li><strong>Foils</strong>, especially from older sets.</li>
        <li>
          <strong>Old cards</strong> — anything in the pre-2003 frame, and anything with no set
          symbol. Some old commons and uncommons are worth real money.
        </li>
        <li>
          <strong>Playable staples</strong> printed at common or uncommon, such as Sol Ring, Lightning
          Bolt, Counterspell, Dark Ritual and Swords to Plowshares. Older printings of cards like
          these can be worth a few dollars each.
        </li>
        <li><strong>Special versions</strong>: borderless, extended art, showcase and non-English printings.</li>
      </ul>

      <h2>How to count bulk</h2>
      <p>
        Nobody counts bulk card by card. A single card weighs roughly 1.8 grams, so 1,000 cards come
        to about 4 pounds (around 1.8 kg) — a kitchen or bathroom scale gets you close. Storage
        boxes are sold by capacity (&ldquo;1,000-count&rdquo;, &ldquo;5,000-count&rdquo;), which
        makes a full box an easy estimate.
      </p>

      <h2>Ways to sell bulk</h2>
      <ul>
        <li>
          <strong>Local game stores</strong> often buy bulk by the thousand, though some only take
          certain colors, rarities or recent sets.
        </li>
        <li>
          <strong>Mail-in bulk buylists</strong> accept large quantities, but bulk is heavy, and
          shipping cost can eat into a small lot.
        </li>
        <li>
          <strong>Selling lots yourself</strong> on a marketplace can bring more per card, in
          exchange for photos, listings and packing.
        </li>
        <li>
          <strong>Include it with a collection.</strong> The simplest option: sell the bulk together
          with everything else and let the buyer sort it.
        </li>
      </ul>

      <h2>Packing bulk to ship</h2>
      <ul>
        <li>Pack cards tightly in storage boxes so they can&rsquo;t slide around, then put those in a sturdy shipping box.</li>
        <li>Never use rubber bands. Fill empty space with paper so nothing shifts.</li>
        <li>Wrap boxes in a plastic bag to protect against moisture.</li>
        <li>Use a tracked service, and insurance if anything valuable is in with the bulk.</li>
      </ul>

      <h2>Selling us your bulk</h2>
      <p>
        We look at bulk as part of a collection, so there&rsquo;s no need to separate it first —
        mention roughly how much you have when you{" "}
        <Link to="/sell-my-collection">tell us about your collection</Link>. In the St. Louis area
        we can <Link to={ST_LOUIS_PATH}>meet up</Link>, and heavy boxes are one more reason an
        in-person meetup is often easier than shipping.
      </p>
    </>
  );
}

function WhereToSellMagicGuide() {
  return (
    <>
      <p>
        There&rsquo;s no single best place to sell Magic cards — it depends on what you have and how
        much of your own time you want to spend. Here&rsquo;s how the main options compare,
        including what each one actually costs you.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>
          <strong>A few valuable singles, and you don&rsquo;t mind shipping:</strong> a marketplace
          (TCGplayer or eBay) usually gets you the most per card.
        </li>
        <li>
          <strong>A stack of playable cards you can look up yourself:</strong> an online buylist is
          quick and predictable.
        </li>
        <li>
          <strong>You want it done today, in person:</strong> a local game store — if they want what
          you have.
        </li>
        <li>
          <strong>A big, mixed or unsorted collection:</strong> a collection buyer, who makes one
          offer on everything.
        </li>
      </ul>

      <h2>1. Sell it yourself on TCGplayer</h2>
      <p>
        TCGplayer is the biggest marketplace for Magic singles in the US. As of February 2026,
        standard sellers pay a 10.75% commission plus a 2.5% + $0.30 payment fee on each order. On a
        $100 card that&rsquo;s about $13.55 in fees before shipping supplies, so you keep roughly $86.
      </p>
      <p>
        <strong>Good for:</strong> individual cards worth more than a few dollars.{" "}
        <strong>The catch:</strong> you list every card, pack and ship every order, and handle any
        questions or problems yourself.
      </p>

      <h2>2. Sell it on eBay</h2>
      <p>
        In 2026, eBay charges most sellers a 13.25% final value fee on trading cards — calculated on
        the total the buyer pays, including shipping — plus a small per-order fee. It&rsquo;s
        strongest for high-end or unusual cards, where an auction can beat a fixed price.
      </p>
      <p>
        <strong>The catch:</strong> the most work per sale — photos, descriptions, and the
        occasional buyer who wants to return something.
      </p>

      <h2>3. Sell to an online buylist</h2>
      <p>
        Big online stores publish buylists: the price they&rsquo;ll pay for each card. You look up
        every card, choose its condition, ship the order, and get paid once they&rsquo;ve checked it
        in. Most pay extra — often 25–30% more — if you take store credit instead of cash.
      </p>
      <p>
        <strong>The catch:</strong> buylist prices are well below retail, the lookup work is yours,
        and if the store grades a card lower than you did, the payout drops. That last one is the
        most common complaint from buylist sellers.
      </p>

      <h2>4. Sell to a local game store</h2>
      <p>
        Fast and in person — you can often leave with cash or store credit the same day. But many
        stores only buy the specific cards they need right now, and some won&rsquo;t take large or
        unsorted collections.
      </p>

      <h2>5. Sell to a collection buyer</h2>
      <p>
        A collection buyer looks at everything — rares, bulk, sealed product, old cards — and makes
        one offer on the whole lot. You get less per card than retail, but there are no fees, no
        listings and no individual orders to ship, and unsorted collections are welcome.
      </p>
      <p>
        That&rsquo;s what we do. Ship from anywhere in the US, meet up with us in{" "}
        <Link to={ST_LOUIS_PATH}>St. Louis</Link>, or — for a collection — we&rsquo;ll drive to you,
        up to about {MAX_DRIVE_HOURS} hours away. We pay by PayPal Goods &amp; Services or in store
        credit worth {STORE_CREDIT_BONUS_PERCENT}% more.
      </p>

      <h2>Whichever you choose</h2>
      <ul>
        <li>
          Pull out the valuable cards first — our guide to{" "}
          <Link to={guidePath("how-much-is-my-mtg-collection-worth")}>
            what a Magic collection is worth
          </Link>{" "}
          shows what to look for.
        </li>
        <li>
          Grade condition honestly; our <Link to="/condition-guide">condition guide</Link> explains
          each grade.
        </li>
        <li>
          Compare offers to buylist prices, not to the highest retail listing — any buyer who resells
          pays less than retail.
        </li>
        <li>Get paid with protection: PayPal Goods &amp; Services, never Friends &amp; Family.</li>
        <li>
          Selling Commander staples? Reprints can knock a card&rsquo;s price down fast — often as
          soon as the reprint is announced — so don&rsquo;t sit on cards you&rsquo;ve already decided
          to sell.
        </li>
      </ul>
    </>
  );
}

function PokemonValueGuide() {
  return (
    <>
      <p>
        Most Pokémon cards from the &rsquo;90s and 2000s are worth a few cents to a few dollars —
        millions were printed. But a small share are worth real money, and they&rsquo;re easy to
        miss if you don&rsquo;t know what to check. Go through these before you sell (or throw out)
        anything.
      </p>

      <h2>1. Check the era</h2>
      <p>
        English Pokémon cards from 1999 to 2003 were printed by Wizards of the Coast — the copyright
        line at the very bottom of the card mentions Wizards. That era (Base Set, Jungle, Fossil,
        Team Rocket, Gym Heroes, Gym Challenge and the Neo sets) is where most vintage value lives.
      </p>

      <h2>2. Look for the 1st Edition stamp</h2>
      <p>
        A small black stamp reading &ldquo;Edition 1&rdquo; on the left side, just below the
        artwork, marks a card from the first print run. For the same card, 1st Edition copies usually
        sell for far more than later &ldquo;unlimited&rdquo; printings.
      </p>

      <h2>3. Base Set: shadowless or not?</h2>
      <p>
        Early Base Set printings have no drop shadow along the right edge of the artwork box. These
        &ldquo;shadowless&rdquo; cards are worth more than the later printings with the shadow.
      </p>

      <h2>4. Holos and rarity symbols</h2>
      <p>
        The rarity symbol is in the bottom corner: a circle is common, a diamond is uncommon and a
        star is rare. Rares with a shiny, holographic artwork box — like the original Base Set
        Charizard, Blastoise and Venusaur — are the classic valuable cards.
      </p>

      <h2>5. Newer cards can be valuable too</h2>
      <p>
        It isn&rsquo;t only vintage. In modern sets, look for cards numbered higher than the set size
        (like 201/165) — those are secret rares — plus full-art, alternate-art, special illustration
        rare and gold cards. The most sought-after of these are worth more than many vintage cards.
      </p>

      <h2>6. Japanese and other languages</h2>
      <p>
        Japanese cards have their own market and are priced separately from English ones. Some are
        very collectible, others aren&rsquo;t — the same checks for rarity and condition apply.
      </p>

      <h2>7. Condition makes a huge difference</h2>
      <p>
        Whitening on the edges, scratches on the holo, dents, creases and bends can cut a card&rsquo;s
        value sharply. Don&rsquo;t try to clean or flatten cards — just put anything that looks
        valuable into a sleeve.
      </p>

      <h2>8. Is it real?</h2>
      <p>Counterfeit Pokémon cards are common, especially of popular cards. Warning signs:</p>
      <ul>
        <li>fonts, energy symbols or colors that look slightly off next to a real card;</li>
        <li>spelling mistakes or odd attack text;</li>
        <li>a card that feels thinner, glossier or bendier than your others;</li>
        <li>a holo pattern that looks flat or printed on rather than shiny.</li>
      </ul>
      <p>
        If you&rsquo;re unsure, compare it side by side with a common card from the same era —
        fakes usually stand out once you know what to look for.
      </p>

      <h2>9. How to check real prices</h2>
      <p>
        Look up the exact card — set, number and version — and check what it has actually sold for,
        not what people are asking. TCGplayer&rsquo;s market price and eBay&rsquo;s sold listings both
        show recent sales. Price it for its real condition, not near-mint.
      </p>

      <h2>10. Should you get it graded first?</h2>
      <p>
        Grading (PSA, BGS or CGC) can raise the price of a high-value card in excellent condition, but
        it isn&rsquo;t cheap or fast: in mid-2026, PSA&rsquo;s cheapest regular service cost about $80
        a card and took roughly 40–60 days. As a rule of thumb, grading only pays off for cards worth
        a few hundred dollars raw and in great shape. For most cards, selling raw is simpler and nets
        about the same.
      </p>
    </>
  );
}

function VideoGameValueGuide() {
  return (
    <>
      <p>
        Most old games are worth a few dollars — the bestsellers sold millions of copies. But some are
        worth far more than people expect, and small details like the box and manual can multiply
        what a game sells for. Here&rsquo;s what to check before you sell.
      </p>

      <h2>1. Loose, complete in box, or sealed?</h2>
      <p>Collectors price games in three tiers:</p>
      <ul>
        <li>
          <strong>Loose</strong> — just the cartridge or disc.
        </li>
        <li>
          <strong>Complete in box (CIB)</strong> — the game with its original box and manual. For
          older cartridge games, CIB copies often sell for noticeably more than loose ones —
          sometimes several times as much.
        </li>
        <li>
          <strong>Sealed</strong> — still in the original factory seal. A separate market with its
          own prices, so don&rsquo;t open it.
        </li>
      </ul>
      <p>If boxes and manuals are stored separately, match them back up with their games.</p>

      <h2>2. What makes a game rare</h2>
      <ul>
        <li>
          <strong>Late releases:</strong> games that came out near the end of a console&rsquo;s life,
          after most players had moved on, often had small print runs.
        </li>
        <li>
          <strong>Niche genres and small publishers:</strong> many RPGs and limited releases were
          never printed in large numbers.
        </li>
        <li>
          <strong>Special and limited editions,</strong> plus store and contest exclusives.
        </li>
      </ul>
      <p>
        The flip side: the most popular games — sports titles and games bundled with consoles
        especially — are usually the least valuable, because so many copies exist.
      </p>

      <h2>3. Condition</h2>
      <p>
        For cartridges, the label matters most: tears, writing, fading and stickers all lower value.
        For boxed games, look for creases, crushed corners and sun fading; for discs, scratches and
        cracked cases. Don&rsquo;t peel stickers or labels yourself — a damaged label costs more than
        an old price tag.
      </p>

      <h2>4. Consoles and accessories</h2>
      <p>
        Consoles sell best complete, with their original controllers and cables — and better still in
        the box. A console that doesn&rsquo;t work still has value for parts or repair; just say so.
      </p>

      <h2>5. Watch out for reproductions</h2>
      <p>
        Popular, valuable cartridges — Game Boy and Game Boy Advance titles in particular — are
        frequently copied. Blurry or extra-glossy labels, the wrong cartridge color and missing
        details on the back are common giveaways. If a game seems surprisingly valuable, double-check
        it&rsquo;s the real thing.
      </p>

      <h2>6. How to check prices</h2>
      <p>
        PriceCharting lists recent sold prices for loose, complete and new copies of most games, and
        eBay&rsquo;s sold listings (not active ones) are a good second check. Make sure you&rsquo;re
        looking at the right version — region, platform and edition all matter.
      </p>

      <h2>7. Where to sell</h2>
      <ul>
        <li>
          <strong>Selling it yourself</strong> (eBay, Facebook Marketplace): the most money for your
          best games, and the most work.
        </li>
        <li>
          <strong>Chain-store trade-in:</strong> fast, but priced by barcode for resale, so offers on
          retro and collectible games are usually low.
        </li>
        <li>
          <strong>A local game shop:</strong> in person and quick; prices vary a lot from shop to
          shop.
        </li>
        <li>
          <strong>A specialist buyer:</strong> prices by what collectors pay, takes a whole
          collection at once, and saves you listing everything yourself.
        </li>
      </ul>
    </>
  );
}

const GUIDE_BODIES: Record<string, () => ReactNode> = {
  "how-much-is-my-mtg-collection-worth": CollectionWorthGuide,
  "inherited-magic-card-collection": InheritedCollectionGuide,
  "how-to-sell-bulk-magic-cards": BulkGuide,
  "where-to-sell-magic-cards": WhereToSellMagicGuide,
  "are-my-old-pokemon-cards-worth-anything": PokemonValueGuide,
  "are-my-old-video-games-worth-money": VideoGameValueGuide,
};
