import { useMemo, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { SelectField, TextField } from "../ui/Field";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatCents, formatDateTime } from "../../utils/format";
import {
  partnerReferralsRepository,
  partnersRepository,
  referralRewardsRepository,
  type LeadKind,
} from "../../repositories/partners.supabase";
import type { Partner, PartnerReferral, ReferralCodeOwner, ReferralReward } from "../../types";
import { describeLeadSource, type LeadSourceFields } from "../../../store/lib/attribution";
import {
  CHECKIN_ANSWERS,
  FEE_STATUSES,
  PARTNER_REFERRAL_OUTCOMES,
  SELLER_REFERRAL_REWARD_CENTS,
  formatPercent,
  partnerBuysAny,
  partnerCategoryLabel,
  type FeeStatus,
  type PartnerReferralOutcome,
} from "../../../store/lib/partnerTypes";
import { optionLabel } from "../../../store/lib/referralTypes";

// Panels shared by the Partner Leads and Buying Leads drawers:
//
//   LeadSourcePanel      where the seller came from (tagged link, referral
//                        code, first page, what they said);
//   PartnerReferralPanel send the lead to one partner store, and record what
//                        came of it (outcome, sale amount, finder's fee) —
//                        the API works out the fee;
//   ReferralRewardPanel  reward whoever referred the seller, once they sold.

