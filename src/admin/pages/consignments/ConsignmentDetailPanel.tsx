import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { CHANNEL_LABELS, CONSIGNMENT_CHANNELS } from "../../../store/lib/consignmentMath";
import { ACKNOWLEDGMENTS } from "../../../store/lib/consignmentAgreement";
import { CONSIGNMENT_STATUS_LABELS, consignmentAdminApi, type ConsignmentDetail } from "./consignmentAdminApi";
import { ReceiveCardsPanel } from "./ReceiveCardsPanel";
import { ConsignmentLotsPanel } from "./ConsignmentLotsPanel";

// One consignment: its consignor, status, the agreement invitations sent
// (with send, resend and cancel), the signing record with the signed PDF,
// and the cards: receiving batches and inspection.

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function ConsignmentDetailPanel({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<ConsignmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await consignmentAdminApi.detail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the consignment.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <Spinner label="Loading consignment" />;

  const { consignment: c, consignor: p, agreements, signatures, elections, batches = [], lots = [], lotEvents = [] } = data;
  const canReceive = Boolean(c.signed_at) && ["signed", "inventory_received", "active"].includes(c.status);
  const open = agreements.find((a) => a.status === "pending");
  const canSend = c.status === "draft" || c.status === "awaiting_signature";

  return (
    <div className="gg-cs">
      <div className="gg-btn-row">
        <Button variant="ghost" icon="chevronLeft" onClick={onBack}>
          All consignments
        </Button>
      </div>

      <SectionCard
        title={`${c.label} · ${p.legal_name}`}
        action={<Badge tone={c.status === "awaiting_signature" ? "warning" : c.signed_at ? "success" : "neutral"}>{CONSIGNMENT_STATUS_LABELS[c.status]}</Badge>}
      >
        <dl className="gg-cn-facts">
          <div>
            <dt>Email</dt>
            <dd>
              {p.email} {p.user_id ? <Badge tone="info">Has an account</Badge> : <Badge tone="neutral">No account yet</Badge>}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{p.phone ?? "—"}</dd>
          </div>
          <div>
            <dt>Mailing address</dt>
            <dd>{[p.address_line1, p.address_line2, [p.city, p.state_code].filter(Boolean).join(", "), p.postal_code].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt>State of residence</dt>
            <dd>{p.state_code ?? "—"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              {when(c.created_at)}
              {c.created_by ? ` by ${c.created_by}` : ""}
            </dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{c.term_started_at ? `${c.initial_term_days} days from ${when(c.term_started_at)}` : `${c.initial_term_days} days, starts when accepted cards are posted`}</dd>
          </div>
          {c.admin_notes && (
            <div>
              <dt>Internal notes</dt>
              <dd className="gg-cn-pre">{c.admin_notes}</dd>
            </div>
          )}
        </dl>
      </SectionCard>

      <SectionCard
        title="Agreement"
        action={
          canSend ? (
            <Button
              variant="primary"
              icon="mail"
              loading={busy === "send"}
              onClick={() =>
                void run("send", async () => {
                  const r = await consignmentAdminApi.invite(c.id);
                  setLastLink(r.signUrl);
                  if (r.emailed) toast.success(`Agreement emailed to ${p.email}.`);
                  else toast.error("The invitation was created, but the email didn't go out. Copy the link below and send it yourself.");
                })
              }
            >
              {open ? "Send a new link" : "Send agreement"}
            </Button>
          ) : undefined
        }
      >
        {lastLink && (
          <div className="gg-cn-link">
            <p>
              Signing link (shown once; it works only for {p.email}):
            </p>
            <code>{lastLink}</code>
            <Button
              size="sm"
              icon="copy"
              onClick={() => {
                void navigator.clipboard?.writeText(lastLink).then(() => toast.success("Link copied."));
              }}
            >
              Copy link
            </Button>
          </div>
        )}
        {agreements.length === 0 ? (
          <p className="gg-muted">
            No agreement sent yet. Sending emails {p.email} a link to review and sign the published agreement, filled in with today's rates. Cards
            can't be listed until it's signed.
          </p>
        ) : (
          <table className="gg-cs-table">
            <thead>
              <tr>
                <th scope="col">Sent</th>
                <th scope="col">Status</th>
                <th scope="col">Details</th>
                <th scope="col">
                  <span className="gg-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td>
                    {when(a.invited_at)}
                    {a.invited_by ? <span className="gg-cs-note">by {a.invited_by}</span> : null}
                  </td>
                  <td>
                    <Badge tone={a.status === "signed" ? "success" : a.status === "pending" ? "warning" : "neutral"}>
                      {a.status === "pending" ? "Awaiting signature" : a.status === "signed" ? "Signed" : "Cancelled"}
                    </Badge>
                  </td>
                  <td>
                    {a.status === "pending" && <>Link expires {when(a.invite_expires_at)}. {a.last_emailed_at ? `Emailed ${when(a.last_emailed_at)}.` : "Not emailed."}</>}
                    {a.status === "signed" && <>Signed {when(a.signed_at)}</>}
                    {a.status === "void" && (
                      <>
                        {a.void_reason} ({when(a.voided_at)}
                        {a.voided_by ? `, ${a.voided_by}` : ""})
                      </>
                    )}
                    <span className="gg-cs-note">Agreement SHA-256 {a.rendered_sha256.slice(0, 16)}…</span>
                  </td>
                  <td>
                    {a.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `void-${a.id}`}
                        onClick={() => {
                          const reason = window.prompt("Why are you cancelling this invitation? (Kept in the record.)");
                          if (!reason?.trim()) return;
                          void run(`void-${a.id}`, async () => {
                            await consignmentAdminApi.voidAgreement(a.id, reason.trim());
                            toast.success("Invitation cancelled. Its link no longer works.");
                          });
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {signatures.map((s) => (
        <SectionCard
          key={s.id}
          title="Signing record"
          action={
            <div className="gg-btn-row">
              <Button
                size="sm"
                icon="download"
                loading={busy === `pdf-${s.id}`}
                onClick={() =>
                  void run(`pdf-${s.id}`, async () => {
                    const tab = window.open("", "_blank");
                    try {
                      const url = await consignmentAdminApi.pdfUrl(s.id);
                      if (tab) tab.location.href = url;
                      else window.location.href = url;
                    } catch (e) {
                      tab?.close();
                      throw e;
                    }
                  })
                }
              >
                Signed PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="mail"
                loading={busy === `resend-${s.id}`}
                onClick={() =>
                  void run(`resend-${s.id}`, async () => {
                    const r = await consignmentAdminApi.resendSignedCopy(s.id);
                    if (r.emailed) toast.success(`Signed copy emailed to ${s.signer_email}.`);
                    else toast.error("The email didn't go out. Try again later.");
                  })
                }
              >
                Email copy again
              </Button>
            </div>
          }
        >
          <dl className="gg-cn-facts">
            <div>
              <dt>Signed by</dt>
              <dd>
                {s.legal_name} (typed signature "{s.typed_signature}")
              </dd>
            </div>
            <div>
              <dt>Account email</dt>
              <dd>{s.signer_email}</dd>
            </div>
            <div>
              <dt>Signed at</dt>
              <dd>{when(s.signed_at)}</dd>
            </div>
            <div>
              <dt>IP and browser</dt>
              <dd>
                {s.ip ?? "—"} · <span className="gg-cs-note">{s.user_agent ?? "—"}</span>
              </dd>
            </div>
            <div>
              <dt>Sales channels</dt>
              <dd>{CONSIGNMENT_CHANNELS.map((ch) => `${CHANNEL_LABELS[ch]}: ${s.channels[ch] ? "Yes" : "No"}`).join(" · ")}</dd>
            </div>
            <div>
              <dt>Additional insurance</dt>
              <dd>{s.additional_insurance ? "Approved (Option A)" : "Declined (Option B)"}</dd>
            </div>
            <div>
              <dt>Acknowledgments</dt>
              <dd>All {ACKNOWLEDGMENTS.length} ticked</dd>
            </div>
            <div>
              <dt>Fingerprints</dt>
              <dd className="gg-cn-hash">
                Agreement {s.agreement_sha256}
                <br />
                Record {s.record_sha256}
                <br />
                PDF {s.pdf_sha256 ?? "not made yet"}
              </dd>
            </div>
            <div>
              <dt>Copy emailed</dt>
              <dd>{s.emailed_at ? when(s.emailed_at) : "Not yet"}</dd>
            </div>
          </dl>
          {elections && (
            <p className="gg-muted">
              In force now:{" "}
              {CONSIGNMENT_CHANNELS.map((ch) => `${CHANNEL_LABELS[ch]} ${elections.channels[ch] ? "approved" : "declined"}`).join(", ")}; additional
              insurance {elections.additionalInsurance ? "approved" : "declined"}.
            </p>
          )}
        </SectionCard>
      ))}
      <SectionCard
        title="Cards"
        action={
          canReceive && !receiving ? (
            <Button variant="primary" icon="package" onClick={() => setReceiving(true)}>
              Receive cards
            </Button>
          ) : undefined
        }
      >
        {receiving && (
          <ReceiveCardsPanel
            consignmentId={c.id}
            onCancel={() => setReceiving(false)}
            onReceived={() => {
              setReceiving(false);
              void load();
              onChanged();
            }}
          />
        )}
        {!receiving && lots.length === 0 && (
          <p className="gg-muted">
            {canReceive
              ? "No cards received yet. Use Receive cards when the consignor's cards arrive."
              : "Cards can be received once the consignor has signed the agreement."}
          </p>
        )}
        {lots.length > 0 && (
          <ConsignmentLotsPanel
            batches={batches}
            lots={lots}
            events={lotEvents}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        )}
        {lots.some((l) => l.status === "accepted") && (
          <p className="gg-cs-note">Accepted cards are ready to list. Listing them for sale comes with sales and payout tracking in the next update.</p>
        )}
      </SectionCard>
    </div>
  );
}
