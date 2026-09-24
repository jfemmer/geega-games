import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextArea, TextField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../hooks/useToast";
import { adminFetch } from "../repositories/apiClient";

// Vacation mode: pause online ordering with a message for customers.
// Enforced server-side by checkout_create_order; see api/admin/store-status.ts.

type StoreStatusRow = {
  orders_paused: boolean;
  orders_paused_message: string;
  orders_paused_until: string | null;
  updated_at: string;
};

type StatusResponse = { status: StoreStatusRow };

const MAX_MESSAGE = 500;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Paused, and (if a reopen time was set) that time hasn't passed yet. */
function isEffectivelyPaused(s: StoreStatusRow | null): boolean {
  if (!s?.orders_paused) return false;
  return !s.orders_paused_until || new Date(s.orders_paused_until).getTime() > Date.now();
}

export function VacationModePage() {
  const toast = useToast();
  const [status, setStatus] = useState<StoreStatusRow | null>(null);
  const [message, setMessage] = useState("");
  const [reopenAt, setReopenAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"pause" | "resume" | "update" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await adminFetch<StatusResponse>("/api/admin/store-status", { method: "GET" });
        applyStatus(result.status);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load vacation mode.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function applyStatus(s: StoreStatusRow) {
    setStatus(s);
    setMessage(s.orders_paused_message);
    setReopenAt(isEffectivelyPaused(s) && s.orders_paused_until ? toLocalInput(s.orders_paused_until) : "");
  }

  const paused = isEffectivelyPaused(status);

  async function save(ordersPaused: boolean, kind: "pause" | "resume" | "update") {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please enter a message for customers.");
      return;
    }
    if (ordersPaused && reopenAt && new Date(reopenAt).getTime() <= Date.now()) {
      toast.error("The reopen time must be in the future.");
      return;
    }
    setSaving(kind);
    try {
      const result = await adminFetch<StatusResponse>("/api/admin/store-status", {
        method: "PUT",
        body: {
          ordersPaused,
          message: trimmed,
          pausedUntil: ordersPaused && reopenAt ? new Date(reopenAt).toISOString() : null,
        },
      });
      applyStatus(result.status);
      toast.success(
        kind === "pause"
          ? "Online orders are paused."
          : kind === "resume"
            ? "Online orders are open again."
            : "Vacation message updated.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save vacation mode.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="gg-page">
      <PageHeader
        title="Vacation Mode"
        description="Pause online ordering while you're away. Customers can still browse and add cards to their cart; checkout is turned off and your message is shown across the site. The register is not affected."
      />

      <div className="gg-sale-admin-grid">
        <SectionCard title="Settings">
          <div className="gg-sale-form">
            <TextArea
              label="Message for customers"
              rows={4}
              maxLength={MAX_MESSAGE}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              hint={`Shown in a banner on every page, in the cart and at checkout. ${message.length}/${MAX_MESSAGE}`}
            />

            <TextField
              label="Reopen automatically (optional)"
              type="datetime-local"
              value={reopenAt}
              onChange={(e) => setReopenAt(e.target.value)}
              hint="Checkout turns back on by itself at this time, and customers see the date. Leave empty to reopen manually."
            />

            <div className="gg-btn-row">
              {paused ? (
                <>
                  <Button variant="primary" icon="check" loading={saving === "resume"} disabled={!!saving} onClick={() => save(false, "resume")}>
                    Resume orders now
                  </Button>
                  <Button variant="secondary" loading={saving === "update"} disabled={!!saving} onClick={() => save(true, "update")}>
                    Save changes
                  </Button>
                </>
              ) : (
                <Button variant="danger" icon="clock" loading={saving === "pause"} disabled={loading || !!saving} onClick={() => save(true, "pause")}>
                  Pause online orders
                </Button>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Current status">
          {loading ? (
            <p className="gg-muted">Loading…</p>
          ) : paused && status ? (
            <div className="gg-sale-status">
              <div className="gg-sale-status__top">
                <Badge tone="warning" dot>Orders paused</Badge>
              </div>
              <h3>Customers can&rsquo;t check out right now.</h3>
              <p>{status.orders_paused_message}</p>
              <dl className="gg-sale-status__details">
                <div>
                  <dt>Reopens</dt>
                  <dd>
                    {status.orders_paused_until
                      ? new Date(status.orders_paused_until).toLocaleString()
                      : "When you resume manually"}
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{new Date(status.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="gg-sale-status">
              <div className="gg-sale-status__top">
                <Badge tone="success" dot>Taking orders</Badge>
              </div>
              <h3>Online checkout is open.</h3>
              <p>Customers can place orders as usual.</p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
