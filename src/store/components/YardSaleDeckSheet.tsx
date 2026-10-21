import { useState, type ChangeEvent } from "react";
import { CONDITION_LABELS } from "../lib/conditionLabels";
import { authLinkWithReturn } from "../lib/authRedirect";
import { formatCents } from "../lib/money";
import { useSheet } from "../lib/useSheet";
import { YARD_SALE_LIMITS, yardSalePriceCents } from "../lib/yardSale";
import {
  DECK_LIMITS,
  deckWants,
  findYardSaleDeckCards,
  type DeckFoundCard,
  type DeckFoundLine,
  type DeckResult,
} from "../lib/yardSaleDeck";
import PriceCell from "./YardSalePriceCell";

// "Shop your deck" on the yard sale page: paste (or upload) a decklist, see
// which of its cards are here at yard sale prices, and add them to the
// pickup list in one tap. The cards we don't have here are listed too, with
// an invitation to save the deck to a free account for restock alerts — the
// same deck feature the main site has.

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MAX_FILE_BYTES = 1_000_000;

type Phase = "paste" | "checking" | "results";

/** The cards to tick at first: in the deck's order, as many as the list can still take. */
function firstSelection(result: DeckResult, linesLeft: number): Set<string> {
  const selected = new Set<string>();
  let lines = 0;
  for (const card of result.found) {
    if (lines + card.lines.length > linesLeft) break;
    lines += card.lines.length;
    selected.add(card.name.toLowerCase());
  }
  return selected;
}

function cardTotals(card: DeckFoundCard, discountPercent: number): { websiteCents: number; saleCents: number } {
  let websiteCents = 0;
  let saleCents = 0;
  for (const line of card.lines) {
    const price = line.card.priceCents ?? 0;
    websiteCents += price * line.quantity;
    saleCents += yardSalePriceCents(price, discountPercent) * line.quantity;
  }
  return { websiteCents, saleCents };
}

