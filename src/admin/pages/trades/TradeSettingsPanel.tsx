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
import { CARD_CONDITIONS, CONDITION_NAMES, formatDeadline, type TradeSettings } from "../../../store/lib/tradeCenter";
import { addQualifyingDays, addQualifyingHours } from "../../../store/lib/tradeDeadlines";
import {
  NUMBER_LABELS,
  formOf,
  readExcludedDates,
  settingsInputOf,
  shippingTiersPreview,
  type MoneyKey,
  type NumberKey,
  type SettingsForm,
} from "./tradeSettingsForm";

// Admin → Trades → Settings: every trade term in one form (the store owner
// saves; other staff can look). The rate, the minimums and the shipping
// tiers are what the Trade Cards page advertises. Turning trading on needs the address customers
// mail their cards to; nothing fills it in by itself ("Use the store's
// return address" copies the label return address into the form, to check
// and save). Pausing stops new trades only: trades already started carry on
// and their reserved cards stay reserved. Keeping deposits stays off until
// the owner turns it on, after checking the rules that apply.

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

/** "Approved now: confirm by …; confirmed now: ship by …", from the form as typed (null while a value is invalid). */
function deadlinePreview(form: SettingsForm): string | null {
  const hours = Number(form.numbers.confirmationHours);
  const days = Number(form.numbers.shipDaysNew);
  const excluded = readExcludedDates(form.excludedDates);
  if (!Number.isInteger(hours) || hours < 1 || !Number.isInteger(days) || days < 1 || "bad" in excluded) return null;
  const now = Date.now();
  const confirmBy = addQualifyingHours(now, hours, excluded.dates);
  const shipBy = addQualifyingDays(now, days, excluded.dates);
  const at = (ms: number) => formatDeadline(new Date(ms).toISOString());
  return `Approved right now, a trade must be confirmed by ${at(confirmBy)}. Confirmed right now, a new customer ships by ${at(shipBy)}.`;
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
  const termsChanged = form.depositTerms.replace(/\r\n/g, "\n").trim() !== saved.depositTerms;
  const preview = deadlinePreview(form);
  const tiers = shippingTiersPreview(form);

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
  const moneyField = (key: MoneyKey, label: string, hint?: string) => (
    <TextField
      key={key}
      label={`${label} ($)`}
      inputMode="decimal"
      value={form.money[key]}
      disabled={disabled}
      onChange={(e) => setMoney(key, e.target.value)}
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
                Stops new trades right away. Trades already started carry on, and their reserved cards stay reserved.
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
          {moneyField("minCardValueCents", "Minimum card value", "Per card, at its market price in the customer's condition. Cards under it can't be added.")}
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
              onChange={(e) => setForm((f) => ({ ...f, conditions: { ...f.conditions, [code]: e.target.value } }))}
            />
          ))}
        </div>
        <div className="gg-form-grid">
          {moneyField("processingFeeCents", "Processing fee per trade", "Taken off the trade credit. 0 for none.")}
          {numberField("overstockThreshold", "copies", "Stop taking a printing once you stock this many. 0 for no limit.")}
        </div>
        <label className="gg-check-inline">
          <input type="checkbox" checked={form.cashPayoutEnabled} disabled={disabled} onChange={(e) => set({ cashPayoutEnabled: e.target.checked })} />
          Let staff offer cash for credit left over (at the cash rate, paid by hand)
        </label>
        {form.cashPayoutEnabled && (
          <div className="gg-form-grid">{numberField("cashRatePercent", "%", "Cash per $1 of card value, instead of the credit rate.")}</div>
        )}
      </Group>

      <Group
        title="Minimum trade and shipping our cards"
        intro="Customers can add our cards below the minimum, but can't start or send a trade until they reach it. Shipping our cards is paid by card with the final payment, never out of trade credit, and never charged on a trade that doesn't finish. Each trade keeps the shipping rates it started with."
      >
        <div className="gg-form-grid">
          {moneyField("minTradeValueCents", "Minimum trade, our cards", "At their trade (regular) prices. Shipping doesn't count toward it.")}
          {moneyField("shipFeeCents", "Shipping under the free-shipping threshold")}
          {moneyField("freeShipThresholdCents", "Free shipping from, our cards", "At or above the minimum.")}
          {moneyField("freeShipFeeCents", "Shipping from the threshold up", "0 for free shipping.")}
          {moneyField(
            "shipCostEstimateCents",
            "What shipping our cards costs us",
            "An estimate for the trade economics report, used when a trade has no label or recorded postage. Customers never see it.",
          )}
        </div>
        {tiers && <p className="gg-card-meta">{tiers}</p>}
      </Group>

      <Group title="Limits" intro="Keeps trades a size you can handle.">
        <div className="gg-form-grid">
          {moneyField("maxTradeValueCents", "Largest trade, our cards", "Blank for no limit.")}
          {numberField("maxActiveTrades", "trades")}
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

      <Group
        title="Deadlines"
        intro="Nothing is reserved while customers build their trade or while you review it. Confirming reserves our cards. Confirmation and shipping deadlines skip Sundays (Saturdays count) and any days listed below, in St. Louis time."
      >
        <div className="gg-form-grid">
          {numberField("draftDays", "days", "A draft that isn't sent by then closes.")}
          {numberField("revisionHours", "hours", "After you ask for changes.")}
          {numberField("confirmationHours", "hours", "After you approve. 48 means Saturday 2 PM → Tuesday 2 PM.")}
          {numberField("shipDaysNew", "days", "After confirming. 3 means Friday 2 PM → Tuesday 2 PM.")}
          {numberField("scanGraceHours", "hours", "After the shipping deadline, before a trade with tracking but no scan expires. A late scan always goes to you.")}
          {numberField("paymentDueDays", "days")}
          {numberField("disputeWindowDays", "days", "Customers can send proof of shipping this long after a reservation expires.")}
        </div>
        <TextArea
          label="Days that don't count (besides Sundays)"
          rows={3}
          value={form.excludedDates}
          disabled={disabled}
          onChange={(e) => set({ excludedDates: e.target.value })}
          hint="Holidays or closures, as YYYY-MM-DD, one per line. Deadlines already set don't move."
        />
        {preview && <p className="gg-card-meta">{preview}</p>}
      </Group>

      <Group
        title="Refundable deposits"
        intro="A deposit is paid by card when the customer confirms, and is refunded in full (you absorb Stripe's fee) as soon as the carrier accepts their package in time. Declining the final offer never costs it."
      >
        <label className="gg-check-inline gg-trset__switch">
          <input type="checkbox" checked={form.depositsEnabled} disabled={disabled} onChange={(e) => set({ depositsEnabled: e.target.checked })} />
          <span>
            <strong>Ask for deposits</strong>
            <span className="gg-card-meta"> Off: no trade needs one, whatever its size or the customer&rsquo;s record.</span>
          </span>
        </label>
        <div className="gg-form-grid">
          {moneyField("depositThresholdCents", "Required from, our cards", "Smaller trades need one only when you ask, or after repeated abandoned reservations.")}
        </div>
        <p className="gg-trset__label">Deposit by the value of our cards on the trade</p>
        <div className="gg-trset__bands">
          {moneyField("depositBand1MaxCents", "Under")}
          {moneyField("depositBand1Cents", "Deposit")}
          {moneyField("depositBand2MaxCents", "Then under")}
          {moneyField("depositBand2Cents", "Deposit")}
          {moneyField("depositBand3MaxCents", "Then under")}
          {moneyField("depositBand3Cents", "Deposit")}
          <p className="gg-card-meta gg-trset__bandtop">And above</p>
          {moneyField("depositBand4Cents", "Deposit")}
        </div>
        <TextArea
          label="Deposit and cancellation terms"
          rows={8}
          maxLength={6000}
          value={form.depositTerms}
          disabled={disabled}
          onChange={(e) => set({ depositTerms: e.target.value })}
          hint={
            termsChanged
              ? `Saving makes this version ${saved.depositTermsVersion + 1}. Customers confirming from then on agree to the new text; trades already confirmed keep the version they agreed to.`
              : `Shown on the confirmation page; customers tick a box agreeing to it. Version ${saved.depositTermsVersion}.`
          }
        />
        <div className={form.allowForfeiture ? "gg-inline-note gg-inline-note--warning" : "gg-inline-note gg-inline-note--info"}>
          <Icon name={form.allowForfeiture ? "alert" : "info"} size={18} />
          <div>
            <label className="gg-check-inline gg-trset__switch">
              <input type="checkbox" checked={form.allowForfeiture} disabled={disabled} onChange={(e) => set({ allowForfeiture: e.target.checked })} />
              <span>
                <strong>Allow keeping a deposit</strong>
                <span className="gg-card-meta">
                  {" "}
                  Off: every deposit is refunded, even when a customer cancels or misses the deadline. On: the store owner can keep one after
                  reviewing the case; it&rsquo;s never kept automatically.
                </span>
              </span>
            </label>
            <p className="gg-card-meta gg-trset__forfeit">
              Before turning this on, check the consumer-protection rules that apply to you and Stripe&rsquo;s rules on keeping customer
              payments, and make sure the terms above say exactly when a deposit can be kept.
            </p>
          </div>
        </div>
      </Group>

      <Group
        title="Reliability"
        intro="Customers who complete trades get more time to ship. Customers who keep confirming and then not shipping lose that, and need a deposit on every trade or can't start one. Declining an offer, carrier delays after a timely scan and your cancellations never count."
      >
        <div className="gg-form-grid">
          {numberField("loyaltyTier1Trades", "trades")}
          {numberField("shipDaysTier1", "days")}
          {numberField("loyaltyTier2Trades", "trades")}
          {numberField("shipDaysTier2", "days")}
          {numberField("abandonLimit", "reservations", "Canceling after confirming, or not shipping in time. You can clear one on the trade.")}
          {numberField("abandonWindowDays", "days")}
        </div>
        <SelectField
          label="Over the limit"
          value={form.abandonPolicy}
          disabled={disabled}
          onChange={(e) => set({ abandonPolicy: e.target.value === "block" ? "block" : "deposit" })}
        >
          <option value="deposit">Require a deposit on every trade</option>
          <option value="block">No new trades</option>
        </SelectField>
      </Group>

      <Group title="Shipping" intro="Where customers mail their cards. Shown only once a customer's trade is confirmed and our cards are reserved.">
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
          hint="In the reservation email and on the customer's trade page."
        />
        <TextArea
          label="Return policy"
          rows={3}
          maxLength={4000}
          value={form.returnPolicy}
          disabled={disabled}
          onChange={(e) => set({ returnPolicy: e.target.value })}
          hint="What happens to their cards if a trade is declined or canceled after they ship."
        />
      </Group>

      <Group title="Reminders and alerts">
        <div className="gg-form-grid">
          {numberField("confirmReminderHours", "hours", "0 for no reminder.")}
          {numberField("shipReminderHours", "hours", "0 for no reminder.")}
          {numberField("maxTransitDays", "days")}
          {numberField("stallAlertDays", "days")}
        </div>
        <label className="gg-check-inline">
          <input type="checkbox" checked={form.notifyCustomer} disabled={disabled} onChange={(e) => set({ notifyCustomer: e.target.checked })} />
          Email customers at each step (approval, reservation, deposit refunds, final offer, reminders)
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
