import { useEffect, useState } from "react";
import { Link } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { loadMySortingRequests, type MySortingRequest } from "../../lib/sortingApi";
import {
  SORTING_DELIVERY_LABELS,
  SORTING_PATH,
  SORTING_QUOTE_PATH,
  sortingBalanceDueCents,
  sortingStatusLabel,
} from "../../lib/sortingService";

// Account → Sorting requests: the signed-in customer's collection sorting
// requests (my_sorting_requests(), which returns only their own rows and
// never staff-only columns), each with where it stands, the quote waiting on
// them or the total they approved, and a link to the quote page.

function quoteSummary(r: MySortingRequest): string | null {
  if (r.quote_status === "sent" && r.quote_total_cents != null) {
    return `Quote ready: ${formatCents(r.quote_total_cents)} — waiting for your approval`;
  }
  if (r.accepted_total_cents != null) {
    const due = sortingBalanceDueCents(r.accepted_total_cents, r.amount_paid_cents);
    return `Approved total ${formatCents(r.accepted_total_cents)} · ${due > 0 ? `${formatCents(due)} due` : "paid in full"}`;
  }
  if (r.quote_status === "declined") return "You declined the quote";
  return null;
}

export default function MySortingRequests() {
  const [rows, setRows] = useState<MySortingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMySortingRequests()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your sorting requests.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Loading your sorting requests…</p>;
  if (error)
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error}
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="gg-empty">
        <p>You haven&rsquo;t asked us to sort a collection yet.</p>
        <Link to={SORTING_PATH} className="gg-btn gg-btn-ghost">
          Collection sorting
        </Link>
      </div>
    );

  return (
    <div>
      {rows.map((r) => {
        const quote = quoteSummary(r);
        const link = `${SORTING_QUOTE_PATH}?${new URLSearchParams({ ref: r.reference_number, email: r.email }).toString()}`;
        return (
          <div className="gg-orderrow gg-sort-accountrow" key={r.id} style={{ cursor: "default" }}>
            <div>
              <strong>{r.reference_number}</strong>{" "}
              <span className="gg-card-meta">{new Date(r.created_at).toLocaleDateString()}</span>
              <div className="gg-card-meta">
                {r.option_name} · about {r.estimated_cards.toLocaleString("en-US")} cards ·{" "}
                {SORTING_DELIVERY_LABELS[r.delivery_method]}
              </div>
              {quote && <div className="gg-card-meta">{quote}</div>}
            </div>
            <div className="gg-orderrow-right">
              <span className="gg-card-meta">{sortingStatusLabel(r.status, r.delivery_method)}</span>
              <Link to={link} className="gg-btn gg-btn-ghost gg-btn-sm">
                {r.quote_status === "sent" ? "Review quote" : "View"}
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
