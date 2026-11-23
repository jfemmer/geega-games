import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../hooks/useToast";
import { adminFetch } from "../repositories/apiClient";
import {
  MAX_ORDER_LINES_CEILING,
  MIN_ORDER_LINES,
  isValidOrderLineLimit,
} from "../../store/lib/orderLimits";

// Checkout Settings: the most different cards one online order may have.
// Saved in store_settings.max_order_lines through
// /api/admin/checkout-settings; checkout enforces it in the database, and the
// cart and checkout page warn customers who are over it.

type SettingsResponse = {
  settings: { maxOrderLines: number; updatedAt: string };
  /** Signed-in customers' carts against the limit (null if they couldn't be counted). */
  carts: { largestLines: number; overLimit: number } | null;
};

const ENDPOINT = "/api/admin/checkout-settings";
const fmt = (n: number) => n.toLocaleString("en-US");

export function CheckoutSettingsPage() {
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        apply(await adminFetch<SettingsResponse>(ENDPOINT, { method: "GET" }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load checkout settings.");
      } finally {
        setLoading(false);
      }
    })();
    // toast is stable (ToastProvider memoizes it), so this loads once.
  }, [toast]);

  function apply(next: SettingsResponse) {
    setData(next);
    setValue(String(next.settings.maxOrderLines));
  }

  const parsed = value.trim() === "" ? Number.NaN : Number(value);
  const valid = isValidOrderLineLimit(parsed);
  const changed = data != null && valid && parsed !== data.settings.maxOrderLines;
  const error =
    value.trim() !== "" && !valid
      ? `Enter a whole number from ${MIN_ORDER_LINES} to ${fmt(MAX_ORDER_LINES_CEILING)}.`
      : undefined;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      apply(await adminFetch<SettingsResponse>(ENDPOINT, { method: "PUT", body: { maxOrderLines: parsed } }));
      toast.success(`Orders can now have up to ${fmt(parsed)} different cards.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save checkout settings.");
    } finally {
      setSaving(false);
    }
  }

  const limit = data?.settings.maxOrderLines;
  const carts = data?.carts ?? null;

  return (
    <div className="gg-page">
      <PageHeader
        title="Checkout Settings"
        description="Rules for online orders. Changes apply to the next checkout; the register is not affected."
      />

      <div className="gg-sale-admin-grid">
        <SectionCard title="Order size">
          <form
            className="gg-sale-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (changed) void save();
            }}
          >
            <TextField
              label="Most different cards in one order"
              type="number"
              inputMode="numeric"
              min={MIN_ORDER_LINES}
              max={MAX_ORDER_LINES_CEILING}
              step={1}
              value={value}
              disabled={loading}
              onChange={(e) => setValue(e.target.value)}
              error={error}
              hint={`Counts different cards, not copies: 4 copies of one card count as 1. From ${MIN_ORDER_LINES} to ${fmt(MAX_ORDER_LINES_CEILING)}. A customer over the limit is told how many cards to remove, in their cart and at checkout.`}
            />
            <div className="gg-btn-row">
              <Button type="submit" variant="primary" icon="check" loading={saving} disabled={loading || saving || !changed}>
                Save
              </Button>
              {changed && (
                <Button type="button" variant="ghost" disabled={saving} onClick={() => data && setValue(String(data.settings.maxOrderLines))}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Right now">
          {loading ? (
            <p className="gg-muted">Loading…</p>
          ) : limit == null ? (
            <p className="gg-muted">Couldn&rsquo;t load the current setting.</p>
          ) : (
            <div className="gg-sale-status">
              <div className="gg-sale-status__top">
                {carts && carts.overLimit > 0 ? (
                  <Badge tone="warning" dot>
                    {carts.overLimit === 1 ? "1 cart is over the limit" : `${fmt(carts.overLimit)} carts are over the limit`}
                  </Badge>
                ) : (
                  <Badge tone="success" dot>Every cart fits</Badge>
                )}
              </div>
              <h3>Orders can have up to {fmt(limit)} different cards.</h3>
              {carts && carts.overLimit > 0 && (
                <p>
                  {carts.overLimit === 1 ? "That customer can’t" : "Those customers can’t"} check out until the
                  limit is at least {fmt(carts.largestLines)} or they remove cards.
                </p>
              )}
              <dl className="gg-sale-status__details">
                <div>
                  <dt>Biggest cart</dt>
                  <dd>{carts ? `${fmt(carts.largestLines)} different cards` : "Couldn’t count carts"}</dd>
                </div>
                {data && (
                  <div>
                    <dt>Last changed</dt>
                    <dd>{new Date(data.settings.updatedAt).toLocaleString()}</dd>
                  </div>
                )}
              </dl>
              <p className="gg-muted" style={{ fontSize: "0.8rem" }}>
                Counts signed-in customers&rsquo; carts. Guests&rsquo; carts are kept in their browsers.
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
