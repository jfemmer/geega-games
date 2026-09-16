import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { SUPPORT_EMAIL } from "./StaticPages";

// SEO landing page for people sitting on a large, unsorted Magic collection
// (estate, "found it in the attic," quit-playing-years-ago, etc.). Deliberately
// separate from /sell: that page is the intake FORM (works fine on its own for
// a guest with a handful of cards); this page is the CONTENT/authority page
// search traffic lands on, and every CTA here funnels into /sell rather than
// duplicating its logic.
//
// Content rule from the business owner: no payout-percentage or fixed-
// turnaround claims anywhere on this page — those aren't finalized, and
// promising a number here would be a claim we can't back up at checkout time.

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does my collection need to be sorted first?",
    answer:
      "No. Bring it or ship it exactly as it is — in binders, boxes, bags, or a mix of all three. Sorting it yourself doesn't get you a better offer, and for a large collection it usually just delays things.",
  },
  {
    question: "I have no idea what any of this is worth. Is that a problem?",
    answer:
      "Not at all. Most people selling a large collection haven't priced it and don't need to. We go through everything and make an offer based on what's actually there.",
  },
  {
    question: "Do I have to bring it in, or can I ship it?",
    answer:
      "Either works. Plenty of sellers bring a collection in and wait while it's looked over; just as many prefer to ship it and get an offer back. Tell us your preference in the form and we'll go from there — whichever is easier for you.",
  },
  {
    question: "Is there a minimum size to sell a collection this way?",
    answer:
      "This path is built for larger, mixed, and unsorted collections in particular — think binders and boxes rather than a handful of cards. If you're not sure whether yours qualifies, submit it anyway and describe what you have; we'll tell you the best way to handle it.",
  },
  {
    question: "What if it's a mix of valuable cards and bulk commons?",
    answer:
      "That's the normal case, not an edge case. Most real collections are a mix — a few cards worth looking at closely and a lot that aren't. Send it all; we sort out what's what.",
  },
  {
    question: "How do I actually start?",
    answer:
      "Use the form below. It asks a few quick questions about the collection (size, what's in it, whether you'd rather ship or bring it in) — nothing about individual card values or condition grading is required up front.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export default function SellCollectionPage() {
  useSEO({
    title: "Sell Your Magic: The Gathering Collection — Unsorted Welcome | Geega Games",
    description:
      "Selling a large Magic: The Gathering collection? Unsorted, mixed, or inherited — no problem. Ship it or bring it in, no sorting or pricing required. Get started today.",
    path: "/sell-my-collection",
    jsonLd: FAQ_JSON_LD,
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Sell your Magic: The Gathering collection — unsorted is totally fine</h1>
        <p className="gg-collect-hero-sub">
          Binders you haven&rsquo;t opened in years. Boxes from a basement or a closet. A
          collection you inherited and don&rsquo;t know where to start with. Bring it in or
          ship it to us exactly as it is — no sorting, no pricing spreadsheet, no cleanup
          required on your end.
        </p>
        <div className="gg-collect-hero-actions">
          <Link to="/sell" className="gg-btn">
            Start selling your collection
          </Link>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>Built for collections that haven&rsquo;t been touched in years</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Inherited or estate collections</h3>
            <p>
              Sorting through someone else&rsquo;s cards is hard enough without also having
              to learn what any of it is worth. Send it as-is and we&rsquo;ll take it from
              there.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Old bulk and mixed boxes</h3>
            <p>
              Commons, foils, old rares, sealed packs, half-built decks — a real collection is
              rarely one clean category. That mix is exactly what we look through every day.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>&ldquo;Not sure what I even have&rdquo;</h3>
            <p>
              You don&rsquo;t need to know the set names, the rarities, or which cards are
              worth looking at closely. That&rsquo;s our job, not yours.
            </p>
          </div>
        </div>
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Tell us about the collection.</strong> A couple of quick questions —
            roughly how much you have and what kind of cards are in it. &ldquo;Not sure&rdquo;
            is a fine answer to any of them.
          </li>
          <li>
            <strong>Choose ship or bring it in.</strong> Prefer to drop it off and have it
            looked over in person? Prefer to box it up and ship it to us? Either is fine —
            let us know which works better for you.
          </li>
          <li>
            <strong>We go through everything.</strong> Every card gets looked at, not just the
            ones that look valuable at a glance.
          </li>
          <li>
            <strong>You get an offer.</strong> Straightforward, on the whole collection, with
            no obligation until you say yes.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section gg-collect-trust">
        <h2>Why sell a large collection to Geega Games</h2>
        <ul className="gg-collect-trustlist">
          <li>We buy collections of all sizes, sorted or not — this is what we do regularly, not a side offer.</li>
          <li>No sorting, pricing, or condition-grading homework required before you reach out.</li>
          <li>Ship it or bring it in — your call, not a one-size-fits-all process.</li>
          <li>Real people looking through real cards, not an automated bulk-buy calculator.</li>
        </ul>
      </section>

      <section className="gg-collect-section">
        <h2>Frequently asked questions</h2>
        <div className="gg-faq">
          {FAQ_ITEMS.map((item) => (
            <details className="gg-faq-item" key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
        <p className="gg-collect-contact">
          Still have a question first? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and describe what you have —
          no need to sort or count anything before you write in.
        </p>
      </section>

      <section className="gg-collect-cta">
        <h2>Ready to sell your collection?</h2>
        <p>Unsorted, mixed, inherited, or just a lot of cards you never got around to — start here.</p>
        <Link to="/sell" className="gg-btn">
          Start selling your collection
        </Link>
      </section>
    </div>
  );
}
