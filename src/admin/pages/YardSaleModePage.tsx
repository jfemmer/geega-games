import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ErrorState, Spinner } from "../components/ui/States";
import { FlyerPrintView } from "../components/partners/FlyerPrintView";
import { useToast } from "../hooks/useToast";
import { ADMIN_BASE } from "../hooks/useRouter";
import { formatCents } from "../utils/format";
import { useYardSaleSign } from "../hooks/useYardSaleSign";
import { yardSaleRepository } from "../repositories/yardSale.supabase";
import {
  DEFAULT_YARD_SALE_MIN_PRICE_CENTS,
  YARD_SALE_LIMITS,
  YARD_SALE_PATH,
  parseDiscountPercent,
  parseMinPriceCents,
  yardSaleTermsLine,
} from "../../store/lib/yardSale";
import type { YardSaleSnapshot } from "../types";

// Admin → Yard Sale Mode. Turning it on pauses online orders (customers can
// still browse) and opens /yard-sale, which the QR sign at the yard sale
// points to: shoppers see the website's cards at or above the minimum price,
// with the discount, and send pickup lists that land in Pickup Requests.
// When they pay in person, staff tap Complete there. The sale turns itself
// off at its end time; lists still open then stay held until each one is
// completed or cancelled. Rules live in the database
// (20261019050000_yard_sale_mode.sql); see api/admin/yard-sale.ts.

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Today at 3 PM, or (later in the day) three hours from now on the hour. */
function defaultEnd(now = new Date()): string {
  const threePm = new Date(now);
  threePm.setHours(15, 0, 0, 0);
  if (threePm.getTime() - now.getTime() >= 2 * 3600_000) return toLocalInput(threePm);
  const later = new Date(now.getTime() + 3 * 3600_000);
  later.setMinutes(0, 0, 0);
  later.setHours(later.getHours() + 1);
  return toLocalInput(later);
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `${time} today` : `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

type Settings = { endsAt: string; discountPercent: number; minPriceCents: number };

export function YardSaleModePage({ onNavigate }: { onNavigate?: (to: string) => void }) {
  const toast = useToast();
  const [snap, setSnap] = useState<YardSaleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discount, setDiscount] = useState("0");
  const [minPrice, setMinPrice] = useState((DEFAULT_YARD_SALE_MIN_PRICE_CENTS / 100).toFixed(2));
  const [endsAt, setEndsAt] = useState(() => defaultEnd());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | "save">(null);
  const [confirming, setConfirming] = useState<null | { kind: "start"; settings: Settings } | { kind: "end" }>(null);
  const sign = useYardSaleSign();

  const apply = useCallback((next: YardSaleSnapshot) => {
    setSnap(next);
    if (next.sale) {
      // The sale's settings: to edit one that's on, or to start the next one the same way.
      setDiscount(String(next.sale.discountPercent));
      setMinPrice((next.sale.minPriceCents / 100).toFixed(2));
      setEndsAt(next.sale.active ? toLocalInput(new Date(next.sale.endsAt)) : defaultEnd());
    }
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      apply(await yardSaleRepository.snapshot());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load Yard Sale Mode.");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    let alive = true;
    yardSaleRepository
      .snapshot()
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "Could not load Yard Sale Mode.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apply]);

  function retry() {
    setLoading(true);
    void fetchSnapshot();
  }

  const sale = snap?.sale ?? null;
  const active = !!sale?.active;
  const minPriceCents = parseMinPriceCents(minPrice);

  function readSettings(): Settings | null {
    const discountPercent = parseDiscountPercent(discount);
    if (discountPercent === null) {
      setFormError(`Enter a discount from 0 to ${YARD_SALE_LIMITS.maxDiscountPercent}% (whole numbers).`);
      return null;
    }
    if (minPriceCents === null) {
      setFormError("Enter the lowest card price to show, like 3 or 3.50.");
      return null;
    }
    const end = new Date(endsAt);
    if (!endsAt || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
      setFormError("Pick an end time that hasn't passed yet.");
      return null;
    }
    if (end.getTime() > Date.now() + YARD_SALE_LIMITS.maxDays * 86_400_000) {
      setFormError(`A yard sale can run for up to ${YARD_SALE_LIMITS.maxDays} days.`);
      return null;
    }
    setFormError(null);
    return { endsAt: end.toISOString(), discountPercent, minPriceCents };
  }

  async function start(settings: Settings) {
    try {
      apply(await yardSaleRepository.start(settings));
      toast.success(`Yard sale is on. Online orders are paused until ${timeLabel(settings.endsAt)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the yard sale.");
    } finally {
      setConfirming(null);
    }
  }

  async function save() {
    if (!sale) return;
    const settings = readSettings();
    if (!settings) return;
    setSaving("save");
    try {
      apply(await yardSaleRepository.update(sale.id, settings));
      toast.success("Yard sale updated. The yard sale page shows the change right away.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the yard sale.");
    } finally {
      setSaving(null);
    }
  }

  async function end() {
    if (!sale) return;
    try {
      const next = await yardSaleRepository.end(sale.id);
      apply(next);
      toast.success(
        next.openLists > 0
          ? `Yard sale ended and online orders are open. ${next.openLists === 1 ? "1 list is" : `${next.openLists} lists are`} still open in Pickup Requests.`
          : "Yard sale ended. Online orders are open again.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end the yard sale.");
    } finally {
      setConfirming(null);
    }
  }

  // The QR sign features a few of the most valuable cards at the sale's
  // terms: the sale's own while it's on, otherwise what's in the form (the
  // next sale's).
  function openSign() {
    void sign.open(
      active && sale
        ? { minPriceCents: sale.minPriceCents, discountPercent: sale.discountPercent }
        : {
            minPriceCents: minPriceCents ?? DEFAULT_YARD_SALE_MIN_PRICE_CENTS,
            discountPercent: parseDiscountPercent(discount) ?? 0,
          },
    );
  }

  function goToPickup(e: React.MouseEvent) {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(`${ADMIN_BASE}/pickup`);
  }

  const pageUrl = `${window.location.origin}${YARD_SALE_PATH}`;

  return (
    <div className="gg-page">
      <PageHeader
        title="Yard Sale Mode"
        description="For a yard sale: shoppers scan your QR sign to see the website's cards at or above a minimum price, with your discount, and send you a pickup list. Online orders are paused while it's on."
      />

      {loading ? (
        <Spinner label="Loading Yard Sale Mode" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={retry} />
      ) : (
        <>
          {snap && snap.openListsFromEndedSales > 0 && (
            <div className="gg-inline-note gg-inline-note--warning" role="alert">
              {/* One span, so the note's flex layout doesn't split the sentence around the link. */}
              <span>
                {snap.openListsFromEndedSales === 1 ? "1 list" : `${snap.openListsFromEndedSales} lists`} from a yard
                sale that's over {snap.openListsFromEndedSales === 1 ? "is" : "are"} still open. Complete the ones that
                were paid for and cancel the rest in{" "}
                <a href={`${ADMIN_BASE}/pickup`} onClick={goToPickup}>
                  Pickup Requests
                </a>
                , so the website shows the right stock.
              </span>
            </div>
          )}

          <div className="gg-sale-admin-grid">
            <SectionCard title={active ? "Change the sale" : "Start a yard sale"}>
              <form
                className="gg-sale-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (active) {
                    void save();
                    return;
                  }
                  const settings = readSettings();
                  if (settings) setConfirming({ kind: "start", settings });
                }}
              >
                <TextField
                  label="Discount on website cards (%)"
                  inputMode="numeric"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  hint="0 for no discount. Each card's price is rounded to the nearest dollar after the discount (never above its website price). You can change the discount during the sale; each list is charged at the discount when you complete it."
                />
                <TextField
                  label="Show cards priced at least ($)"
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  hint="Cheaper cards stay off the yard sale page."
                />
                <TextField
                  label="Ends at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  hint="Online orders reopen by themselves at this time."
                />
                {formError && (
                  <p className="gg-field__error" role="alert">
                    {formError}
                  </p>
                )}
                <div className="gg-btn-row">
                  {active ? (
                    <>
                      <Button type="submit" variant="primary" icon="check" loading={saving === "save"}>
                        Save changes
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={!!saving}
                        onClick={() => setConfirming({ kind: "end" })}
                      >
                        End yard sale now
                      </Button>
                    </>
                  ) : (
                    <Button type="submit" variant="primary" icon="tag">
                      Start yard sale
                    </Button>
                  )}
                </div>
              </form>
            </SectionCard>

            <SectionCard title="Current status">
              {active && sale ? (
                <div className="gg-sale-status">
                  <div className="gg-sale-status__top">
                    <Badge tone="gold" dot>
                      Yard sale on
                    </Badge>
                  </div>
                  <h3>Online orders are paused until {timeLabel(sale.endsAt)}.</h3>
                  <p>{yardSaleTermsLine(sale.minPriceCents, sale.discountPercent)}</p>
                  <dl className="gg-sale-status__details">
                    <div>
                      <dt>Lists sent</dt>
                      <dd>{sale.listsSent}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        {snap?.completedLists ?? 0} · {formatCents(snap?.completedTotalCents ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>Waiting in Pickup Requests</dt>
                      <dd>
                        <a href={`${ADMIN_BASE}/pickup`} onClick={goToPickup}>
                          {snap?.openLists ?? 0} open
                        </a>
                      </dd>
                    </div>
                  </dl>
                  <div className="gg-btn-row">
                    <Button variant="secondary" icon="printer" loading={sign.preparing} onClick={openSign}>
                      Print QR sign
                    </Button>
                    <a className="gg-btn gg-btn--secondary gg-btn--md" href={pageUrl} target="_blank" rel="noopener noreferrer">
                      <Icon name="external" size={17} />
                      <span>Open the yard sale page</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div className="gg-sale-status">
                  <div className="gg-sale-status__top">
                    <Badge tone="success" dot>
                      Taking online orders
                    </Badge>
                  </div>
                  <h3>Yard Sale Mode is off.</h3>
                  {sale ? (
                    <p>
                      Last yard sale ended {timeLabel(sale.endedAt ?? sale.endsAt)}: {snap?.completedLists ?? 0} list
                      {snap?.completedLists === 1 ? "" : "s"} completed · {formatCents(snap?.completedTotalCents ?? 0)}.
                    </p>
                  ) : (
                    <p>The yard sale page says there&rsquo;s no sale on until you start one.</p>
                  )}
                  <div className="gg-btn-row">
                    <Button variant="secondary" icon="printer" loading={sign.preparing} onClick={openSign}>
                      Print QR sign
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard title="How it works">
            <ol className="gg-yardmode-steps">
              <li>Start the sale and set out the QR sign. Online orders pause; people can still browse the website.</li>
              <li>
                Shoppers pick cards on their phone and send the list with their name. Each list gets a number and
                shows up in Pickup Requests (with a notification), with where each card is kept.
              </li>
              <li>
                When they&rsquo;ve paid you (cash or Venmo) for everything, tap <strong>Complete</strong> on their list.
                That records the sale and takes the cards off the website. Changed their mind about a card? Take it off
                the list first.
              </li>
              <li>
                The sale ends by itself at the end time. Lists still open then stay held until you complete or cancel
                each one.
              </li>
            </ol>
          </SectionCard>
        </>
      )}

      <ConfirmDialog
        open={confirming?.kind === "start"}
        title="Start the yard sale?"
        message={
          confirming?.kind === "start"
            ? `Online orders pause until ${timeLabel(confirming.settings.endsAt)} (people can still browse), and the yard sale page opens: ${yardSaleTermsLine(confirming.settings.minPriceCents, confirming.settings.discountPercent)}.`
            : ""
        }
        confirmLabel="Start yard sale"
        onConfirm={() => (confirming?.kind === "start" ? start(confirming.settings) : undefined)}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming?.kind === "end"}
        title="End the yard sale now?"
        message="Online orders reopen right away and the yard sale page closes. Lists that are still open stay held until you complete or cancel them."
        confirmLabel="End yard sale"
        tone="danger"
        onConfirm={() => end()}
        onCancel={() => setConfirming(null)}
      />
      {sign.job && <FlyerPrintView job={sign.job} onClose={sign.close} />}
    </div>
  );
}
