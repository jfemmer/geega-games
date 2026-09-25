import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { NotFoundPage } from "./StaticPages";
import {
  AreaLinks,
  CreditBonusBadge,
  MeetupSafetySection,
  StickySellCta,
  TrustSection,
  MeetupHowItWorks,
  SellCtaSection,
  SellerGuidesSection,
  WhatWeBuySection,
} from "../components/SellLandingSections";
import {
  SELL_AREAS,
  ST_LOUIS_PATH,
  areaInSentence,
  areaLabel,
  findSellArea,
  sellAreaPath,
  sellFormPath,
  shortAreaName,
  type SellArea,
} from "../../seo/sellAreas";
import { MAX_DRIVE_HOURS, ORGANIZATION_ID, breadcrumbJsonLd } from "../../seo/site";

// /sell-magic-cards/:slug — "we drive to you" page for one area within about
// a 6-hour drive of St. Louis. Content comes from src/seo/sellAreas.ts; see
// the rules at the top of that file before adding an area.

function areaJsonLd(area: SellArea): object[] {
  const path = sellAreaPath(area.slug);
  return [
    breadcrumbJsonLd([
      { name: "Sell your collection", path: "/sell-my-collection" },
      { name: areaLabel(area), path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: "Magic: The Gathering card and collection buying",
      name: `Sell Magic: The Gathering cards in ${areaInSentence(area, areaLabel(area))}`,
      provider: { "@id": ORGANIZATION_ID },
      areaServed: {
        "@type": "City",
        name: area.city,
        containedInPlace: { "@type": "State", name: area.state },
      },
      description: `Geega Games travels from St. Louis to ${areaInSentence(area, areaLabel(area))} (${area.driveTime}) to buy Magic: The Gathering collections in person, and buys by mail from anywhere in the US.`,
    },
  ];
}

export default function SellAreaPage({ slug }: { slug: string }) {
  const area = findSellArea(slug);
  if (!area) return <NotFoundPage />;
  return <SellArea area={area} />;
}

function SellArea({ area }: { area: SellArea }) {
  const label = areaLabel(area);
  // "Kansas City, MO" / "the Quad Cities" — inside sentences, headings, title.
  const where = areaInSentence(area, label);
  const city = areaInSentence(area);
  useSEO({
    title: `Sell Magic Cards in ${where} — We Come to You | Geega Games`,
    description: `Selling a Magic: The Gathering collection in ${where}? We drive from St. Louis (${area.driveTime}) to meet you in person, or you can ship your cards. Unsorted collections welcome.`,
    path: sellAreaPath(area.slug),
    jsonLd: areaJsonLd(area),
  });

  const neighbors = area.neighbors
    .map((slug) => SELL_AREAS.find((a) => a.slug === slug))
    .filter((a): a is SellArea => Boolean(a));

  return (
    <div className="gg-page">
      <nav className="gg-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/sell-my-collection">Sell your collection</Link> <span aria-hidden="true">/</span>{" "}
        <span>{label}</span>
      </nav>

      <section className="gg-collect-hero">
        <h1>Sell your Magic: The Gathering cards in {where}</h1>
        <p className="gg-collect-hero-sub">
          We&rsquo;re based in St. Louis and drive to {city} to buy Magic collections in
          person — no need to sort, price or ship anything. Rather mail it? You can ship your cards
          to us from anywhere.
        </p>
        <CreditBonusBadge />
        <div className="gg-collect-hero-actions">
          <Link to={sellFormPath("local")} className="gg-btn">
            Set up a meetup
          </Link>
          <Link to={sellFormPath("ship")} className="gg-btn gg-btn-ghost">
            Ship instead
          </Link>
        </div>
      </section>

      <section className="gg-collect-section">
        <dl className="gg-area-facts">
          <div>
            <dt>Distance from St. Louis</dt>
            <dd>Roughly {area.driveMiles} miles</dd>
          </div>
          <div>
            <dt>Drive time</dt>
            <dd>
              {area.driveTime[0].toUpperCase() + area.driveTime.slice(1)}
              {area.route ? `, ${area.route}` : ""}
            </dd>
          </div>
          <div>
            <dt>Ways to sell</dt>
            <dd>Meet up in person, or ship your cards</dd>
          </div>
        </dl>
        <p className="gg-collect-lead">{area.intro}</p>
        <p className="gg-collect-lead">
          <strong>Also covering:</strong> {area.alsoServing.join(" · ")}
        </p>
      </section>

      <section className="gg-collect-section">
        <h2>How an in-person sale in {city} works</h2>
        <MeetupHowItWorks place={city} />
      </section>

      <WhatWeBuySection />

      <section className="gg-collect-section">
        <h2>Prefer to ship from {city}?</h2>
        <p className="gg-collect-lead">
          That works too, and it&rsquo;s often easier for a smaller lot or a few valuable singles.
          Send us a list or a description through the{" "}
          <Link to={sellFormPath("ship")}>sell form</Link> and we&rsquo;ll get back to you with next
          steps. The form includes packing tips so your cards arrive in the same condition they
          left.
        </p>
      </section>

      <MeetupSafetySection place={city} spots={area.safeSpots} />

      <TrustSection />

      <section className="gg-collect-section">
        <h2>Other areas we travel to</h2>
        <p className="gg-collect-lead">
          Closest to {city}:{" "}
          {neighbors.map((n, i) => (
            <span key={n.slug}>
              {i > 0 && (i === neighbors.length - 1 ? " and " : ", ")}
              <Link to={sellAreaPath(n.slug)}>{shortAreaName(n)}</Link>
            </span>
          ))}
          . Home base is <Link to={ST_LOUIS_PATH}>St. Louis</Link>, and we travel anywhere within
          about {MAX_DRIVE_HOURS} hours of it:
        </p>
        <AreaLinks exclude={area.slug} />
      </section>

      <SellerGuidesSection />

      <SellCtaSection
        heading={`Selling a collection in ${city}?`}
        text="Tell us a little about it — size, what kind of cards, and whether you'd rather meet up or ship. Unsorted is completely fine."
        handoff="local"
        buttonLabel="Get started"
      />

      <p className="gg-area-note">
        Drive times and distances are approximate, measured from St. Louis, and depend on traffic
        and where in the area we meet.
      </p>

      <StickySellCta label="Set up a meetup" to={sellFormPath("local")} />
    </div>
  );
}
