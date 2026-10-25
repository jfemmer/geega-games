import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { formatDateTime } from "../../utils/format";
import { tradeCenterRepository, type TradeSettingsResult } from "../../repositories/tradeCenter.supabase";
import { SHIP_FROM } from "../../../store/lib/shipFrom";
import { US_REGIONS } from "../../../store/lib/usAddress";
import { CARD_CONDITIONS, CONDITION_NAMES, type TradeSettings } from "../../../store/lib/tradeCenter";
import { NUMBER_LABELS, formOf, settingsInputOf, type MoneyKey, type NumberKey, type SettingsForm } from "./tradeSettingsForm";

// Admin → Trades → Settings: every trade term in one form (the store owner
// saves; other staff can look). The rate and minimum are what the Trade
// Cards page advertises. Turning trading on needs the address customers
// mail their cards to; nothing fills it in by itself ("Use the store's
// return address" copies the label return address into the form, to check
// and save). Pausing stops new trades only: trades already started carry on
// and their held cards stay held.

export function TradeSettingsPanel({ onSaved }: { onSaved: (settings: TradeSettings) => void }) {
  const [loaded, setLoaded] = useState<TradeSettingsResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    tradeCenterRepository.settings().then(
      (result) => {
        if (active) setLoaded(result);
      },
      (err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : "Could not load the trade settings.");
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        onRetry={() => {
          setLoadError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (!loaded) {
    return (
      <div className="gg-sortdetail__loading">
        <Spinner label="Loading trade settings" />
      </div>
    );
  }
  return <SettingsEditor initial={loaded.settings} owner={loaded.owner} onSaved={onSaved} />;
}

function SettingsEditor({
  initial,
  owner,
  onSaved,
}: {
  initial: TradeSettings;
  owner: boolean;
  onSaved: (settings: TradeSettings) => void;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState<TradeSettings>(initial);
  const [form, setForm] = useState<SettingsForm>(() => formOf(initial));
  const [busy, setBusy] = useState<null | "save" | "pause" | "resume">(null);

  const disabled = !owner || busy !== null;
  const set = (patch: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...patch }));
  const setNumber = (key: NumberKey, value: string) => setForm((f) => ({ ...f, numbers: { ...f.numbers, [key]: value } }));
  const setMoney = (key: MoneyKey, value: string) => setForm((f) => ({ ...f, money: { ...f.money, [key]: value } }));
  const setAddress = (patch: Partial<SettingsForm["shipTo"]>) => setForm((f) => ({ ...f, shipTo: { ...f.shipTo, ...patch } }));
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(saved));

  async function save(next: SettingsForm, kind: "save" | "pause" | "resume", done: string) {
    const input = settingsInputOf(next);
    if ("problem" in input) {
      toast.error(input.problem);
      return;
    }
    setBusy(kind);
    try {
      const result = await tradeCenterRepository.saveSettings(input);
      setSaved(result.settings);
      setForm(formOf(result.settings));
      onSaved(result.settings);
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the settings.");
    } finally {
      setBusy(null);
    }
  }
  // Pausing and resuming save straight away, with the rest as it was saved.
  const quick = (paused: boolean) => {
    const base = formOf(saved);
    void save(
      { ...base, paused, pauseMessage: form.pauseMessage.trim() ? form.pauseMessage : base.pauseMessage },
      paused ? "pause" : "resume",
      paused ? "New trades are paused. Trades already started carry on." : "New trades are open again.",
    );
  };

  const numberField = (key: NumberKey, unit: string, hint?: string) => (
    <TextField
      key={key}
      label={`${NUMBER_LABELS[key]} (${unit})`}
      inputMode="numeric"
      value={form.numbers[key]}
      disabled={disabled}
      onChange={(e) => setNumber(key, e.target.value)}
      hint={hint}
    />
  );

  return (
    <form
      className="gg-trset"
      onSubmit={(e) => {
        e.preventDefault();
        void save(form, "save", "Trade settings saved.");
      }}
    >
      {!owner && (
        <div className="gg-inline-note gg-inline-note--info" role="note">
          <Icon name="info" size={18} />
          <div>Only the store owner can change trade settings.</div>
        </div>
      )}

      <Group title="Trading" intro="Turn online trades on or off, or pause new ones without touching trades in progress.">
        <div className="gg-trset__state">
          <label className="gg-check-inline gg-trset__switch">
            <input type="checkbox" checked={form.enabled} disabled={disabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span>
              <strong>Take online trades</strong>
              <span className="gg-card-meta"> Shows Trade Cards in the store menu and lets signed-in customers start trades.</span>
            </span>
          </label>
          <div className="gg-trset__pause">
            <p>
              <strong>{saved.paused ? "New trades are paused." : "Emergency pause"}</strong>{" "}
              <span className="gg-card-meta">
                Stops new trades right away. Trades already started carry on, and their held cards stay held.
              </span>
            </p>
            <TextArea
              label="Message customers see while paused"
              rows={2}
              maxLength={500}
              value={form.pauseMessage}
              disabled={disabled}
              onChange={(e) => set({ pauseMessage: e.target.value })}
            />
            {saved.paused ? (
              <Button type="button" variant="primary" size="sm" icon="check" loading={busy === "resume"} disabled={disabled} onClick={() => quick(false)}>
                Resume new trades
              </Button>
            ) : (
              <Button type="button" variant="danger" size="sm" icon="pause" loading={busy === "pause"} disabled={disabled} onClick={() => quick(true)}>
                Pause new trades now
              </Button>
            )}
          </div>
        </div>
      </Group>

      <Group title="Credit and card values" intro="What the Trade Cards page advertises, and how each card is valued.">
        <div className="gg-form-grid">
          {numberField("creditRatePercent", "%", "Store credit per $1 of card value. Advertised on the Trade Cards page.")}
          <TextField
            label="Minimum card value ($)"
            inputMode="decimal"
            value={form.money.minCardValueCents}
            disabled={disabled}
            onChange={(e) => setMoney("minCardValueCents", e.target.value)}
            hint="Per card, at its market price in the customer's condition. Cards under it can't be added."
          />
        </div>
        <p className="gg-trset__label">Condition percentages (of the market price)</p>
        <div className="gg-trset__conditions">
          {CARD_CONDITIONS.map((code) => (
            <TextField
              key={code}
              label={`${CONDITION_NAMES[code]} (%)`}
              inputMode="numeric"
              value={form.conditions[code]}
              disabled={disabled}
              onChange={(e) => setForm((f) => (f ? { ...f, conditions: { ...f.conditions, [code]: e.target.value } } : f))}
            />
          ))}
        </div>
        <div className="gg-form-grid">
          <TextField
            label="Processing fee per trade ($)"
            inputMode="decimal"
            value={form.money.processingFeeCents}
            disabled={disabled}
            onChange={(e) => setMoney("processingFeeCents", e.target.value)}
            hint="Taken off the trade credit. 0 for none."
          />
          {numberField("overstockThreshold", "copies", "Stop taking a printing once you stock this many. 0 for no limit.")}
        </div>
        <label className="gg-check-inline">
          <input
            type="checkbox"
            checked={form.cashPayoutEnabled}
            disabled={disabled}
            onChange={(e) => set({ cashPayoutEnabled: e.target.checked })}
          />
          Let staff offer cash for credit left over (at the cash rate, paid by hand)
        </label>
        {form.cashPayoutEnabled && (
          <div className="gg-form-grid">{numberField("cashRatePercent", "%", "Cash per $1 of card value, instead of the credit rate.")}</div>
        )}
      </Group>

      <Group title="Limits" intro="Keeps trades a size you can handle.">
        <div className="gg-form-grid">
          <TextField
            label="Smallest trade, our cards ($)"
            inputMode="decimal"
            value={form.money.minTradeValueCents}
            disabled={disabled}
            onChange={(e) => setMoney("minTradeValueCents", e.target.value)}
          />
          <TextField
            label="Largest trade, our cards ($)"
            inputMode="decimal"
            value={form.money.maxTradeValueCents}
            disabled={disabled}
            onChange={(e) => setMoney("maxTradeValueCents", e.target.value)}
            hint="Blank for no limit."
          />
          {numberField("maxActiveTrades", "trades")}
          {numberField("maxExpiredTrades30d", "in 30 days", "Customers who let this many trades expire can't start new ones for a while.")}
          {numberField("maxWantedLines", "different cards")}
          {numberField("maxOfferedLines", "different cards")}
        </div>
        <div className="gg-form-grid">
          <TextArea
            label="Sets you're not taking"
            rows={2}
            value={form.excludedSetCodes}
            disabled={disabled}
            onChange={(e) => set({ excludedSetCodes: e.target.value })}
            hint="Set codes, separated by commas: MH3, LCI"
          />
          <TextArea
            label="Cards you're not taking"
            rows={2}
            value={form.excludedCardNames}
            disabled={disabled}
            onChange={(e) => set({ excludedCardNames: e.target.value })}
            hint="One card name per line."
          />
        </div>
      </Group>

      <Group title="Deadlines" intro="Our cards are held for the customer while they work; holds that run out release the cards automatically.">
        <div className="gg-form-grid">
          {numberField("reservationHours", "hours")}
          {numberField("revisionHours", "hours")}
          {numberField("shipBusinessDays", "days", "After approval. Weekends don't count.")}
          {numberField("shipGraceHours", "hours", "Extra time to add tracking before the trade expires.")}
          {numberField("transitAlertDays", "days", "Staff are alerted about a package that's taking too long.")}
          {numberField("paymentDueDays", "days")}
        </div>
      </Group>

      <Group title="Shipping" intro="Where customers mail their cards. Shown only to customers whose trade you've approved.">
        <div className="gg-trset__addresshead">
          <p className="gg-trset__label">Address customers mail their cards to</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              setAddress({
                name: SHIP_FROM.name,
                line1: SHIP_FROM.street1,
                line2: SHIP_FROM.street2 ?? "",
                city: SHIP_FROM.city,
                state: SHIP_FROM.state,
                postalCode: SHIP_FROM.zip,
              })
            }
          >
            Use the store&rsquo;s return address
          </Button>
        </div>
        <div className="gg-form-grid">
          <TextField label="Name" value={form.shipTo.name} disabled={disabled} maxLength={120} onChange={(e) => setAddress({ name: e.target.value })} />
          <TextField label="Street" value={form.shipTo.line1} disabled={disabled} maxLength={200} onChange={(e) => setAddress({ line1: e.target.value })} />
          <TextField
            label="Apt, suite or PO box (optional)"
            value={form.shipTo.line2}
            disabled={disabled}
            maxLength={200}
            onChange={(e) => setAddress({ line2: e.target.value })}
          />
          <TextField label="City" value={form.shipTo.city} disabled={disabled} maxLength={100} onChange={(e) => setAddress({ city: e.target.value })} />
          <SelectField label="State" value={form.shipTo.state} disabled={disabled} onChange={(e) => setAddress({ state: e.target.value })}>
            <option value="">Choose a state…</option>
            {US_REGIONS.filter((r) => r.group !== "military").map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="ZIP code"
            inputMode="numeric"
            value={form.shipTo.postalCode}
            disabled={disabled}
            maxLength={10}
            onChange={(e) => setAddress({ postalCode: e.target.value })}
          />
        </div>
        <SelectField
          label="Shipping their cards to us"
          value={form.shippingPaidBy}
          disabled={disabled}
          onChange={(e) => set({ shippingPaidBy: e.target.value === "store" ? "store" : "customer" })}
        >
          <option value="customer">The customer pays (tracked service)</option>
          <option value="store">We arrange and pay for it</option>
        </SelectField>
        <TextArea
          label="Packing instructions"
          rows={3}
          maxLength={4000}
          value={form.packingInstructions}
          disabled={disabled}
          onChange={(e) => set({ packingInstructions: e.target.value })}
          hint="In the approval email and on the customer's trade page."
        />
        <TextArea
          label="Return policy"
          rows={3}
          maxLength={4000}
          value={form.returnPolicy}
          disabled={disabled}
          onChange={(e) => set({ returnPolicy: e.target.value })}
          hint="What happens to their cards if a trade is declined or rejected after they ship."
        />
      </Group>

      <Group title="Emails">
        <label className="gg-check-inline">
          <input type="checkbox" checked={form.notifyCustomer} disabled={disabled} onChange={(e) => set({ notifyCustomer: e.target.checked })} />
          Email customers at each step (approval, final offer, reminders)
        </label>
        <label className="gg-check-inline">
          <input type="checkbox" checked={form.notifyStaff} disabled={disabled} onChange={(e) => set({ notifyStaff: e.target.checked })} />
          Alert staff (email and phone) when a trade needs attention
        </label>
      </Group>

      <div className="gg-trset__save">
        <span className="gg-card-meta">{saved.updatedAt ? `Last saved ${formatDateTime(saved.updatedAt)}` : "Not saved yet"}</span>
        {dirty && owner && (
          <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => setForm(formOf(saved))}>
            Undo changes
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy === "save"} disabled={disabled || !dirty}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Group({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className="gg-trset__group">
      <legend>{title}</legend>
      {intro && <p className="gg-card-meta">{intro}</p>}
      {children}
    </fieldset>
  );
}
