import { useEffect, useState, type ReactNode } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Badge } from "../../components/ui/Badge";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { adminFetch } from "../../repositories/apiClient";
import { formatCents } from "../../../store/lib/money";
import { CHANNEL_LABELS, CONSIGNMENT_CHANNELS, formatBps, parseDollarsToCents, type ConsignmentChannel } from "../../../store/lib/consignmentMath";

// Consignment Settings: commission tiers, each channel's fees, USPS insurance
// rates, and the estimator and term defaults. Rates are effective-dated: a
// change is a new schedule starting now or later, never an edit to one in
// effect, so signed agreements and past payouts keep the terms they had.
// Saving needs the owner (the API refuses staff).

type FeeBase = "item" | "item_shipping" | "item_shipping_tax";

interface FeeRow {
  id: string;
  channel: ConsignmentChannel;
  effective_from: string;
  marketplace_bps: number;
  marketplace_threshold_cents: number | null;
  marketplace_above_threshold_bps: number | null;
  marketplace_base: FeeBase;
  per_order_cents: number;
  per_order_small_cents: number | null;
  per_order_small_max_cents: number | null;
  processing_bps: number;
  processing_fixed_cents: number;
  processing_base: FeeBase;
  source_note: string | null;
  created_by: string | null;
}
interface InsuranceRow {
  id: string;
  effective_from: string;
  service: string;
  included_coverage_cents: number;
  brackets: { maxValueCents: number; premiumCents: number }[];
  step_cents: number;
  step_premium_cents: number;
  max_insurable_cents: number;
  source_url: string | null;
  source_note: string | null;
}
interface CommissionRow {
  id: string;
  effective_from: string;
  tiers: { maxPriceCents: number | null; rateBps: number }[];
  source_note: string | null;
}
interface BuyerTerms {
  shippingCents: number;
  freeShippingAtCents: number | null;
  salesTaxBps: number;
}
interface SettingsRow {
  default_postage_cents: number;
  buyer_terms: Partial<Record<ConsignmentChannel, BuyerTerms>>;
  estimator_insurance_default: boolean;
  min_card_value_cents: number;
  initial_term_days: number;
  inspection_days: number;
  payout_methods: string[];
  updated_at: string;
  updated_by: string | null;
}
interface SettingsResponse {
  feeSchedules: FeeRow[];
  insuranceSchedules: InsuranceRow[];
  commissionSchedules: CommissionRow[];
  settings: SettingsRow | null;
}

const FEE_BASE_LABELS: Record<FeeBase, string> = {
  item: "Card price only",
  item_shipping: "Card price + buyer shipping",
  item_shipping_tax: "Card price + shipping + sales tax",
};
const PAYOUT_METHOD_LABELS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "Check",
  ach: "Bank transfer (ACH)",
  store_credit: "Store credit",
};

