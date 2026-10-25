import { useRef, useState } from "react";
import { DISPUTE_FILE_TYPES, TRADE_LIMITS, formatDeadline, type CustomerTrade } from "../../lib/tradeCenter";

// "I shipped in time, but the carrier didn't scan it": the customer's note
// and up to five photos or PDFs (a post office receipt, a drop-off photo).
// Sending it pauses everything: the reservation won't expire and the
// deposit won't be touched until a person has looked at it.

export function TradeProofForm({
  trade,
  busy,
  onSend,
}: {
  trade: CustomerTrade;
  busy: boolean;
  onSend: (note: string, files: File[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const openDispute = trade.disputes.find((d) => d.status === "open");

  if (openDispute) {
    return (
      <p className="gg-tc-note">
        We have your proof of shipping (sent {new Date(openDispute.createdAt).toLocaleDateString()}) and a person is looking at it. Until
        then your reservation won&rsquo;t expire and your deposit won&rsquo;t be touched.
      </p>
    );
  }
  if (!trade.canSendProof) return null;

  function pick(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    const all = [...files, ...chosen].slice(0, TRADE_LIMITS.maxDisputeFiles);
    const bad = all.find((f) => !(DISPUTE_FILE_TYPES as readonly string[]).includes(f.type) || f.size > TRADE_LIMITS.maxDisputeFileBytes);
    if (bad) {
      setProblem(`${bad.name}: send a photo (JPEG, PNG, WebP, HEIC) or a PDF, up to 10 MB.`);
      return;
    }
    setProblem(null);
    setFiles(all);
    if (input.current) input.current.value = "";
  }

  if (!open) {
    return (
      <p className="gg-tc-line__meta">
        Shipped in time but the carrier hasn&rsquo;t scanned it?{" "}
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(true)}>
          Send proof of shipping
        </button>
        {trade.proofDueAt ? ` (by ${formatDeadline(trade.proofDueAt)})` : ""}
      </p>
    );
  }

  return (
    <form
      className="gg-tc-subform"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!note.trim()) {
          setProblem("Tell us when and where you shipped your cards.");
          return;
        }
        const ok = await onSend(note.trim(), files);
        if (ok) {
          setOpen(false);
          setNote("");
          setFiles([]);
        }
      }}
    >
      <h3>Proof of shipping</h3>
      <p className="gg-tc-line__meta">
        Tell us when and where you dropped off your package, and attach a receipt or photo if you have one. While we look, your
        reservation won&rsquo;t expire and your deposit won&rsquo;t be touched.
      </p>
      <label className="gg-field">
        <span>When and where did you ship it?</span>
        <textarea rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="gg-field">
        <span>Receipt or photos (optional, up to {TRADE_LIMITS.maxDisputeFiles})</span>
        <input
          ref={input}
          type="file"
          accept={DISPUTE_FILE_TYPES.join(",")}
          multiple
          onChange={(e) => pick(e.target.files)}
          disabled={files.length >= TRADE_LIMITS.maxDisputeFiles}
        />
      </label>
      {files.length > 0 && (
        <ul className="gg-tc-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name}{" "}
              <button type="button" className="gg-linkbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="gg-alert gg-alert-error" role="alert">
          {problem}
        </p>
      )}
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn" disabled={busy}>
          {busy ? "Sending…" : "Send proof of shipping"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
