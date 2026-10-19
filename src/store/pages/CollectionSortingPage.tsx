import { useEffect, useState } from "react";
import { useSEO } from "../lib/useSEO";
import { SUPPORT_EMAIL } from "./StaticPages";
import { FaqSection, HeroPoints } from "../components/SellLandingSections";
import SortingCalculator from "../components/sorting/SortingCalculator";
import { EMPTY_SORTING_PLAN, type SortingPlan } from "../lib/sortingForm";
import SortingRequestForm from "../components/sorting/SortingRequestForm";
import { ShippingInfoNotice, ShippingPolicyDetails } from "../components/sorting/SortingPolicy";
import { loadSortingOptions, type SortingOption } from "../lib/sortingApi";
import { SORTING_NO_INBOUND_LABELS, SORTING_PATH } from "../lib/sortingService";
import { ORGANIZATION_ID, breadcrumbJsonLd, faqJsonLd, serviceAreaServed } from "../../seo/site";

// Collection sorting — the service page (/collection-sorting). Customers drop
// off their Magic collection in the St. Louis area or ship it in, and we sort
// it for a per-1,000-card rate.
//
// The shipping policy (owner, 2026-10-17) is on this page three ways: the
// "Shipping Information" notice word for word near the top, the calculator
// (shipping to us is the customer's, paid separately; return shipping and
// packaging are items of the final quote; the total is pending a final
// shipping quote), and the full policy further down. The request form asks
// for a return address and the required shipping checkbox.
//
// The rates are whatever staff set in the admin (sorting_service_options);
// nothing here invents a price. With none set, the page explains the service
// and says requests open soon.

const HERO_POINTS = [
  "Priced per 1,000 cards",
  "Drop off in St. Louis or ship it in",
  "One complete quote to approve before you pay",
  "Nothing added after you approve unless you agree",
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "How much does sorting cost?",
    answer:
      "Sorting is priced per 1,000 cards — the current rates are in the calculator on this page. Your final price is based on the number of cards we count. If we're shipping your collection back, return shipping and packaging are added to your final quote.",
  },
  {
    question: "Who pays for shipping?",
    answer: `If you ship your collection to us, you buy the packing and shipping supplies, pack your cards so they aren't damaged, pay the full cost of shipping to us and arrange any insurance you want. ${SORTING_NO_INBOUND_LABELS} Return shipping and any return packaging are calculated and included in your final quote.`,
  },
  {
    question: "Is return shipping included in the per-1,000-card rate?",
    answer:
      "No. Return shipping isn't included in our per-1,000-card sorting rates. We work it out from your collection's size, weight, packaging needs and destination, and add it — with any return packaging and supplies — to your final quote.",
  },
  {
    question: "Will I know the full price before I pay?",
    answer:
      "Yes. Your quote lists the sorting service, return shipping, return packaging and the total. You approve that total before you pay, and once you've approved and paid it, we won't charge you separately for return shipping unless you agree to a change.",
  },
  {
    question: "Should I insure my package?",
    answer:
      "That's up to you. Shipping insurance on the way to us is your choice and your cost, so for a valuable collection it's worth adding when you buy your postage.",
  },
  {
    question: "Can I drop off my collection instead of shipping it?",
    answer:
      "Yes. If you're in the St. Louis area, choose drop-off and we'll set up a time and place with you. There's nothing to ship, so there's no shipping cost — just pick up your sorted collection when it's ready.",
  },
  {
    question: "How do I pay?",
    answer:
      "When your quote is ready, we email you a link to review it. Approve it, then pay online by card. Dropping off? You can also pay when you pick up.",
  },
];

const JSON_LD = [
  breadcrumbJsonLd([{ name: "Collection sorting", path: SORTING_PATH }]),
  {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Trading card collection sorting",
    name: "Magic: The Gathering collection sorting",
    provider: { "@id": ORGANIZATION_ID },
    areaServed: [...serviceAreaServed(), { "@type": "Country", name: "United States" }],
    description:
      "Geega Games sorts Magic: The Gathering collections for a per-1,000-card rate. Drop off in the St. Louis area or ship from anywhere in the US; return shipping and packaging are quoted with the final price, which the customer approves before paying.",
  },
  faqJsonLd(FAQ_ITEMS),
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
}

