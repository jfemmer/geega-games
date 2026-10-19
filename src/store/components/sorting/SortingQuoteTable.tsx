import { formatCents } from "../../lib/money";
import type { SortingQuoteView } from "../../lib/sortingApi";
import type { SortingDeliveryMethod } from "../../lib/sortingService";

// An itemized collection sorting quote, as the customer sees it: every line
// (sorting service, return shipping, return packaging & supplies, any other
// agreed charge) and the total. The lines come from the server, built by
// sortingQuoteLines() in src/store/lib/sortingService.ts — the same lines
// the quote email shows.

export default function SortingQuoteTable({
  quote,
  delivery,
  totalLabel = "Total",
}: {
  quote: SortingQuoteView;
  delivery: SortingDeliveryMethod;
  totalLabel?: string;
}) {
  return (
    <div className="gg-sort-quote">
      <dl className="gg-sort-lines">
        {quote.lines.map((line) => (
          <div className="gg-sort-line" key={line.key}>
            <dt>{line.label}</dt>
            <dd>{formatCents(line.amountCents)}</dd>
          </div>
        ))}
        <div className="gg-sort-line gg-sort-line--total">
          <dt>{totalLabel}</dt>
          <dd>{formatCents(quote.totalCents)}</dd>
        </div>
      </dl>
      <p className="gg-sort-quote__foot">
        {delivery === "ship"
          ? "Return shipping and packaging are included in this total. Once you've approved and paid it, we won't charge you anything more for return shipping unless you agree to a change."
          : "Local pickup — no return shipping."}
      </p>
      {quote.noteToCustomer && <p className="gg-sort-quote__note">{quote.noteToCustomer}</p>}
    </div>
  );
}
