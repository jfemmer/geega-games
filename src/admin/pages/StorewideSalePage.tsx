import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/Field";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../hooks/useToast";
import { adminFetch } from "../repositories/apiClient";

type SaleRow = {
  id: string;
  name: string;
  discount_percent: number;
  starts_at: string;
  ends_at: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type SaleResponse = { sale: SaleRow | null };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function StorewideSalePage() {
  const toast = useToast();
  const [sale, setSale] = useState<SaleRow | null>(null);
  const [name, setName] = useState("Storewide Sale");
  const [discount, setDiscount] = useState("15");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(() =>
    toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminFetch<SaleResponse>("/api/admin/storewide-sale", {
        method: "GET",
      });
      setSale(result.sale);
      if (result.sale) {
        setName(result.sale.name);
        setDiscount(String(result.sale.discount_percent));
        setStartsAt(toLocalInput(result.sale.starts_at));
        setEndsAt(toLocalInput(result.sale.ends_at));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sale settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const saleState = useMemo(() => {
    if (!sale?.enabled) return "none" as const;
    const start = new Date(sale.starts_at).getTime();
    const end = new Date(sale.ends_at).getTime();
    if (now < start) return "scheduled" as const;
    if (now < end) return "active" as const;
    return "ended" as const;
  }, [sale, now]);

  const countdown = useMemo(() => {
    if (!sale) return null;
    const target =
      saleState === "scheduled"
        ? new Date(sale.starts_at).getTime()
        : new Date(sale.ends_at).getTime();
    return formatCountdown(target - now);
  }, [sale, saleState, now]);

  async function saveSale() {
    const pct = Math.round(Number(discount));
    if (!Number.isFinite(pct) || pct < 1 || pct > 90) {
      toast.error("Discount must be between 1% and 90%.");
      return;
    }
    if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      toast.error("End time must be after the start time.");
      return;
    }

    setSaving(true);
    try {
      const result = await adminFetch<SaleResponse>("/api/admin/storewide-sale", {
        method: "PUT",
        body: {
          name: name.trim() || "Storewide Sale",
          discountPercent: pct,
          startsAt: fromLocalInput(startsAt),
          endsAt: fromLocalInput(endsAt),
        },
      });
      setSale(result.sale);
      toast.success(
        new Date(result.sale?.starts_at ?? 0).getTime() <= Date.now()
          ? "Storewide sale is live."
          : "Storewide sale scheduled.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the sale.");
    } finally {
      setSaving(false);
    }
  }

  async function stopSale() {
    setStopping(true);
    try {
      await adminFetch("/api/admin/storewide-sale", { method: "DELETE" });
      setSale(null);
      toast.success("Storewide sale stopped.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not stop the sale.");
    } finally {
      setStopping(false);
    }
  }

  function startNow() {
    setStartsAt(toLocalInput(new Date().toISOString()));
    if (new Date(endsAt).getTime() <= Date.now()) {
      setEndsAt(toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
    }
  }

  return (
    <div className="gg-page">
      <PageHeader
        title="Storewide Sale"
        description="Schedule a temporary discount across the storefront and register. Existing card deals do not stack — customers automatically receive the lower price."
      />

      <div className="gg-sale-admin-grid">
        <SectionCard title="Sale controls">
          <div className="gg-sale-form">
            <TextField
              label="Sale name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekend Sale"
              hint="Shown to customers in the sale banner."
            />

            <TextField
              label="Discount (%)"
              type="number"
              min={1}
              max={90}
              step={1}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              hint="Applied storewide unless an existing deal is already cheaper."
            />

            <div className="gg-sale-time-grid">
              <TextField
                label="Starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
              <TextField
                label="Ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>

            <div className="gg-btn-row">
              <Button variant="secondary" icon="clock" onClick={startNow}>
                Start now
              </Button>
              <Button variant="primary" icon="sparkle" loading={saving} onClick={saveSale}>
                {sale ? "Update sale" : "Schedule sale"}
              </Button>
              {sale && (
                <Button variant="danger" loading={stopping} onClick={stopSale}>
                  Stop sale
                </Button>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Current status">
          {loading ? (
            <p className="gg-muted">Loading sale status…</p>
          ) : !sale ? (
            <div className="gg-sale-status gg-sale-status--idle">
              <Badge tone="neutral">No sale</Badge>
              <h3>No storewide sale is scheduled.</h3>
              <p>Your normal inventory and Deals & Specials pricing is active.</p>
            </div>
          ) : (
            <div className={`gg-sale-status gg-sale-status--${saleState}`}>
              <div className="gg-sale-status__top">
                <Badge tone={saleState === "active" ? "success" : saleState === "scheduled" ? "purple" : "neutral"}>
                  {saleState === "active" ? "Live" : saleState === "scheduled" ? "Scheduled" : "Ended"}
                </Badge>
                <strong>{sale.discount_percent}% off</strong>
              </div>
              <h3>{sale.name}</h3>
              {(saleState === "active" || saleState === "scheduled") && (
                <div className="gg-sale-status__timer">
                  <span>{saleState === "active" ? "Ends in" : "Starts in"}</span>
                  <strong>{countdown}</strong>
                </div>
              )}
              <dl className="gg-sale-status__details">
                <div><dt>Starts</dt><dd>{new Date(sale.starts_at).toLocaleString()}</dd></div>
                <div><dt>Ends</dt><dd>{new Date(sale.ends_at).toLocaleString()}</dd></div>
              </dl>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
