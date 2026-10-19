import {
  SORTING_INBOUND_RESPONSIBILITIES,
  SORTING_NO_INBOUND_LABELS,
  SORTING_RETURN_POLICY,
  SORTING_SHIPPING_NOTICE,
} from "../../lib/sortingService";

// The collection sorting shipping policy as the storefront shows it. The
// wording comes from src/store/lib/sortingService.ts, the one copy shared
// with the request form, the quote page and the emails.

/** The service page's "Shipping Information" notice, word for word. */
export function ShippingInfoNotice({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <aside className="gg-sort-notice" aria-labelledby="sort-shipping-info">
      <Heading id="sort-shipping-info" className="gg-sort-notice__title">
        Shipping Information
      </Heading>
      <p className="gg-sort-notice__text">{SORTING_SHIPPING_NOTICE}</p>
    </aside>
  );
}

/** The full policy: what the customer takes care of, and how return shipping is quoted. */
export function ShippingPolicyDetails() {
  return (
    <div className="gg-sort-policy">
      <div className="gg-sort-policy__col">
        <h3>Shipping your collection to us</h3>
        <p>If you ship your cards to us, you&rsquo;re responsible for:</p>
        <ul>
          {SORTING_INBOUND_RESPONSIBILITIES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="gg-sort-policy__note">{SORTING_NO_INBOUND_LABELS}</p>
      </div>
      <div className="gg-sort-policy__col">
        <h3>Return shipping</h3>
        <ul>
          {SORTING_RETURN_POLICY.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
