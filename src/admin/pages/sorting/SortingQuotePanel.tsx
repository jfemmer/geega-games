import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { TextArea, TextField } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { sortingRepository } from "../../repositories/sorting.supabase";
import type { SortingQuoteAdmin, SortingRequestDetail } from "../../types";
import {
  SORTING_LIMITS,
  checkQuoteItems,
  formatRatePerThousand,
  parseCardCount,
  parseDollarsToCents,
  sortingEstimateCents,
  sortingQuoteLines,
  sortingQuoteTotalCents,
  type SortingQuoteItems,
} from "../../../store/lib/sortingService";

// The itemized quote for a sorting request: sorting service, return
// shipping, return packaging & supplies, other agreed charges, and the final
// total — always the sum of the items, never typed separately, so the total
// the customer approves can't disagree with its own lines.
//
// A quote is editable only as a draft. Once sent it's frozen (the database
// refuses changes), and once the customer approves it, it's the binding
// total: any change is a revised quote the customer has to approve, and the
// approved total stays in force until they do.

interface EditorState {
  countedCards: string;
  sorting: string;
  returnShipping: string;
  returnPackaging: string;
  others: { label: string; amount: string }[];
  note: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

const QUOTE_STATE_LABELS: Record<SortingQuoteAdmin["status"], string> = {
  draft: "Draft",
  sent: "Waiting for the customer",
  accepted: "Approved",
  declined: "Declined",
  superseded: "Replaced",
};

const QUOTE_STATE_TONE: Record<SortingQuoteAdmin["status"], "neutral" | "info" | "success" | "danger" | "gold"> = {
  draft: "neutral",
  sent: "gold",
  accepted: "success",
  declined: "danger",
  superseded: "neutral",
};

function fromQuote(q: SortingQuoteAdmin, note: string): EditorState {
  return {
    countedCards: q.countedCards != null ? String(q.countedCards) : "",
    sorting: dollars(q.sortingServiceCents),
    returnShipping: dollars(q.returnShippingCents),
    returnPackaging: dollars(q.returnPackagingCents),
    others: q.otherCharges.map((o) => ({ label: o.label, amount: dollars(o.amountCents) })),
    note,
  };
}

function initialEditor(detail: SortingRequestDetail): EditorState {
  const draft = detail.quotes.find((q) => q.status === "draft");
  if (draft) return fromQuote(draft, draft.noteToCustomer ?? "");
  // A revision starts from the newest quote the customer saw.
  const latest = detail.quotes.find((q) => q.status !== "draft");
  if (latest) return fromQuote(latest, "");
  const counted = detail.countedCards;
  return {
    countedCards: counted != null ? String(counted) : "",
    sorting: dollars(
      counted != null ? sortingEstimateCents(detail.ratePerThousandCents, counted) : detail.estimatedSortingCents,
    ),
    returnShipping: "",
    returnPackaging: "",
    others: [],
    note: "",
  };
}

type Parsed = { ok: true; items: SortingQuoteItems; countedCards: number | null } | { ok: false; message: string };

function parseEditor(e: EditorState): Parsed {
  const sorting = parseDollarsToCents(e.sorting);
  const shipping = parseDollarsToCents(e.returnShipping);
  const packaging = parseDollarsToCents(e.returnPackaging);
  if (sorting === null) return { ok: false, message: "Enter the sorting service cost in dollars, like 25.00." };
  if (shipping === null) return { ok: false, message: "Enter the return shipping charge in dollars, like 18.50." };
  if (packaging === null) return { ok: false, message: "Enter the return packaging cost in dollars, like 4.00." };
  const others: { label: string; amountCents: number }[] = [];
  for (const o of e.others) {
    if (!o.label.trim() && !o.amount.trim()) continue;
    const cents = parseDollarsToCents(o.amount);
    if (cents === null) return { ok: false, message: `Enter an amount for "${o.label.trim() || "other charge"}".` };
    others.push({ label: o.label, amountCents: cents });
  }
  let countedCards: number | null = null;
  if (e.countedCards.trim()) {
    countedCards = parseCardCount(e.countedCards);
    if (countedCards === null || countedCards > SORTING_LIMITS.maxCountedCards) {
      return { ok: false, message: "Counted cards must be a whole number." };
    }
  }
  const check = checkQuoteItems({
    sortingServiceCents: sorting,
    returnShippingCents: shipping,
    returnPackagingCents: packaging,
    otherCharges: others,
  });
  if (!check.ok) return check;
  return { ok: true, items: check.items, countedCards };
}

export function SortingQuotePanel({
  detail,
  onChanged,
}: {
  detail: SortingRequestDetail;
  onChanged: () => void;
}) {
  const toast = useToast();
  const draft = detail.quotes.find((q) => q.status === "draft") ?? null;
  const open = detail.quotes.find((q) => q.status === "sent") ?? null;
  const accepted = detail.acceptedQuoteId ? (detail.quotes.find((q) => q.id === detail.acceptedQuoteId) ?? null) : null;
  const history = detail.quotes.filter((q) => q.status !== "draft");
  const closed = detail.status === "returned" || detail.status === "cancelled";
  const shipped = detail.deliveryMethod === "ship";

  const [editing, setEditing] = useState(draft !== null);
  const [editor, setEditor] = useState<EditorState>(() => initialEditor(detail));
  const [busy, setBusy] = useState<null | "save" | "send" | "discard">(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseEditor(editor);
  const totalCents = parsed.ok ? sortingQuoteTotalCents(parsed.items) : null;
  const counted = parseCardCount(editor.countedCards);

  const set = (patch: Partial<EditorState>) => {
    setError(null);
    setEditor((prev) => ({ ...prev, ...patch }));
  };

  async function save(): Promise<string | null> {
    if (!parsed.ok) {
      setError(parsed.message);
      return null;
    }
    const { quoteId } = await sortingRepository.saveDraft(detail.id, {
      items: parsed.items,
      countedCards: parsed.countedCards,
      noteToCustomer: editor.note,
    });
    return quoteId;
  }

  async function run(kind: "save" | "send" | "discard", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the quote.");
    } finally {
      setBusy(null);
    }
  }

  const onSave = () =>
    run("save", async () => {
      if (await save()) {
        toast.success("Draft saved. The customer hasn't seen it yet.");
        onChanged();
      }
    });

  const onSend = () =>
    run("send", async () => {
      setConfirmSend(false);
      const quoteId = await save();
      if (!quoteId) return;
      const { emailed } = await sortingRepository.sendQuote(detail.id, quoteId);
      if (emailed) toast.success(`Quote sent to ${detail.email}.`);
      else toast.error("The quote is saved as sent, but the email didn't go out. Check the email log or contact the customer.");
      setEditing(false);
      onChanged();
    });

  const onDiscard = () =>
    run("discard", async () => {
      if (draft) await sortingRepository.discardDraft(detail.id, draft.id);
      setEditing(false);
      setEditor(initialEditor({ ...detail, quotes: detail.quotes.filter((q) => q.status !== "draft") }));
      if (draft) {
        toast.success("Draft removed.");
        onChanged();
      }
    });

  return (
    <section className="gg-leaddetail__section gg-sortq">
      <h3>Quote</h3>

      {accepted && (
        <div className="gg-inline-note gg-inline-note--success">
          <Icon name="checkCircle" size={16} />
          <div>
            Approved total <strong>{formatCents(accepted.totalCents)}</strong> (version {accepted.version}, approved{" "}
            {formatDateTime(accepted.acceptedAt)}). This is what the customer agreed to pay — it can only change if they
            approve a revised quote.
          </div>
        </div>
      )}
      {open && (
        <div className="gg-inline-note gg-inline-note--info">
          <Icon name="clock" size={16} />
          <div>
            Version {open.version} — <strong>{formatCents(open.totalCents)}</strong> — sent {formatDateTime(open.sentAt)}{" "}
            and waiting for the customer to approve it.
          </div>
        </div>
      )}

      {!editing ? (
        !closed && (
          <div className="gg-drawer-actions__buttons gg-sortq__start">
            <Button variant="primary" size="sm" icon="plus" onClick={() => setEditing(true)}>
              {history.length > 0 ? "Make a revised quote" : "Start the quote"}
            </Button>
          </div>
        )
      ) : (
        <div className="gg-sortq__editor">
          {(accepted || open) && (
            <div className="gg-inline-note gg-inline-note--warning">
              <Icon name="warning" size={16} />
              <div>
                {accepted
                  ? `Revised quote: it replaces the approved ${formatCents(accepted.totalCents)} only if the customer approves it. Until then, the approved total stays in force.`
                  : "Sending this replaces the quote waiting for the customer."}
              </div>
            </div>
          )}
          <div className="gg-form-grid">
            <TextField
              label="Counted cards"
              inputMode="numeric"
              value={editor.countedCards}
              onChange={(e) => set({ countedCards: e.target.value })}
              hint={`Estimated: ${detail.estimatedCards.toLocaleString("en-US")}`}
            />
            <div className="gg-sortq__rate">
              <span className="gg-card-meta">Rate: {formatRatePerThousand(detail.ratePerThousandCents)}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!counted}
                onClick={() => counted && set({ sorting: dollars(sortingEstimateCents(detail.ratePerThousandCents, counted)) })}
              >
                {counted
                  ? `Use rate: ${formatCents(sortingEstimateCents(detail.ratePerThousandCents, counted))}`
                  : "Enter a count to use the rate"}
              </Button>
            </div>
          </div>
          <div className="gg-form-grid">
            <TextField
              label="Sorting service cost ($)"
              inputMode="decimal"
              value={editor.sorting}
              onChange={(e) => set({ sorting: e.target.value })}
            />
            <TextField
              label="Return shipping charge ($)"
              inputMode="decimal"
              value={editor.returnShipping}
              onChange={(e) => set({ returnShipping: e.target.value })}
              hint={shipped ? "From the size, weight, packaging and destination." : "Drop-off: usually $0."}
            />
            <TextField
              label="Return packaging & supplies ($)"
              inputMode="decimal"
              value={editor.returnPackaging}
              onChange={(e) => set({ returnPackaging: e.target.value })}
              hint={shipped ? "Boxes, padding, top-loaders…" : "Drop-off: usually $0."}
            />
          </div>

          <div className="gg-sortq__others">
            <span className="gg-sortq__label">Other agreed charges</span>
            {editor.others.map((o, i) => (
              <div className="gg-sortq__other" key={i}>
                <TextField
                  label={`Description ${i + 1}`}
                  value={o.label}
                  maxLength={SORTING_LIMITS.maxOtherChargeLabel}
                  onChange={(e) =>
                    set({ others: editor.others.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                  }
                />
                <TextField
                  label="Amount ($)"
                  inputMode="decimal"
                  value={o.amount}
                  onChange={(e) =>
                    set({ others: editor.others.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  aria-label={`Remove charge ${i + 1}`}
                  onClick={() => set({ others: editor.others.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            {editor.others.length < SORTING_LIMITS.maxOtherCharges && (
              <Button
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={() => set({ others: [...editor.others, { label: "", amount: "" }] })}
              >
                Add a charge
              </Button>
            )}
          </div>

          <TextArea
            label="Note to the customer (optional)"
            rows={2}
            maxLength={SORTING_LIMITS.maxNoteToCustomer}
            value={editor.note}
            onChange={(e) => set({ note: e.target.value })}
            hint="Shown with the quote, e.g. what the count included."
          />

          <div className="gg-sortq__total" aria-live="polite">
            <span>Final quoted total</span>
            <strong>{totalCents !== null ? formatCents(totalCents) : "—"}</strong>
          </div>
          <p className="gg-card-meta">The total is always the sum of the items above.</p>
          {shipped && parsed.ok && parsed.items.returnShippingCents === 0 && (
            <p className="gg-sortq__warn">Return shipping is $0 for a collection we&rsquo;re shipping back — is that right?</p>
          )}
          {error && (
            <p className="gg-sortq__error" role="alert">
              {error}
            </p>
          )}

          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" size="sm" loading={busy === "discard"} disabled={busy !== null} onClick={onDiscard}>
              {draft ? "Discard draft" : "Cancel"}
            </Button>
            <Button variant="secondary" size="sm" loading={busy === "save"} disabled={busy !== null} onClick={onSave}>
              Save draft
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="mail"
              loading={busy === "send"}
              disabled={busy !== null || closed}
              onClick={() => (parsed.ok ? setConfirmSend(true) : setError(parsed.message))}
            >
              Send to customer
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="gg-sortq__history">
          <span className="gg-sortq__label">Quote history</span>
          <ul>
            {history.map((q) => (
              <li key={q.id}>
                <details>
                  <summary>
                    <span>
                      Version {q.version} · <strong>{formatCents(q.totalCents)}</strong>
                    </span>
                    <Badge tone={QUOTE_STATE_TONE[q.status]}>{QUOTE_STATE_LABELS[q.status]}</Badge>
                  </summary>
                  <dl className="gg-sortq__lines">
                    {sortingQuoteLines(q, detail.deliveryMethod).map((line) => (
                      <div key={line.key}>
                        <dt>{line.label}</dt>
                        <dd>{formatCents(line.amountCents)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="gg-card-meta">
                    Sent {formatDateTime(q.sentAt)}
                    {q.acceptedAt ? ` · approved ${formatDateTime(q.acceptedAt)}` : ""}
                    {q.declinedAt ? ` · declined ${formatDateTime(q.declinedAt)}` : ""}
                    {q.supersededAt ? ` · replaced ${formatDateTime(q.supersededAt)}` : ""}
                  </p>
                  {q.declineReason && <p className="gg-card-meta">Reason: &ldquo;{q.declineReason}&rdquo;</p>}
                  {q.noteToCustomer && <p className="gg-card-meta">Note to customer: &ldquo;{q.noteToCustomer}&rdquo;</p>}
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmSend}
        title="Send this quote?"
        message={`Email a quote of ${totalCents !== null ? formatCents(totalCents) : "—"} to ${detail.email}? Once it's sent it can't be changed — you'd send a revised quote instead.`}
        confirmLabel="Send quote"
        onConfirm={onSend}
        onCancel={() => setConfirmSend(false)}
      />
    </section>
  );
}
