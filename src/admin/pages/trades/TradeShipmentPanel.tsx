import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository } from "../../repositories/tradeCenter.supabase";
import { carrierLabel, trackingUrlFor } from "../../../store/lib/tracking";
import { formatDeadline, type StaffTrade } from "../../../store/lib/tradeCenter";
import { scanStatusLabel } from "../../../store/lib/tradeTracking";
import { formatDateInput, shipByPreview } from "./tradeMath";
import type { TradePanelProps } from "./types";

// Their package, for staff: the tracking number and every carrier scan, and
// what staff can do while a reservation waits for its shipment: verify the
// carrier's acceptance by hand (no automatic tracking, a scan that came late
// or early, or proof of shipping), mark the package received, or release the
// reservation. Then, for a reservation that expired: a package that turned
// up anyway, and reinstating the reservation.

/** A datetime-local value ("2026-10-27T14:00") for an instant, in this browser's time zone. */
function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value back to an ISO instant, or null. */
function fromLocalInput(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const SOURCE_LABELS: Record<string, string> = {
  carrier: "carrier scan",
  staff: "verified by staff",
  received: "proved by arrival",
};

export function TradeShipmentPanel({ trade, busy, run }: TradePanelProps) {
  const s = trade.shipment;
  const status = trade.status;
  const waiting = status === "awaiting_shipment" || status === "tracking_submitted";
  const url = trackingUrlFor(s.carrier, s.tracking);
  // A first scan after the deadline is decided (verified on time or late) before the package can be received.
  const lateScan = waiting && s.acceptedAt !== null && trade.shipBy !== null && Date.parse(s.acceptedAt) > Date.parse(trade.shipBy);

  return (
    <section className="gg-trd__section gg-trd-step" aria-labelledby="gg-trd-ship-title">
      <h3 id="gg-trd-ship-title">Their package</h3>
      {s.tracking ? (
        <p>
          <strong>{carrierLabel(s.carrier)}</strong>{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {s.tracking}
            </a>
          ) : (
            s.tracking
          )}
          {s.trackingAddedAt ? <span className="gg-card-meta"> · added {formatDateTime(s.trackingAddedAt)}</span> : null}
        </p>
      ) : (
        <p className="gg-card-meta">{waiting ? "No tracking number yet." : "No tracking number was added."}</p>
      )}
      {s.tracking && <PackagingLine trade={trade} />}
      {s.tracking && (
        <p className="gg-card-meta">
          {s.autoTracked
            ? `Checked automatically${s.checkedAt ? `, last ${formatDateTime(s.checkedAt)}` : ""}. Carrier status: ${scanStatusLabel(s.carrierStatus)}.`
            : "Not checked automatically (no tracking service for this carrier, or it isn't set up). Check the carrier's site and verify the first scan here."}
        </p>
      )}
      {s.acceptedAt && (
        <p>
          <strong>Carrier accepted it</strong> {formatDateTime(s.acceptedAt)}
          <span className="gg-card-meta">
            {s.acceptanceSource ? ` · ${SOURCE_LABELS[s.acceptanceSource] ?? s.acceptanceSource}` : ""}
            {s.shippedOnTime === true ? " · on time" : s.shippedOnTime === false ? " · after the deadline" : ""}
          </span>
        </p>
      )}
      {s.deliveredAt && (
        <p>
          <strong>Delivered</strong> {formatDateTime(s.deliveredAt)}
        </p>
      )}
      {s.scans.length > 0 && (
        <details className="gg-trd-scans">
          <summary>Carrier history ({s.scans.length})</summary>
          <ol>
            {[...s.scans].reverse().map((scan, i) => (
              <li key={`${scan.at}-${i}`}>
                <span className="gg-card-meta">{scan.at ? formatDateTime(scan.at) : ""}</span>
                <span>
                  {scan.message ?? scanStatusLabel(scan.status)}
                  {scan.location ? <span className="gg-card-meta"> · {scan.location}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {waiting && <VerifyShipment trade={trade} busy={busy} run={run} />}

      <div className="gg-drawer-actions__buttons">
        <Button
          variant={status === "in_transit" ? "primary" : "secondary"}
          size="sm"
          icon="package"
          loading={busy === "received"}
          disabled={busy !== null || lateScan}
          onClick={() => void run("received", () => tradeCenterRepository.markReceived(trade.id), "Marked received.")}
        >
          Mark the package received
        </Button>
      </div>
      <p className="gg-card-meta">
        {lateScan
          ? "The first scan came after the deadline: verify the shipment (on time or late) first, then mark it received."
          : `Receiving it opens the inspection${waiting ? ", and counts as shipped on time (refunding a paid deposit)" : ""}. With automatic tracking, delivery does this by itself.`}
      </p>

      {waiting && <ReleaseReservation trade={trade} busy={busy} run={run} />}
    </section>
  );
}

/** The day they say they shipped, and when they confirmed the packaging (for this tracking number). */
export function PackagingLine({ trade }: { trade: StaffTrade }) {
  const s = trade.shipment;
  return (
    <p className="gg-card-meta">
      {s.shippedOn ? `Customer says they shipped ${formatDateInput(s.shippedOn)}` : "No ship date given"}
      {" · "}
      {s.packagingConfirmedAt ? `packaging confirmed ${formatDateTime(s.packagingConfirmedAt)}` : "packaging not confirmed"}
    </p>
  );
}

/** The carrier accepted it at…: on time refunds the deposit; late carries on with the deposit up for review (or refunded anyway). */
function VerifyShipment({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const shipBy = trade.shipBy ? Date.parse(trade.shipBy) : null;
  const [open, setOpen] = useState(trade.reviewFlag === "late_acceptance" || trade.reviewFlag === "tracking_check" || trade.reviewFlag === "early_scan");
  const [at, setAt] = useState(() => localInput(trade.shipment.acceptedAt ? Date.parse(trade.shipment.acceptedAt) : Date.now()));
  const atIso = fromLocalInput(at);
  const late = shipBy !== null && atIso !== null && Date.parse(atIso) > shipBy;
  const [onTime, setOnTime] = useState(!late);
  const [refund, setRefund] = useState(false);
  const [note, setNote] = useState("");
  const paid = trade.deposit.status === "paid";
  const amount = trade.deposit.paidCents ?? trade.deposit.cents;

  if (!open) {
    return (
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="secondary" icon="truck" onClick={() => setOpen(true)} disabled={busy !== null}>
          Verify the shipment by hand…
        </Button>
      </div>
    );
  }

  return (
    <div className="gg-trd-form gg-trd-verify">
      <p className="gg-trd__subhead">Verify the shipment</p>
      <div className="gg-form-grid">
        <TextField
          label="The carrier accepted it at"
          type="datetime-local"
          value={at}
          onChange={(e) => {
            setAt(e.target.value);
            const iso = fromLocalInput(e.target.value);
            setOnTime(!(shipBy !== null && iso !== null && Date.parse(iso) > shipBy));
          }}
          hint={trade.shipBy ? `Shipping deadline: ${formatDeadline(trade.shipBy)}. Your computer's time zone.` : undefined}
        />
      </div>
      <label className="gg-check-inline">
        <input type="checkbox" checked={onTime} onChange={(e) => setOnTime(e.target.checked)} />
        Count it as shipped on time{late ? " (it's after the deadline: only if you're excusing it)" : ""}
      </label>
      {!onTime && paid && (
        <label className="gg-check-inline">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          Refund the deposit anyway
        </label>
      )}
      <TextArea label="Note (staff only)" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="gg-card-meta">
        The trade moves on to in transit and the customer is emailed.
        {paid
          ? onTime || refund
            ? ` The ${formatCents(amount)} deposit is refunded now.`
            : ` Late: it counts against the customer and the ${formatCents(amount)} deposit goes to review (you decide later).`
          : !onTime
            ? " Late: it counts against the customer."
            : ""}
      </p>
      <div className="gg-drawer-actions__buttons">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy === "verify"}
          disabled={busy !== null || atIso === null}
          onClick={() =>
            void run(
              "verify",
              () => tradeCenterRepository.verifyShipment(trade.id, { acceptedAt: atIso as string, onTime, refund: onTime || refund, note: note.trim() }),
              "Shipment verified.",
            )
          }
        >
          Verify the shipment
        </Button>
      </div>
    </div>
  );
}

/** Release a reservation that wasn't shipped, without waiting for the deadline job. */
function ReleaseReservation({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [countAgainst, setCountAgainst] = useState(true);
  if (!open) {
    return (
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={busy !== null}>
          Release the reservation…
        </Button>
      </div>
    );
  }
  return (
    <div className="gg-trd-form gg-leaddetail__danger">
      <TextArea
        label="Why (the customer is emailed this)"
        rows={2}
        maxLength={2000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Our cards go back on sale now. A paid deposit goes to review; it's never kept automatically."
      />
      <label className="gg-check-inline">
        <input type="checkbox" checked={countAgainst} onChange={(e) => setCountAgainst(e.target.checked)} />
        Count it against the customer (they didn&rsquo;t ship)
      </label>
      <div className="gg-drawer-actions__buttons">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={busy === "release"}
          disabled={busy !== null || !reason.trim()}
          onClick={() => void run("release", () => tradeCenterRepository.expireNow(trade.id, { reason: reason.trim(), countAgainst }), "Reservation released.")}
        >
          Release our cards
        </Button>
      </div>
    </div>
  );
}

/** An expired reservation: a package that arrived anyway, and reinstating it. */
export function TradeExpiredPanel({ trade, settings, busy, run }: TradePanelProps) {
  const [mode, setMode] = useState<"awaiting_shipment" | "in_transit" | "received">(trade.receivedAt ? "received" : "awaiting_shipment");
  const [days, setDays] = useState(String(trade.privileges?.shipDays ?? settings.shipDaysNew));
  const [at, setAt] = useState(() => localInput(trade.shipment.acceptedAt ? Date.parse(trade.shipment.acceptedAt) : Date.now()));
  const [clearFault, setClearFault] = useState(true);
  const dayCount = Number(days);
  const daysOk = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 30;
  const atIso = fromLocalInput(at);

  return (
    <section className="gg-trd__section gg-trd-step" aria-labelledby="gg-trd-expired-title">
      <h3 id="gg-trd-expired-title">Expired reservation</h3>
      <p>
        {trade.expiredStage === "scan" ? "Tracking was added but the carrier never scanned it in time." : "No tracking number by the deadline."}{" "}
        {trade.closedAt ? <span className="gg-card-meta">Released {formatDateTime(trade.closedAt)}.</span> : null}
      </p>
      {trade.canSendProof && trade.proofDueAt && (
        <p className="gg-card-meta">The customer can send proof of shipping until {formatDeadline(trade.proofDueAt)}.</p>
      )}
      {trade.returnStatus === "none" && !trade.receivedAt && (
        <div className="gg-drawer-actions__buttons">
          <Button
            size="sm"
            variant="secondary"
            icon="package"
            loading={busy === "arrived"}
            disabled={busy !== null}
            onClick={() => void run("arrived", () => tradeCenterRepository.cardsArrived(trade.id), "Noted. Mail their cards back, or reinstate the trade.")}
          >
            Their package arrived anyway
          </Button>
        </div>
      )}

      <div className="gg-trd-form">
        <p className="gg-trd__subhead">Reinstate the reservation</p>
        <SelectField label="Reinstate as" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="awaiting_shipment">Waiting for their shipment (a new deadline)</option>
          <option value="in_transit">Shipped (the carrier accepted it)</option>
          <option value="received">Received (the package is here)</option>
        </SelectField>
        {mode === "awaiting_shipment" && (
          <TextField
            label="Days to ship from now"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            hint={daysOk ? `New deadline: ${formatDeadline(new Date(shipByPreview(dayCount, settings)).toISOString())}. Sundays don't count.` : "1 to 30 days."}
          />
        )}
        {mode === "in_transit" && (
          <TextField label="The carrier accepted it at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} hint="Your computer's time zone." />
        )}
        <label className="gg-check-inline">
          <input type="checkbox" checked={clearFault} onChange={(e) => setClearFault(e.target.checked)} />
          Don&rsquo;t count the expiry against the customer
        </label>
        <p className="gg-card-meta">
          Holds our cards again if they&rsquo;re still available (otherwise it says which aren&rsquo;t).
          {trade.deposit.status === "forfeiture_review" || trade.deposit.status === "paid"
            ? mode === "awaiting_shipment"
              ? " The deposit is held again until they ship."
              : " The deposit is refunded."
            : ""}
        </p>
        <div className="gg-drawer-actions__buttons">
          <Button
            size="sm"
            variant="primary"
            loading={busy === "reinstate"}
            disabled={busy !== null || (mode === "awaiting_shipment" && !daysOk) || (mode === "in_transit" && atIso === null)}
            onClick={() =>
              void run(
                "reinstate",
                () =>
                  tradeCenterRepository.reinstate(trade.id, {
                    mode,
                    ...(mode === "awaiting_shipment" ? { shipDays: dayCount } : {}),
                    ...(mode === "in_transit" ? { acceptedAt: atIso as string } : {}),
                    clearFault,
                  }),
                "Reservation reinstated.",
              )
            }
          >
            Reinstate
          </Button>
        </div>
      </div>
    </section>
  );
}