export default function CollectionSortingPage() {
  useSEO({
    title: "MTG Collection Sorting Service — Drop Off or Ship In | Geega Games",
    description:
      "Get your Magic: The Gathering collection sorted, priced per 1,000 cards. Drop off in St. Louis or ship from anywhere in the US, and approve one complete quote — return shipping included — before you pay.",
    path: SORTING_PATH,
    jsonLd: JSON_LD,
  });

  // null while loading (and in the prerendered page).
  const [options, setOptions] = useState<SortingOption[] | null>(null);
  const [plan, setPlan] = useState<SortingPlan>(EMPTY_SORTING_PLAN);

  useEffect(() => {
    let cancelled = false;
    loadSortingOptions()
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One rate: nothing to choose.
  const effectivePlan: SortingPlan =
    plan.optionId === null && options?.length === 1 ? { ...plan, optionId: options[0].id } : plan;
  const open = options !== null && options.length > 0;

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Magic: The Gathering collection sorting</h1>
        <p className="gg-collect-hero-sub">
          Boxes of cards you&rsquo;ve never had time to go through? Drop them off in St. Louis or ship
          them in from anywhere in the US, and we&rsquo;ll sift through and sort your collection, then get it
          back to you.
        </p>
        <HeroPoints points={HERO_POINTS} />
        <div className="gg-collect-hero-actions">
          <a href="#calculator" className="gg-btn">
            Estimate my price
          </a>
          <a href="#request" className="gg-btn gg-btn-ghost">
            Request sorting
          </a>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Estimate your price.</strong> Choose how you&rsquo;d like it sorted and about how many
            cards you have.
          </li>
          <li>
            <strong>Send your request.</strong> Tell us whether you&rsquo;ll drop off or ship, and
            we&rsquo;ll be in touch with next steps.
          </li>
          <li>
            <strong>Get your cards to us.</strong> Drop them off in the St. Louis area, or pack and ship
            them — shipping to us is yours to arrange and pay for.
          </li>
          <li>
            <strong>Approve your quote.</strong> We count and sort your collection, then send one
            complete quote: the sorting, plus return shipping and packaging if we&rsquo;re shipping it
            back.
          </li>
          <li>
            <strong>Get it back.</strong> Pay online (or at pickup) and we ship it back, or you pick it
            up.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section gg-sort-notice-section">
        <ShippingInfoNotice />
      </section>

      <section className="gg-collect-section" id="calculator">
        <h2>Estimate your price</h2>
        {options === null ? (
          <p className="gg-collect-lead gg-collect-lead--center" role="status">
            Loading our current rates…
          </p>
        ) : open ? (
          <SortingCalculator
            options={options}
            plan={effectivePlan}
            onChange={setPlan}
            onRequest={() => scrollToSection("request")}
          />
        ) : (
          <ComingSoon />
        )}
      </section>

      {open && (
        <section className="gg-collect-section" id="request">
          <h2>Request sorting</h2>
          <p className="gg-collect-lead gg-collect-lead--center">
            Send us a few details and we&rsquo;ll be in touch with next steps. You won&rsquo;t pay anything
            until you approve your final quote.
          </p>
          <div className="gg-referral-card">
            <SortingRequestForm
              options={options}
              plan={effectivePlan}
              onEditPlan={() => scrollToSection("calculator")}
            />
          </div>
        </section>
      )}

      <section className="gg-collect-section" id="shipping-policy">
        <h2>Shipping &amp; return shipping</h2>
        <ShippingPolicyDetails />
        <p className="gg-area-note">
          Dropping off locally? There&rsquo;s nothing to ship — just pick up your sorted collection when
          it&rsquo;s ready.
        </p>
      </section>

      <FaqSection items={FAQ_ITEMS} />
      <p className="gg-collect-contact">
        Questions first? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and tell us about
        your collection.
      </p>
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="gg-sort-soon" id="request">
      <p>
        <strong>Sorting requests open soon.</strong> We&rsquo;re finishing up our rates — check back
        shortly, or email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> to be first in line.
      </p>
    </div>
  );
}
