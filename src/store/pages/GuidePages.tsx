import type { ReactNode } from "react";
import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { NotFoundPage } from "./StaticPages";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import { GUIDES, findGuide, guidePath, type GuideMeta } from "../../seo/guides";
import { ST_LOUIS_PATH, sellFormPath } from "../../seo/sellAreas";
import { MAX_DRIVE_HOURS, ORGANIZATION_ID, absoluteUrl, breadcrumbJsonLd } from "../../seo/site";

// Seller guides: /guides and /guides/:slug. These answer the questions people
// search BEFORE they're ready to sell ("how much is my mtg collection worth",
// "what to do with inherited magic cards", "how to sell bulk mtg"), which is
// where most sellers start. Metadata is in src/seo/guides.ts.
//
// Keep every factual claim here verifiable and evergreen: no card prices, no
// payout percentages (owner's rule), nothing that goes stale with a new set.

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
    title: "Guides for Selling Magic: The Gathering Cards | Geega Games",
    description:
      "Plain-English guides for anyone selling Magic: The Gathering cards: what your collection is worth, what to do with an inherited collection, and how to sell bulk.",
    path: "/guides",
    jsonLd: [
      breadcrumbJsonLd([{ name: "Guides", path: "/guides" }]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Guides for selling Magic: The Gathering cards",
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
        <h1>Guides for selling Magic: The Gathering cards</h1>
        <p className="gg-collect-hero-sub">
          Straight answers for people who aren&rsquo;t sure what they have yet — whether it&rsquo;s
          your own old binder or a collection you inherited.
        </p>
      </section>
      <section className="gg-collect-section">
        <ul className="gg-guide-links">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link to={guidePath(guide.slug)}>{guide.heading}</Link>
              <span>{guide.summary}</span>
            </li>
          ))}
        </ul>
      </section>
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
        <h2>More guides</h2>
        <ul>
          {GUIDES.filter((g) => g.slug !== guide.slug).map((g) => (
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

const GUIDE_BODIES: Record<string, () => ReactNode> = {
  "how-much-is-my-mtg-collection-worth": CollectionWorthGuide,
  "inherited-magic-card-collection": InheritedCollectionGuide,
  "how-to-sell-bulk-magic-cards": BulkGuide,
};