function dollars(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function centsFrom(input: string): number | null {
  const trimmed = input.replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// ---------------------------------------------------------------------------
// Where the seller came from
// ---------------------------------------------------------------------------

export function LeadSourcePanel({ source }: { source: LeadSourceFields }) {
  const lines = describeLeadSource(source);
  return (
    <section className="gg-leaddetail__section">
      <h3>How they found us</h3>
      {lines.length === 0 ? (
        <p className="gg-card-meta">Nothing recorded — a direct visit, or from before we tracked this.</p>
      ) : (
        <ul className="gg-leadsource">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Send to a partner store
// ---------------------------------------------------------------------------

const FEE_STATUS_TONE: Record<FeeStatus, "neutral" | "gold" | "success" | "info"> = {
  none: "neutral",
  owed: "gold",
  paid: "success",
  waived: "info",
};

export function PartnerReferralPanel({
  kind,
  leadId,
  leadReference,
  leadCategories,
  blockedReason,
  onChanged,
}: {
  kind: LeadKind;
  leadId: string;
  leadReference: string;
  /** Partner categories the lead falls under (partnerTypes.leadPartnerCategories). */
  leadCategories: string[];
  /** Set when this lead can't be sent (e.g. the seller didn't agree). */
  blockedReason?: string | null;
  /** Something changed that the parent list shows (the lead's status). */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [partnerId, setPartnerId] = useState("");
  const [confirming, setConfirming] = useState(false);

  const loaded = useAsync(
    () => Promise.all([partnersRepository.list(), partnerReferralsRepository.forLead(kind, leadId)]),
    [kind, leadId],
  );
  const partners: Partner[] = useMemo(() => loaded.data?.[0] ?? [], [loaded.data]);
  const referrals: PartnerReferral[] | null = loaded.data?.[1] ?? null;
  const loadError = loaded.error ? "Couldn't load partner stores." : null;

  const partnerById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const matching = useMemo(
    () =>
      partners.filter(
        (p) => p.kind === "store" && p.status === "active" && partnerBuysAny(p.categories, leadCategories),
      ),
    [partners, leadCategories],
  );
  const open = referrals?.find((r) => r.outcome === "pending") ?? null;
  const chosen = partnerById.get(partnerId);

  async function send() {
    if (!chosen) return;
    try {
      const result = await partnerReferralsRepository.send(kind, leadId, chosen.id);
      const failed = [
        result.emails.store === "failed" ? "the store" : null,
        result.emails.seller === "failed" ? "the seller" : null,
      ].filter(Boolean);
      if (failed.length) {
        toast.error(`Sent and recorded, but the email to ${failed.join(" and ")} didn't go out. Forward it by hand.`);
      } else {
        toast.success(`Sent to ${chosen.businessName}. We emailed them and the seller.`);
      }
      setPartnerId("");
      loaded.reload();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the lead.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="gg-leaddetail__section gg-leaddetail__internal">
      <h3>Partner store</h3>
      {loadError && <p className="gg-alert gg-alert-error">{loadError}</p>}

      {referrals && referrals.length > 0 && (
        <ul className="gg-referral-history">
          {referrals.map((r) => (
            <ReferralRow
              // A new key when the saved outcome or sale changes resets the row's form to it.
              key={`${r.id}:${r.outcome}:${r.saleAmountCents ?? ""}`}
              referral={r}
              storeName={partnerById.get(r.partnerId)?.businessName ?? "Partner store"}
              onSaved={() => {
                loaded.reload();
                onChanged?.();
              }}
            />
          ))}
        </ul>
      )}

      {blockedReason ? (
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="info" size={16} />
          <div>{blockedReason}</div>
        </div>
      ) : open ? (
        <p className="gg-card-meta">
          With {partnerById.get(open.partnerId)?.businessName ?? "a partner store"} now. Record what
          happened to send it somewhere else.
        </p>
      ) : referrals === null ? (
        <p className="gg-card-meta">Loading…</p>
      ) : matching.length === 0 ? (
        <div className="gg-inline-note gg-inline-note--warning">
          <Icon name="info" size={16} />
          <div>
            No active partner store buys {leadCategories.map(partnerCategoryLabel).join(" or ")} yet.{" "}
            <a href={`${ADMIN_BASE}/partners`}>Add one on the Partners page</a>, then come back.
          </div>
        </div>
      ) : (
        <div className="gg-referral-send">
          <SelectField label="Send to" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">Choose a partner store…</option>
            {matching.map((p) => (
              <option key={p.id} value={p.id}>
                {p.businessName}
                {p.city ? ` — ${p.city}${p.state ? `, ${p.state}` : ""}` : ""}
                {p.buysByMail ? " · buys by mail" : ""} · {formatPercent(p.feePercent)}
              </option>
            ))}
          </SelectField>
          <Button variant="primary" size="sm" icon="mail" disabled={!chosen} onClick={() => setConfirming(true)}>
            Send to store
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Send ${leadReference} to ${chosen?.businessName ?? "this store"}?`}
        message={`We'll email ${chosen?.businessName ?? "the store"} the seller's details and photos, and email the seller the store's name. The finder's fee is ${chosen ? formatPercent(chosen.feePercent) : "the store's rate"} if they buy.`}
        confirmLabel="Send it"
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function ReferralRow({
  referral,
  storeName,
  onSaved,
}: {
  referral: PartnerReferral;
  storeName: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<PartnerReferralOutcome>(referral.outcome);
  const [amount, setAmount] = useState(dollars(referral.saleAmountCents));
  const [saving, setSaving] = useState(false);

  const dirty = outcome !== referral.outcome || (outcome === "sold" && centsFrom(amount) !== referral.saleAmountCents);

  async function save(patch: Parameters<typeof partnerReferralsRepository.update>[1], message: string) {
    setSaving(true);
    try {
      await partnerReferralsRepository.update(referral.id, patch);
      toast.success(message);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function saveOutcome() {
    if (outcome === "sold") {
      const cents = centsFrom(amount);
      if (cents === null) {
        toast.error("Enter what the store paid the seller.");
        return;
      }
      void save({ outcome, saleAmountCents: cents }, "Sale recorded.");
    } else {
      void save({ outcome }, "Saved.");
    }
  }

  const checkin = referral.checkinResponse
    ? optionLabel(CHECKIN_ANSWERS, referral.checkinResponse)
    : null;

  return (
    <li className="gg-referral-history__item">
      <div className="gg-referral-history__head">
        <strong>{storeName}</strong>
        <span className="gg-card-meta">Sent {formatDateTime(referral.sentAt)}</span>
      </div>

      {checkin && (
        <p className={`gg-referral-checkin${referral.checkinResponse === "not_contacted" ? " is-warning" : ""}`}>
          Seller said: “{checkin}”
          {referral.checkinAmountCents != null ? ` — about ${formatCents(referral.checkinAmountCents)}` : ""}
          <span className="gg-card-meta"> · {formatDateTime(referral.checkinRespondedAt)}</span>
        </p>
      )}
      {!checkin && referral.checkinSentAt && (
        <p className="gg-card-meta">Check-in email sent {formatDateTime(referral.checkinSentAt)} — no answer yet.</p>
      )}

      <div className="gg-form-grid">
        <SelectField
          label="What happened"
          value={outcome}
          disabled={saving}
          onChange={(e) => setOutcome(e.target.value as PartnerReferralOutcome)}
        >
          {PARTNER_REFERRAL_OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        {outcome === "sold" && (
          <TextField
            label="Store paid the seller ($)"
            inputMode="decimal"
            value={amount}
            disabled={saving}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}
      </div>
      {dirty && (
        <Button variant="primary" size="sm" loading={saving} onClick={saveOutcome}>
          Save
        </Button>
      )}

      {referral.outcome === "sold" && (
        <div className="gg-referral-fee">
          <span>
            Finder&rsquo;s fee: <strong>{formatCents(referral.feeCents ?? 0)}</strong> (
            {formatPercent(referral.feePercent)} of {formatCents(referral.saleAmountCents ?? 0)})
          </span>
          <Badge tone={FEE_STATUS_TONE[referral.feeStatus]}>{optionLabel(FEE_STATUSES, referral.feeStatus)}</Badge>
          {referral.feeStatus === "owed" && (
            <>
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => void save({ feeStatus: "paid" }, "Fee marked paid.")}>
                Mark paid
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save({ feeStatus: "waived" }, "Fee waived.")}>
                Waive
              </Button>
            </>
          )}
          {(referral.feeStatus === "paid" || referral.feeStatus === "waived") && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save({ feeStatus: "owed" }, "Fee set back to owed.")}>
              Undo
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Referral reward
// ---------------------------------------------------------------------------

export function ReferralRewardPanel({
  kind,
  leadId,
  refCode,
  soldToUs = false,
}: {
  kind: LeadKind;
  leadId: string;
  refCode: string | null;
  /** A Magic submission we bought (status Completed). A partner store sale is read from the lead's referrals. */
  soldToUs?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const loaded = useAsync(async (): Promise<{
    owner: ReferralCodeOwner | null;
    reward: ReferralReward | null;
    soldToStore: boolean;
  } | null> => {
    if (!refCode) return null;
    const [owner, reward, referrals] = await Promise.all([
      referralRewardsRepository.codeOwner(refCode),
      referralRewardsRepository.forLead(kind, leadId),
      partnerReferralsRepository.forLead(kind, leadId),
    ]);
    return { owner, reward, soldToStore: referrals.some((r) => r.outcome === "sold") };
  }, [kind, leadId, refCode]);

  if (!refCode) return null;

  /** undefined until the first load finishes; null when the code no longer exists. */
  const owner: ReferralCodeOwner | null | undefined = loaded.data ? loaded.data.owner : undefined;
  const reward = loaded.data?.reward ?? null;
  const sold = soldToUs || Boolean(loaded.data?.soldToStore);

  async function grant() {
    setBusy(true);
    try {
      const result = await referralRewardsRepository.grant(kind, leadId);
      toast.success(
        result.kind === "store_credit"
          ? `Added ${formatCents(result.amountCents)} store credit and emailed them.`
          : `Recorded a ${formatCents(result.amountCents)} referral fee owed, and emailed them.`,
      );
      loaded.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't give the reward.");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid() {
    if (!reward) return;
    setBusy(true);
    try {
      await referralRewardsRepository.markPaid(reward.id);
      toast.success("Marked paid.");
      loaded.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the reward.");
    } finally {
      setBusy(false);
    }
  }

  const isCustomer = owner?.userId != null;

  return (
    <section className="gg-leaddetail__section">
      <h3>Referred by</h3>
      <p>
        {loaded.error && !loaded.data
          ? `Code ${refCode} — couldn't load who it belongs to. Reopen this lead to try again.`
          : owner === undefined
            ? "Loading…"
            : owner
              ? <strong>{owner.label}</strong>
              : `Code ${refCode} (no longer exists)`}
        {owner?.email ? <span className="gg-card-meta"> · {owner.email}</span> : null}
      </p>
      {reward ? (
        <p>
          <Badge tone={reward.status === "paid" ? "success" : "gold"}>
            {reward.kind === "store_credit" ? "Store credit given" : reward.status === "paid" ? "Fee paid" : "Fee owed"}
          </Badge>{" "}
          {formatCents(reward.amountCents)} · {formatDateTime(reward.paidAt ?? reward.createdAt)}
          {reward.kind === "cash" && reward.status === "owed" && (
            <>
              {" "}
              <Button size="sm" variant="secondary" loading={busy} onClick={markPaid}>
                Mark paid
              </Button>
            </>
          )}
        </p>
      ) : owner ? (
        sold ? (
          <Button size="sm" variant="primary" icon="dollar" loading={busy} onClick={grant}>
            {isCustomer
              ? `Give ${formatCents(SELLER_REFERRAL_REWARD_CENTS)} store credit`
              : "Record their referral fee"}
          </Button>
        ) : (
          <p className="gg-card-meta">
            {isCustomer
              ? `They get ${formatCents(SELLER_REFERRAL_REWARD_CENTS)} in store credit once this seller sells.`
              : "They earn their referral fee once this seller sells."}
          </p>
        )
      ) : null}
    </section>
  );
}
