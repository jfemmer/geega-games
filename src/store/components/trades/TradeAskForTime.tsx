import { useState } from "react";

// "Need more time?": a note to us, answered in the trade's messages. Asking
// doesn't move the deadline; only we can, and the trade page shows the new
// one when we do.

export function TradeAskForTime({
  what,
  busy,
  onAsk,
}: {
  what: "confirm" | "ship";
  busy: boolean;
  onAsk: (note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <p className="gg-tc-line__meta">
        Need more time {what === "confirm" ? "to decide" : "to ship"}?{" "}
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(true)}>
          Ask us
        </button>
      </p>
    );
  }

  return (
    <form
      className="gg-tc-subform"
      onSubmit={async (e) => {
        e.preventDefault();
        const text = note.trim();
        if (text && (await onAsk(text))) {
          setOpen(false);
          setNote("");
        }
      }}
    >
      <label className="gg-field">
        <span>How much more time do you need, and why?</span>
        <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="gg-tc-line__meta">We&rsquo;ll reply in your messages. Until we do, your current deadline stands.</p>
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn gg-btn-sm" disabled={busy || !note.trim()}>
          {busy ? "Sending…" : "Ask for more time"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
