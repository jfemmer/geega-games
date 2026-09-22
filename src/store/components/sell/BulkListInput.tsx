import { useRef, useState } from "react";
import { parseCardListText } from "../../lib/sellCardListParser";
import { searchSellPrintings } from "../../lib/sellApi";
import { newLocalId, type SellCardLine } from "../../lib/sellTypes";

// "Paste a card list" — for a seller with an organized list who doesn't want
// to search+add cards one at a time. Never requires a perfect format: parses
// what it confidently can (see sellCardListParser.ts) and always preserves
// the original line, even when a card can't be matched. After adding lines,
// automatically tries to resolve each one to an exact Scryfall printing (a
// SEPARATE async step from parsing, capped and gently paced so pasting a
// long list can't hammer the search endpoint or the UI). Lines beyond the
// auto-resolve cap, or ones Scryfall couldn't confidently match, are added
// as "needs review" — never silently dropped — and can be matched manually
// from the card list below.

const AUTO_RESOLVE_LIMIT = 60;
const RESOLVE_DELAY_MS = 150;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function BulkListInput({
  onAddCards,
  onUpdateCard,
}: {
  onAddCards: (lines: SellCardLine[]) => void;
  onUpdateCard: (localId: string, patch: Partial<SellCardLine>) => void;
}) {
  const [text, setText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function resolveOne(line: SellCardLine) {
    try {
      let query = `!"${line.cardName}"`;
      if (line.setCode) query += ` set:${line.setCode.toLowerCase()}`;
      let result = await searchSellPrintings(query);
      if (result.printings.length === 0 && line.setCode) {
        result = await searchSellPrintings(`!"${line.cardName}"`);
      }
      if (result.printings.length === 1) {
        const p = result.printings[0];
        onUpdateCard(line.localId, {
          scryfallId: p.scryfallId,
          cardName: p.cardName,
          setCode: p.setCode,
          setName: p.setName,
          collectorNumber: p.collectorNumber,
          imageUrl: p.imageUrl,
          scryfallPriceCents: p.scryfallPriceCents,
          finish: p.availableFinishes.includes(line.finish) ? line.finish : (p.availableFinishes[0] ?? "nonfoil"),
          matchStatus: "matched",
          releasedAt: p.releasedAt,
        });
      } else if (result.printings.length > 1) {
        onUpdateCard(line.localId, { matchStatus: "ambiguous" });
      } else {
        onUpdateCard(line.localId, { matchStatus: "unmatched" });
      }
    } catch {
      onUpdateCard(line.localId, { matchStatus: "unmatched" });
    }
  }

  // Parses + adds a block of text (from the paste box OR a freshly-read
  // file) and kicks off auto-resolve. Pulled out of handleAdd so a file
  // upload can go straight into the list without also requiring the
  // separate "Add to my list" click — a seller who uploads a CSV and then
  // moves on to the next step has every reason to think that file's
  // contents are already part of their submission.
  async function addFromText(rawText: string) {
    const parsed = parseCardListText(rawText);
    if (parsed.length === 0) return;
    const lines: SellCardLine[] = parsed.map((p) => ({
      localId: newLocalId(),
      scryfallId: null,
      cardName: p.cardName || p.rawInput.slice(0, 200),
      setCode: p.setCode,
      setName: null,
      collectorNumber: p.collectorNumber,
      imageUrl: null,
      condition: p.condition,
      finish: p.finish ?? "nonfoil",
      quantity: p.quantity,
      scryfallPriceCents: null,
      sellerNotes: "",
      matchStatus: "unmatched",
      rawInput: p.rawInput,
      releasedAt: null,
    }));
    onAddCards(lines);

    const toResolve = lines.filter((l) => l.cardName.trim().length > 0).slice(0, AUTO_RESOLVE_LIMIT);
    if (toResolve.length === 0) return;
    setProgress({ done: 0, total: toResolve.length });
    setResolving(true);
    for (const line of toResolve) {
      await resolveOne(line);
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      await sleep(RESOLVE_DELAY_MS);
    }
    setResolving(false);
  }

  async function handleAdd() {
    const raw = text;
    setText("");
    await addFromText(raw);
  }

  // Typed/pasted text is added the moment focus leaves the box — a seller
  // who types a list and clicks straight into "Continue" shouldn't lose it
  // for missing a button most people wouldn't know to look for. Safe to
  // call unconditionally: addFromText no-ops on empty/whitespace text, and
  // if this already ran via the "Add to my list" click, the box is empty
  // by the time blur fires, so there's no double-add.
  async function handleTextareaBlur() {
    await handleAdd();
  }

  async function handleFile(file: File) {
    try {
      const content = await file.text();
      await addFromText(content);
    } catch {
      /* the user can still paste manually if reading the file fails */
    }
  }

  return (
    <div className="gg-sellbulk">
      <label className="gg-field">
        <span>Paste a card list</span>
        <textarea
          rows={6}
          placeholder={"1 Rhystic Study\n2 Smothering Tithe\n4 Lightning Bolt"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleTextareaBlur}
        />
      </label>
      <p className="gg-card-meta">
        One card per line — added to your list automatically once you click away or upload a
        file. Quantity, set, condition, and finish are picked up when included — don&rsquo;t
        worry about a perfect format. A CSV exported from TCGplayer&rsquo;s collection tracker
        works too.
      </p>
      <div className="gg-sellbulk__actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="gg-btn gg-btn-ghost gg-btn-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload a .csv or .txt file
        </button>
        <button
          type="button"
          className="gg-btn"
          disabled={text.trim().length === 0}
          onClick={handleAdd}
        >
          Add to my list
        </button>
      </div>
      {resolving && (
        <p className="gg-card-meta" role="status" aria-live="polite">
          Matching cards… {progress.done} / {progress.total}
        </p>
      )}
    </div>
  );
}