export default function YardSaleDeckSheet({
  discountPercent,
  linesLeft,
  onAdd,
  onClose,
}: {
  discountPercent: number;
  /** Different cards the list can still take in this send. */
  linesLeft: number;
  onAdd: (lines: DeckFoundLine[]) => void;
  onClose: () => void;
}) {
  const headingRef = useSheet(onClose);
  const [phase, setPhase] = useState<Phase>("paste");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function check() {
    const wants = deckWants(text);
    if (wants.length === 0) {
      setError("We couldn’t find any cards in that list. Paste one card per line, like “1 Sol Ring”.");
      return;
    }
    setError(null);
    setPhase("checking");
    try {
      const found = await findYardSaleDeckCards(wants);
      setResult(found);
      setSelected(firstSelection(found, linesLeft));
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t check your deck. Please try again.");
      setPhase("paste");
    }
  }

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is too big for a decklist. Paste your list instead.");
      return;
    }
    try {
      setText((await file.text()).slice(0, DECK_LIMITS.maxTextLength));
      setError(null);
    } catch {
      setError("We couldn’t read that file. Paste your list instead.");
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chosen = (result?.found ?? []).filter((card) => selected.has(card.name.toLowerCase()));
  const chosenLines = chosen.flatMap((card) => card.lines);
  const chosenCopies = chosen.reduce((sum, card) => sum + card.found, 0);
  const chosenCents = chosen.reduce((sum, card) => sum + cardTotals(card, discountPercent).saleCents, 0);
  const tooMany = chosenLines.length > linesLeft;
  const missingCopies = (result?.missing ?? []).reduce((sum, want) => sum + want.quantity, 0);
  const anyShort = !!result && (result.missing.length > 0 || result.found.some((card) => card.found < card.wanted));

  return (
    <>
      <div className="gg-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div className="gg-drawer gg-yard-sheet gg-yard-deck" role="dialog" aria-modal="true" aria-labelledby="gg-yard-deck-title">
        <div className="gg-drawer-head">
          <h2 id="gg-yard-deck-title" ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: "1.15rem" }}>
            Shop your deck
          </h2>
          <button type="button" className="gg-iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {phase !== "results" || !result ? (
          <form
            className="gg-drawer-body gg-yard-sheet__body"
            onSubmit={(e) => {
              e.preventDefault();
              void check();
            }}
          >
            <p className="gg-yard-deck__intro">
              Paste your decklist and we&rsquo;ll find the cards we have here
              {discountPercent > 0
                ? `, with your yard sale exclusive ${discountPercent}% off.`
                : ", at yard sale prices."}
            </p>
            <p className="gg-card-meta gg-yard-fine">
              Lists from Moxfield, Archidekt, TCGplayer, ManaBox and MTGGoldfish all work: use your deck&rsquo;s
              Export or Copy as text. Or type one card per line, like &ldquo;4 Lightning Bolt&rdquo;.
            </p>
            <label htmlFor="gg-yard-deck-text" className="visually-hidden">
              Your decklist
            </label>
            <textarea
              id="gg-yard-deck-text"
              className="gg-yard-deck__text"
              rows={9}
              value={text}
              maxLength={DECK_LIMITS.maxTextLength}
              onChange={(e) => setText(e.target.value)}
              placeholder={"1 Sol Ring\n1 Arcane Signet\n4 Lightning Bolt"}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <label className="gg-yard-deck__file">
              <input
                type="file"
                className="visually-hidden"
                accept=".txt,.csv,text/plain,text/csv"
                onChange={(e) => void readFile(e)}
              />
              <span>Or upload a .txt or .csv file</span>
            </label>

            {error && (
              <div className="gg-alert gg-alert-error" role="alert">
                {error}
              </div>
            )}

            <div className="gg-kiosk-actions">
              <button type="button" className="gg-btn gg-btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="gg-btn" disabled={!text.trim() || phase === "checking"}>
                {phase === "checking" ? "Checking…" : "Find my cards"}
              </button>
            </div>
          </form>
        ) : (
          <div className="gg-drawer-body gg-yard-sheet__body">
            <p className="gg-yard-deck__summary" role="status">
              {result.foundCopies > 0 ? (
                <>
                  We have{" "}
                  <strong>
                    {result.foundCopies} of your {plural(result.wantedCopies, "card")}
                  </strong>{" "}
                  here.
                </>
              ) : (
                <>None of your {plural(result.wantedCopies, "card")} are at the yard sale right now.</>
              )}
            </p>

            {result.found.length > 0 && (
              <ul className="gg-yard-lines">
                {result.found.map((card, i) => {
                  const key = card.name.toLowerCase();
                  const first = card.lines[0].card;
                  const totals = cardTotals(card, discountPercent);
                  return (
                    <li className="gg-yard-line gg-yard-deckline" key={key}>
                      <input
                        type="checkbox"
                        id={`gg-yard-deck-${i}`}
                        checked={selected.has(key)}
                        onChange={() => toggle(key)}
                      />
                      <label htmlFor={`gg-yard-deck-${i}`} className="gg-yard-line__info">
                        <span className="gg-card-name">
                          {card.name}
                          {card.found > 1 ? ` × ${card.found}` : ""}
                        </span>
                        <span className="gg-card-meta">
                          {card.lines.length === 1
                            ? `${first.setName ?? first.set?.toUpperCase() ?? ""} · ${CONDITION_LABELS[first.condition] ?? first.condition}`
                            : `${card.lines.length} printings`}
                          {card.found < card.wanted ? ` · only ${card.found} of ${card.wanted} here` : ""}
                        </span>
                      </label>
                      <PriceCell priceCents={totals.websiteCents} salePriceCents={totals.saleCents} quantity={1} />
                    </li>
                  );
                })}
              </ul>
            )}

            {tooMany && (
              <p className="gg-yard-notice">
                {linesLeft > 0
                  ? `You can send up to ${YARD_SALE_LIMITS.linesPerSend} different cards at a time. Untick some to add these, then send your list and add the rest.`
                  : "Your list is full for now. Send it, then add the rest."}
              </p>
            )}

            {result.missing.length > 0 && (
              <details className="gg-yard-deck__missing">
                <summary>Not here ({plural(missingCopies, "card")})</summary>
                <ul>
                  {result.missing.map((want) => (
                    <li key={want.name.toLowerCase()}>
                      {want.quantity > 1 ? `${want.quantity} ` : ""}
                      {want.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {anyShort && (
              <div className="gg-yard-deck__cta">
                <strong>Want the rest?</strong>
                <p>
                  Save this deck to a free Geega account and we&rsquo;ll let you know when the missing cards come in.
                </p>
                <a
                  className="gg-btn gg-btn-ghost gg-btn-sm"
                  href={authLinkWithReturn("/signup", "/account/decks")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create a free account
                </a>
              </div>
            )}

            <div className="gg-kiosk-actions">
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                onClick={() => {
                  setPhase("paste");
                  setError(null);
                }}
              >
                Paste another list
              </button>
              {result.found.length > 0 && (
                <button
                  type="button"
                  className="gg-btn"
                  disabled={chosenCopies === 0 || tooMany}
                  onClick={() => onAdd(chosenLines)}
                >
                  Add {plural(chosenCopies, "card")} · {formatCents(chosenCents)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