const dollars = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));
const percent = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100));
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** "10.75" → 1075 basis points, or null when it isn't a percentage with up to 2 decimals. */
function bpsFrom(text: string): number | null {
  const t = text.trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Optional money field: "" → null; bad input → undefined. */
function optionalCents(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  return parseDollarsToCents(text) ?? undefined;
}

function startIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

/** The schedule in effect now, plus any set to start later. */
function split<T extends { effective_from: string }>(rows: T[], now = Date.now()) {
  const sorted = [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const upcoming = sorted.filter((r) => new Date(r.effective_from).getTime() > now).reverse();
  const current = sorted.find((r) => new Date(r.effective_from).getTime() <= now) ?? null;
  const past = sorted.filter((r) => new Date(r.effective_from).getTime() <= now && r !== current);
  return { current, upcoming, past };
}

function tierLines(tiers: CommissionRow["tiers"]): string[] {
  const sorted = [...tiers].sort((a, b) => (a.maxPriceCents ?? Infinity) - (b.maxPriceCents ?? Infinity));
  return sorted.map((t, i) => {
    const prev = i > 0 ? sorted[i - 1].maxPriceCents : null;
    const range =
      t.maxPriceCents == null
        ? prev == null
          ? "Every card"
          : `${formatCents(prev + 1)} or more`
        : prev == null
          ? `${formatCents(t.maxPriceCents)} or less`
          : `${formatCents(prev + 1)} to ${formatCents(t.maxPriceCents)}`;
    return `${range}: ${formatBps(t.rateBps)} of the Net Sale Amount`;
  });
}

function feeSummary(f: FeeRow): string {
  const parts: string[] = [];
  if (f.marketplace_bps > 0) {
    parts.push(
      f.marketplace_threshold_cents != null && f.marketplace_above_threshold_bps != null
        ? `${formatBps(f.marketplace_bps)} up to ${formatCents(f.marketplace_threshold_cents)}, ${formatBps(f.marketplace_above_threshold_bps)} above`
        : `${formatBps(f.marketplace_bps)} marketplace fee`,
    );
  }
  if (f.per_order_cents > 0) {
    parts.push(
      f.per_order_small_cents != null && f.per_order_small_max_cents != null
        ? `${formatCents(f.per_order_cents)} per order (${formatCents(f.per_order_small_cents)} at ${formatCents(f.per_order_small_max_cents)} or less)`
        : `${formatCents(f.per_order_cents)} per order`,
    );
  }
  if (f.processing_bps > 0 || f.processing_fixed_cents > 0) {
    parts.push(`processing ${formatBps(f.processing_bps)} + ${formatCents(f.processing_fixed_cents)}`);
  } else if (f.channel !== "website") {
    parts.push("processing included");
  }
  return parts.join(" · ") || "No fees";
}

function Upcoming<T extends { id: string; effective_from: string }>({
  rows,
  render,
  onRemove,
  busyId,
}: {
  rows: T[];
  render: (row: T) => ReactNode;
  onRemove: (row: T) => void;
  busyId: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="gg-cs-upcoming">
      {rows.map((r) => (
        <li key={r.id}>
          <Badge tone="purple">Starts {when(r.effective_from)}</Badge>
          <span>{render(r)}</span>
          <Button size="sm" variant="ghost" loading={busyId === r.id} onClick={() => onRemove(r)}>
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function StartField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label="Starts"
      type="datetime-local"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      hint="Leave empty to start now. Rates can't start in the past."
    />
  );
}

export function ConsignmentSettingsPanel({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setData(await adminFetch<SettingsResponse>("/api/admin/consignments?view=settings"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load consignment settings.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function send(action: string, body: Record<string, unknown>, done: string, key: string): Promise<boolean> {
    setBusy(key);
    try {
      setData(await adminFetch<SettingsResponse>("/api/admin/consignments", { method: "POST", body: { action, ...body } }));
      toast.success(done);
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------- commission form
  const [tierRows, setTierRows] = useState<{ top: string; rate: string }[]>([
    { top: "150.00", rate: "20" },
    { top: "", rate: "10" },
  ]);
  const [tierStart, setTierStart] = useState("");
  const [tierNote, setTierNote] = useState("");

  async function saveTiers() {
    const tiers = [];
    for (const [i, r] of tierRows.entries()) {
      const rateBps = bpsFrom(r.rate);
      const maxPriceCents = optionalCents(r.top);
      if (rateBps == null || maxPriceCents === undefined) {
        toast.error(`Check tier ${i + 1}: a top price in dollars (or empty for "and above") and a rate in percent.`);
        return;
      }
      tiers.push({ maxPriceCents, rateBps });
    }
    const ok = await send("addCommissionSchedule", { tiers, effectiveFrom: startIso(tierStart), sourceNote: tierNote }, "New commission tiers saved.", "tiers");
    if (ok) {
      setTierStart("");
      setTierNote("");
    }
  }

  // ---------------------------------------------------- fee form
  const [feeChannel, setFeeChannel] = useState<ConsignmentChannel>("tcgplayer");
  const [fee, setFee] = useState({
    marketplace: "",
    base: "item_shipping" as FeeBase,
    threshold: "",
    above: "",
    perOrder: "",
    small: "",
    smallMax: "",
    processing: "",
    processingFixed: "",
    processingBase: "item_shipping_tax" as FeeBase,
    start: "",
    note: "",
  });

  function prefillFee(channel: ConsignmentChannel) {
    setFeeChannel(channel);
    const current = data ? split(data.feeSchedules.filter((f) => f.channel === channel)).current : null;
    if (!current) return;
    setFee({
      marketplace: percent(current.marketplace_bps),
      base: current.marketplace_base,
      threshold: dollars(current.marketplace_threshold_cents),
      above: percent(current.marketplace_above_threshold_bps),
      perOrder: dollars(current.per_order_cents),
      small: dollars(current.per_order_small_cents),
      smallMax: dollars(current.per_order_small_max_cents),
      processing: percent(current.processing_bps),
      processingFixed: dollars(current.processing_fixed_cents),
      processingBase: current.processing_base,
      start: "",
      note: "",
    });
  }
  useEffect(() => {
    if (data) prefillFee(feeChannel);
    // Prefill once the schedules arrive; later edits are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null]);

  async function saveFees() {
    const marketplaceBps = bpsFrom(fee.marketplace || "0");
    const above = fee.above.trim() === "" ? null : bpsFrom(fee.above);
    const threshold = optionalCents(fee.threshold);
    const perOrder = parseDollarsToCents(fee.perOrder || "0");
    const small = optionalCents(fee.small);
    const smallMax = optionalCents(fee.smallMax);
    const processingBps = bpsFrom(fee.processing || "0");
    const processingFixed = parseDollarsToCents(fee.processingFixed || "0");
    if (
      marketplaceBps == null || (fee.above.trim() !== "" && above == null) || threshold === undefined || perOrder == null ||
      small === undefined || smallMax === undefined || processingBps == null || processingFixed == null
    ) {
      toast.error("Check the fee fields: percentages like 10.75, dollar amounts like 0.30.");
      return;
    }
    const ok = await send(
      "addFeeSchedule",
      {
        channel: feeChannel,
        marketplaceBps,
        marketplaceBase: fee.base,
        marketplaceThresholdCents: threshold,
        marketplaceAboveThresholdBps: above,
        perOrderCents: perOrder,
        perOrderSmallCents: small,
        perOrderSmallMaxCents: smallMax,
        processingBps,
        processingFixedCents: processingFixed,
        processingBase: fee.processingBase,
        effectiveFrom: startIso(fee.start),
        sourceNote: fee.note,
      },
      `New ${CHANNEL_LABELS[feeChannel]} fees saved.`,
      "fees",
    );
    if (ok) setFee((f) => ({ ...f, start: "", note: "" }));
  }

  // ---------------------------------------------------- insurance form
  const [ins, setIns] = useState({ included: "100.00", step: "100.00", stepPremium: "1.50", max: "5000.00", sourceUrl: "", start: "", note: "" });
  const [brackets, setBrackets] = useState<{ top: string; premium: string }[]>([]);
  useEffect(() => {
    if (!data) return;
    const current = split(data.insuranceSchedules).current;
    if (!current) return;
    setIns({
      included: dollars(current.included_coverage_cents),
      step: dollars(current.step_cents),
      stepPremium: dollars(current.step_premium_cents),
      max: dollars(current.max_insurable_cents),
      sourceUrl: current.source_url ?? "",
      start: "",
      note: "",
    });
    setBrackets(current.brackets.map((b) => ({ top: dollars(b.maxValueCents), premium: dollars(b.premiumCents) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null]);

  async function saveInsurance() {
    const parsed = brackets.map((b) => ({ maxValueCents: parseDollarsToCents(b.top), premiumCents: parseDollarsToCents(b.premium) }));
    const included = parseDollarsToCents(ins.included);
    const step = parseDollarsToCents(ins.step);
    const stepPremium = parseDollarsToCents(ins.stepPremium);
    const max = parseDollarsToCents(ins.max);
    if (parsed.some((b) => b.maxValueCents == null || b.premiumCents == null) || included == null || step == null || stepPremium == null || max == null) {
      toast.error("Check the insurance fields: every amount in dollars, like 4.50.");
      return;
    }
    const ok = await send(
      "addInsuranceSchedule",
      {
        includedCoverageCents: included,
        brackets: parsed,
        stepCents: step,
        stepPremiumCents: stepPremium,
        maxInsurableCents: max,
        sourceUrl: ins.sourceUrl,
        effectiveFrom: startIso(ins.start),
        sourceNote: ins.note,
      },
      "New insurance rates saved.",
      "insurance",
    );
    if (ok) setIns((s) => ({ ...s, start: "", note: "" }));
  }

  // ---------------------------------------------------- estimator & terms form
  const [terms, setTerms] = useState<{
    postage: string;
    buyer: Record<ConsignmentChannel, { shipping: string; freeAt: string; tax: string }>;
    insuranceDefault: boolean;
    minValue: string;
    termDays: string;
    inspectionDays: string;
    methods: string[];
  } | null>(null);
  useEffect(() => {
    const s = data?.settings;
    if (!s) return;
    const buyer = {} as Record<ConsignmentChannel, { shipping: string; freeAt: string; tax: string }>;
    for (const c of CONSIGNMENT_CHANNELS) {
      const t = s.buyer_terms[c];
      buyer[c] = { shipping: dollars(t?.shippingCents ?? 0), freeAt: dollars(t?.freeShippingAtCents ?? null), tax: percent(t?.salesTaxBps ?? 0) };
    }
    setTerms({
      postage: dollars(s.default_postage_cents),
      buyer,
      insuranceDefault: s.estimator_insurance_default,
      minValue: dollars(s.min_card_value_cents),
      termDays: String(s.initial_term_days),
      inspectionDays: String(s.inspection_days),
      methods: s.payout_methods,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null]);

  async function saveTerms() {
    if (!terms) return;
    const buyerTerms: Record<string, BuyerTerms> = {};
    for (const c of CONSIGNMENT_CHANNELS) {
      const b = terms.buyer[c];
      const shippingCents = parseDollarsToCents(b.shipping || "0");
      const freeShippingAtCents = optionalCents(b.freeAt);
      const salesTaxBps = bpsFrom(b.tax || "0");
      if (shippingCents == null || freeShippingAtCents === undefined || salesTaxBps == null) {
        toast.error(`Check ${CHANNEL_LABELS[c]}'s buyer shipping and tax.`);
        return;
      }
      buyerTerms[c] = { shippingCents, freeShippingAtCents, salesTaxBps };
    }
    const postage = parseDollarsToCents(terms.postage);
    const minValue = parseDollarsToCents(terms.minValue || "0");
    if (postage == null || minValue == null) {
      toast.error("Check the dollar amounts.");
      return;
    }
    await send(
      "updateSettings",
      {
        defaultPostageCents: postage,
        buyerTerms,
        estimatorInsuranceDefault: terms.insuranceDefault,
        minCardValueCents: minValue,
        initialTermDays: Number(terms.termDays),
        inspectionDays: Number(terms.inspectionDays),
        payoutMethods: terms.methods,
      },
      "Estimator and term settings saved.",
      "terms",
    );
  }

  function remove(kind: "fee" | "insurance" | "commission", id: string) {
    if (!window.confirm("Remove these scheduled rates? They haven't started yet.")) return;
    void send("deleteSchedule", { kind, id }, "Scheduled rates removed.", id);
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;
  if (!data) return <Spinner label="Loading consignment settings" />;

  const commission = split(data.commissionSchedules);
  const insurance = split(data.insuranceSchedules);

  return (
    <div className="gg-cs">
      <p className="gg-cs-lead">
        Rates are dated. A change starts now or later and never edits rates already in effect, so signed agreements and finished payouts keep
        the terms they had. Only the owner can save changes.
      </p>

      <SectionCard title="Commission tiers">
        {commission.current ? (
          <div className="gg-cs-current">
            <Badge tone="success">In effect since {when(commission.current.effective_from)}</Badge>
            <ul>
              {tierLines(commission.current.tiers).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="gg-muted">The tier is chosen by each card's own selling price. These apply to agreements signed from now on.</p>
          </div>
        ) : (
          <p className="gg-muted">No commission tiers are in effect.</p>
        )}
        <Upcoming rows={commission.upcoming} busyId={busy} onRemove={(r) => remove("commission", r.id)} render={(r) => tierLines(r.tiers).join("; ")} />
        <details className="gg-cs-form">
          <summary>New commission tiers</summary>
          {tierRows.map((r, i) => (
            <div key={i} className="gg-cs-row">
              <TextField
                label={`Tier ${i + 1}: top price ($)`}
                inputMode="decimal"
                value={r.top}
                placeholder="Empty = and above"
                onChange={(e) => setTierRows((rows) => rows.map((x, j) => (j === i ? { ...x, top: e.target.value } : x)))}
              />
              <TextField
                label="Rate (%)"
                inputMode="decimal"
                value={r.rate}
                onChange={(e) => setTierRows((rows) => rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
              />
              {tierRows.length > 1 && (
                <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove tier ${i + 1}`} onClick={() => setTierRows((rows) => rows.filter((_, j) => j !== i))} />
              )}
            </div>
          ))}
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setTierRows((rows) => [...rows, { top: "", rate: "" }])}>
            Add tier
          </Button>
          <StartField value={tierStart} onChange={setTierStart} />
          <TextField label="Note (optional)" value={tierNote} onChange={(e) => setTierNote(e.target.value)} />
          <div className="gg-btn-row">
            <Button variant="primary" loading={busy === "tiers"} onClick={() => void saveTiers()}>
              Save commission tiers
            </Button>
          </div>
        </details>
      </SectionCard>

      <SectionCard title="Sales channel fees">
        <table className="gg-cs-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">In effect now</th>
              <th scope="col">Since</th>
            </tr>
          </thead>
          <tbody>
            {CONSIGNMENT_CHANNELS.map((c) => {
              const s = split(data.feeSchedules.filter((f) => f.channel === c));
              return (
                <tr key={c}>
                  <th scope="row">{CHANNEL_LABELS[c]}</th>
                  <td>
                    {s.current ? feeSummary(s.current) : <span className="gg-muted">No rates</span>}
                    {s.current?.source_note && <span className="gg-cs-note">{s.current.source_note}</span>}
                  </td>
                  <td>{s.current ? when(s.current.effective_from) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Upcoming
          rows={data.feeSchedules.filter((f) => new Date(f.effective_from).getTime() > Date.now())}
          busyId={busy}
          onRemove={(r) => remove("fee", r.id)}
          render={(r) => `${CHANNEL_LABELS[r.channel]}: ${feeSummary(r)}`}
        />
        <details className="gg-cs-form">
          <summary>New fees for a channel</summary>
          <SelectField label="Channel" value={feeChannel} onChange={(e) => prefillFee(e.target.value as ConsignmentChannel)}>
            {CONSIGNMENT_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </SelectField>
          <div className="gg-cs-row">
            <TextField label="Marketplace fee (%)" inputMode="decimal" value={fee.marketplace} onChange={(e) => setFee({ ...fee, marketplace: e.target.value })} />
            <SelectField label="Charged on" value={fee.base} onChange={(e) => setFee({ ...fee, base: e.target.value as FeeBase })}>
              {Object.entries(FEE_BASE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="gg-cs-row">
            <TextField
              label="Lower rate above ($ per item)"
              inputMode="decimal"
              value={fee.threshold}
              placeholder="None"
              onChange={(e) => setFee({ ...fee, threshold: e.target.value })}
            />
            <TextField label="Rate above it (%)" inputMode="decimal" value={fee.above} placeholder="None" onChange={(e) => setFee({ ...fee, above: e.target.value })} />
          </div>
          <div className="gg-cs-row">
            <TextField label="Per-order fee ($)" inputMode="decimal" value={fee.perOrder} onChange={(e) => setFee({ ...fee, perOrder: e.target.value })} />
            <TextField label="Small-order fee ($)" inputMode="decimal" value={fee.small} placeholder="None" onChange={(e) => setFee({ ...fee, small: e.target.value })} />
            <TextField label="…for orders up to ($)" inputMode="decimal" value={fee.smallMax} placeholder="None" onChange={(e) => setFee({ ...fee, smallMax: e.target.value })} />
          </div>
          <div className="gg-cs-row">
            <TextField
              label="Payment processing (%)"
              inputMode="decimal"
              value={fee.processing}
              hint="0 when the marketplace fee includes it (eBay)."
              onChange={(e) => setFee({ ...fee, processing: e.target.value })}
            />
            <TextField label="Processing per order ($)" inputMode="decimal" value={fee.processingFixed} onChange={(e) => setFee({ ...fee, processingFixed: e.target.value })} />
            <SelectField label="Processing charged on" value={fee.processingBase} onChange={(e) => setFee({ ...fee, processingBase: e.target.value as FeeBase })}>
              {Object.entries(FEE_BASE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>
          <StartField value={fee.start} onChange={(v) => setFee({ ...fee, start: v })} />
          <TextField label="Source or note (optional)" value={fee.note} onChange={(e) => setFee({ ...fee, note: e.target.value })} />
          <div className="gg-btn-row">
            <Button variant="primary" loading={busy === "fees"} onClick={() => void saveFees()}>
              Save {CHANNEL_LABELS[feeChannel]} fees
            </Button>
          </div>
        </details>
      </SectionCard>

      <SectionCard title="USPS insurance rates">
        {insurance.current ? (
          <div className="gg-cs-current">
            <Badge tone="success">In effect since {when(insurance.current.effective_from)}</Badge>
            <p>
              {insurance.current.service}: {formatCents(insurance.current.included_coverage_cents)} included. Additional insurance by total package
              value:
            </p>
            <table className="gg-cs-table gg-cs-table--narrow">
              <thead>
                <tr>
                  <th scope="col">Package value up to</th>
                  <th scope="col">Premium</th>
                </tr>
              </thead>
              <tbody>
                {insurance.current.brackets.map((b) => (
                  <tr key={b.maxValueCents}>
                    <td>{formatCents(b.maxValueCents)}</td>
                    <td>{formatCents(b.premiumCents)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Above, up to {formatCents(insurance.current.max_insurable_cents)}</td>
                  <td>
                    + {formatCents(insurance.current.step_premium_cents)} per {formatCents(insurance.current.step_cents)} or part
                  </td>
                </tr>
              </tbody>
            </table>
            {insurance.current.source_url && (
              <p className="gg-muted">
                Source:{" "}
                <a href={insurance.current.source_url} target="_blank" rel="noreferrer">
                  {insurance.current.source_url}
                </a>
              </p>
            )}
            <p className="gg-muted">For estimates only. Final payouts use the premium USPS actually charges for the label.</p>
          </div>
        ) : (
          <p className="gg-muted">No insurance rates are in effect.</p>
        )}
        <Upcoming rows={insurance.upcoming} busyId={busy} onRemove={(r) => remove("insurance", r.id)} render={(r) => `${r.brackets.length} brackets`} />
        <details className="gg-cs-form">
          <summary>New insurance rates</summary>
          <div className="gg-cs-row">
            <TextField label="Included coverage ($)" inputMode="decimal" value={ins.included} onChange={(e) => setIns({ ...ins, included: e.target.value })} />
            <TextField label="Most USPS insures ($)" inputMode="decimal" value={ins.max} onChange={(e) => setIns({ ...ins, max: e.target.value })} />
          </div>
          {brackets.map((b, i) => (
            <div key={i} className="gg-cs-row">
              <TextField
                label={`Bracket ${i + 1}: value up to ($)`}
                inputMode="decimal"
                value={b.top}
                onChange={(e) => setBrackets((rows) => rows.map((x, j) => (j === i ? { ...x, top: e.target.value } : x)))}
              />
              <TextField
                label="Premium ($)"
                inputMode="decimal"
                value={b.premium}
                onChange={(e) => setBrackets((rows) => rows.map((x, j) => (j === i ? { ...x, premium: e.target.value } : x)))}
              />
              <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove bracket ${i + 1}`} onClick={() => setBrackets((rows) => rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setBrackets((rows) => [...rows, { top: "", premium: "" }])}>
            Add bracket
          </Button>
          <div className="gg-cs-row">
            <TextField label="Above the last bracket, each ($)" inputMode="decimal" value={ins.step} onChange={(e) => setIns({ ...ins, step: e.target.value })} />
            <TextField label="…adds ($)" inputMode="decimal" value={ins.stepPremium} onChange={(e) => setIns({ ...ins, stepPremium: e.target.value })} />
          </div>
          <TextField label="Source link" value={ins.sourceUrl} placeholder="https://pe.usps.com/..." onChange={(e) => setIns({ ...ins, sourceUrl: e.target.value })} />
          <StartField value={ins.start} onChange={(v) => setIns({ ...ins, start: v })} />
          <TextField label="Note (optional)" value={ins.note} onChange={(e) => setIns({ ...ins, note: e.target.value })} />
          <div className="gg-btn-row">
            <Button variant="primary" loading={busy === "insurance"} onClick={() => void saveInsurance()}>
              Save insurance rates
            </Button>
          </div>
        </details>
      </SectionCard>

      {terms && (
        <SectionCard title="Estimator and terms">
          <p className="gg-muted">
            The estimator uses these for a single card. The term, inspection period and payout methods go into agreements signed from now on.
            {data.settings?.updated_by ? ` Last changed by ${data.settings.updated_by}, ${when(data.settings.updated_at)}.` : ""}
          </p>
          <div className="gg-cs-row">
            <TextField
              label="Typical postage for one card ($)"
              inputMode="decimal"
              value={terms.postage}
              hint="USPS Ground Advantage. Shown as an estimate, never a quote."
              onChange={(e) => setTerms({ ...terms, postage: e.target.value })}
            />
            <TextField
              label="Minimum accepted card value ($)"
              inputMode="decimal"
              value={terms.minValue}
              hint="0 for no minimum."
              onChange={(e) => setTerms({ ...terms, minValue: e.target.value })}
            />
          </div>
          <table className="gg-cs-table">
            <caption className="gg-cs-caption">What a buyer typically pays on a one-card order</caption>
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Shipping ($)</th>
                <th scope="col">Free at ($)</th>
                <th scope="col">Sales tax (%)</th>
              </tr>
            </thead>
            <tbody>
              {CONSIGNMENT_CHANNELS.map((c) => (
                <tr key={c}>
                  <th scope="row">{CHANNEL_LABELS[c]}</th>
                  {(["shipping", "freeAt", "tax"] as const).map((k) => (
                    <td key={k}>
                      <input
                        className="gg-input gg-cs-cell"
                        inputMode="decimal"
                        aria-label={`${CHANNEL_LABELS[c]} ${k === "shipping" ? "shipping" : k === "freeAt" ? "free shipping at" : "sales tax"}`}
                        value={terms.buyer[c][k]}
                        placeholder={k === "freeAt" ? "Never" : "0"}
                        onChange={(e) => setTerms({ ...terms, buyer: { ...terms.buyer, [c]: { ...terms.buyer[c], [k]: e.target.value } } })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <label className="gg-cs-check">
            <input type="checkbox" checked={terms.insuranceDefault} onChange={(e) => setTerms({ ...terms, insuranceDefault: e.target.checked })} />
            Start the estimator with additional insurance on (estimates only; never anyone's election)
          </label>
          <div className="gg-cs-row">
            <TextField label="Initial term (days)" type="number" min={1} value={terms.termDays} onChange={(e) => setTerms({ ...terms, termDays: e.target.value })} />
            <TextField
              label="Buyer inspection period (days)"
              type="number"
              min={0}
              value={terms.inspectionDays}
              onChange={(e) => setTerms({ ...terms, inspectionDays: e.target.value })}
            />
          </div>
          <fieldset className="gg-cs-methods">
            <legend>Payout methods offered</legend>
            {Object.entries(PAYOUT_METHOD_LABELS).map(([k, v]) => (
              <label key={k} className="gg-cs-check">
                <input
                  type="checkbox"
                  checked={terms.methods.includes(k)}
                  onChange={(e) =>
                    setTerms({ ...terms, methods: e.target.checked ? [...terms.methods, k] : terms.methods.filter((m) => m !== k) })
                  }
                />
                {v}
              </label>
            ))}
          </fieldset>
          <div className="gg-btn-row">
            <Button variant="primary" loading={busy === "terms"} onClick={() => void saveTerms()}>
              Save estimator and terms
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
