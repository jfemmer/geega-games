import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { Link } from "../lib/router";
import { formatCents } from "../lib/money";

const db = supabase as any;

function cardCount(cards: DeckCard[]): number {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

type Deck = {
  id: string;
  name: string;
  format: string;
  commander_oracle_id: string | null;
  commander_name: string | null;
  budget_mode: "budget" | "balanced" | "unlimited";
  max_card_price_cents: number | null;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
};

type DeckCard = {
  id: string;
  oracle_id: string | null;
  scryfall_id: string | null;
  card_name: string;
  quantity: number;
  section: string;
  owned: boolean;
  exact_printing_only: boolean;
};

type InventoryMatch = {
  deck_card_id: string;
  oracle_id: string | null;
  card_name: string;
  requested_quantity: number;
  owned: boolean;
  inventory_item_id: string | null;
  set_code: string | null;
  set_name: string | null;
  condition: string | null;
  finish: string | null;
  available_quantity: number | null;
  price_cents: number | null;
  image_url: string | null;
};

type Recommendation = {
  oracle_id: string;
  card_name: string;
  category: string;
  reason: string;
  image_url: string | null;
  in_stock: boolean;
  inventory_item_id: string | null;
  store_price_cents: number | null;
  scryfall_price_cents: number | null;
  score: number;
};

type ParsedCard = {
  name: string;
  quantity: number;
  section: string;
};

type ResolvedCard = {
  input_name: string;
  card_name: string | null;
  oracle_id: string | null;
  scryfall_id: string | null;
  type_line: string | null;
  image_url: string | null;
  commander_legal: boolean | null;
};

const MTG_FORMATS = [
  { value: "commander", label: "Commander", maxCopies: 1, deckSize: "100 cards" },
  { value: "standard", label: "Standard", maxCopies: 4, deckSize: "60+ cards" },
  { value: "pioneer", label: "Pioneer", maxCopies: 4, deckSize: "60+ cards" },
  { value: "modern", label: "Modern", maxCopies: 4, deckSize: "60+ cards" },
  { value: "legacy", label: "Legacy", maxCopies: 4, deckSize: "60+ cards" },
  { value: "vintage", label: "Vintage", maxCopies: 4, deckSize: "60+ cards" },
  { value: "pauper", label: "Pauper", maxCopies: 4, deckSize: "60+ cards" },
  { value: "brawl", label: "Brawl", maxCopies: 1, deckSize: "100 cards" },
  { value: "historic", label: "Historic", maxCopies: 4, deckSize: "60+ cards" },
  { value: "timeless", label: "Timeless", maxCopies: 4, deckSize: "60+ cards" },
  { value: "freeform", label: "Freeform", maxCopies: 99, deckSize: "40+ cards" },
] as const;

function formatMaxCopies(format: string): number {
  return MTG_FORMATS.find((item) => item.value === format)?.maxCopies ?? 4;
}

function parseDecklist(text: string, maxCopies = 99): ParsedCard[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ParsedCard[] = [];
  let section = "mainboard";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const normalizedHeading = line.replace(/:$/, "").toLowerCase();
    if (["commander", "commanders"].includes(normalizedHeading)) {
      section = "commander";
      continue;
    }
    if (["mainboard", "main deck", "deck", "maindeck"].includes(normalizedHeading)) {
      section = "mainboard";
      continue;
    }
    if (["sideboard", "side board"].includes(normalizedHeading)) {
      section = "sideboard";
      continue;
    }
    if (["maybeboard", "maybe board", "considering"].includes(normalizedHeading)) {
      section = "maybeboard";
      continue;
    }

    const cleaned = line
      .replace(/^[-*•]\s*/, "")
      .replace(/\s+\[[^\]]+\]\s*$/, "")
      .replace(/\s+\([^)]*\)\s*$/, "");

    const m =
      cleaned.match(/^([0-9]{1,2})\s*[xX]?\s+(.+)$/) ||
      cleaned.match(/^(.+?)[,;\t]\s*([0-9]{1,2})$/);

    let quantity = 1;
    let name = cleaned;
    if (m) {
      if (/^[0-9]/.test(m[1])) {
        quantity = Number(m[1]);
        name = m[2];
      } else {
        name = m[1];
        quantity = Number(m[2]);
      }
    }

    name = name
      .replace(/\s+\*F\*$/i, "")
      .replace(/\s+foil$/i, "")
      .replace(/\s+\(foil\)$/i, "")
      .trim();

    if (!name) continue;
    out.push({ name, quantity: Math.max(1, Math.min(quantity || 1, maxCopies)), section });
  }

  const merged = new Map<string, ParsedCard>();
  for (const card of out) {
    const key = `${card.section}::${card.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) existing.quantity = Math.min(maxCopies, existing.quantity + card.quantity);
    else merged.set(key, { ...card });
  }
  return Array.from(merged.values());
}

function categoryOrder(category: string): number {
  return ["Ramp", "Mana Base", "Card Draw", "Interaction", "Board Wipe", "Protection", "Synergy"].indexOf(category);
}

export function MyDecksSection({ deckId }: { deckId?: string }) {
  return deckId ? <DeckDetail deckId={deckId} /> : <DeckList />;
}

function DeckList() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await db
      .from("customer_decks")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    const rows = (data ?? []) as Deck[];
    setDecks(rows);

    if (rows.length) {
      const { data: cards } = await db
        .from("customer_deck_cards")
        .select("deck_id")
        .eq("user_id", user.id)
        .in("deck_id", rows.map((d) => d.id));
      const next: Record<string, number> = {};
      for (const row of cards ?? []) next[row.deck_id] = (next[row.deck_id] ?? 0) + 1;
      setCounts(next);
    } else {
      setCounts({});
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p>Loading your decks…</p>;

  return (
    <div className="gg-decks">
      <div className="gg-decks-toolbar">
        <div>
          <h2>My Decks</h2>
          <p>Save a deck, watch missing cards, and get beginner-friendly upgrade ideas.</p>
        </div>
        <button className="gg-btn" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancel" : "+ Add deck"}
        </button>
      </div>

      {showNew && (
        <DeckImporter
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      )}

      {decks.length === 0 && !showNew ? (
        <div className="gg-dash-card gg-empty">
          <h3>No saved decks yet</h3>
          <p>Paste a Commander decklist or upload a text/CSV file to get started.</p>
          <button className="gg-btn" onClick={() => setShowNew(true)}>
            Add your first deck
          </button>
        </div>
      ) : (
        <div className="gg-deck-grid">
          {decks.map((deck) => (
            <Link key={deck.id} to={`/account/decks/${deck.id}`} className="gg-deck-tile">
              <div className="gg-deck-tile__head">
                <span className="gg-badge">{deck.format === "commander" ? "Commander" : deck.format}</span>
                <span className="gg-card-meta">{counts[deck.id] ?? 0} cards</span>
              </div>
              <h3>{deck.name}</h3>
              <p>{deck.commander_name || "Commander not identified yet"}</p>
              <div className="gg-deck-tile__foot">
                <span>{deck.notify_email ? "Email alerts on" : "In-app alerts"}</span>
                <span>View deck →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckImporter({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState("commander");
  const [budget, setBudget] = useState<Deck["budget_mode"]>("balanced");
  const [maxPrice, setMaxPrice] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ card_name: string; image_url: string | null; type_line: string | null }>>([]);
  const [activeLine, setActiveLine] = useState<{ start: number; end: number; prefix: string; quantity: string } | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [quantityPick, setQuantityPick] = useState<{ cardName: string; start: number; end: number } | null>(null);
  const [freeformQty, setFreeformQty] = useState(5);
  const suggestTimer = useRef<number | null>(null);
  const suggestRequest = useRef(0);
  const deckTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [suggestPosition, setSuggestPosition] = useState({ top: 0, left: 0 });

  function updateCardSuggestions(value: string, caret: number) {
    setText(value);
    const start = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
    const nextBreak = value.indexOf("\n", caret);
    const end = nextBreak === -1 ? value.length : nextBreak;
    const line = value.slice(start, end);
    // (.+) rather than (.{2,}): the minimum-length check happens below, on
    // just the name portion. Requiring 2+ chars inside this same capture
    // group let the optional quantity-prefix group lose the backtracking
    // race whenever only 1 char of the name had been typed so far (e.g.
    // "1 X"), so the whole line — digit and all — fell through to the name
    // capture instead of splitting into quantity="1", name="X".
    const match = line.match(/^\s*(?:(\d{1,2})\s*[xX]?\s+)?(.+)$/);
    const rawQuery = match?.[2]?.trim() ?? "";
    const query = rawQuery.length >= 2 ? rawQuery : "";

    if (suggestTimer.current) window.clearTimeout(suggestTimer.current);
    const requestId = ++suggestRequest.current;

    if (!query || ["commander", "mainboard", "main deck", "deck", "maindeck", "sideboard", "maybeboard", "considering"].includes(query.toLowerCase())) {
      setSuggestions([]);
      setActiveLine(null);
      setSuggestBusy(false);
      return;
    }

    setActiveLine({ start, end, prefix: line.slice(0, line.indexOf(query)), quantity: match?.[1] ?? "" });

    const textarea = deckTextareaRef.current;
    if (textarea) {
      const beforeCaret = value.slice(0, caret);
      const lineNumber = beforeCaret.split("\n").length - 1;
      const computed = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
      const paddingTop = Number.parseFloat(computed.paddingTop) || 10;
      const visibleLine = lineNumber - Math.floor(textarea.scrollTop / lineHeight);
      const top = Math.max(8, Math.min(textarea.clientHeight - 48, paddingTop + (visibleLine + 1) * lineHeight));
      setSuggestPosition({ top, left: 8 });
    }
    setSuggestBusy(query.length >= 2);

    suggestTimer.current = window.setTimeout(async () => {
      const { data, error } = await db.rpc("search_deck_card_names", { p_query: query, p_limit: 8 });
      if (requestId !== suggestRequest.current) return;
      if (error) console.error("search_deck_card_names failed:", error);
      setSuggestions(error ? [] : ((data ?? []) as Array<{ card_name: string; image_url: string | null; type_line: string | null }>));
      setSuggestBusy(false);
    }, 100);
  }

  function insertChosenCard(cardName: string, quantity: number) {
    if (!activeLine) return;
    const textarea = deckTextareaRef.current;
    const safeQuantity = Math.max(1, Math.min(quantity, formatMaxCopies(format)));
    const replacement = `${safeQuantity} ${cardName}\n`;
    const nextText = text.slice(0, activeLine.start) + replacement + text.slice(activeLine.end);
    const nextCaret = activeLine.start + replacement.length;

    setText(nextText);
    setSuggestions([]);
    setActiveLine(null);
    setQuantityPick(null);
    setSuggestBusy(false);
    suggestRequest.current += 1;

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function chooseSuggestion(cardName: string) {
    if (!activeLine) return;
    const maxCopies = formatMaxCopies(format);
    if (maxCopies > 1 && !activeLine.quantity) {
      setSuggestions([]);
      setSuggestBusy(false);
      setFreeformQty(5);
      setQuantityPick({ cardName, start: activeLine.start, end: activeLine.end });
      return;
    }
    insertChosenCard(cardName, Number(activeLine.quantity) || 1);
  }

  function chooseQuantity(quantity: number) {
    if (!quantityPick || !activeLine) return;
    insertChosenCard(quantityPick.cardName, quantity);
  }

  async function importFile(file: File | null) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setStatus("Please use a deck file smaller than 512 KB.");
      return;
    }
    setText(await file.text());
    if (!name) setName(file.name.replace(/\.(txt|csv)$/i, ""));
  }

  async function create() {
    if (!user) return;
    const parsed = parseDecklist(text, formatMaxCopies(format));
    if (!name.trim()) {
      setStatus("Give the deck a name.");
      return;
    }
    if (!parsed.length) {
      setStatus("Paste or upload at least one card.");
      return;
    }

    setBusy(true);
    setStatus("Matching card names…");
    try {
      const uniqueNames = Array.from(new Set(parsed.map((c) => c.name)));
      const { data: resolvedData, error: resolveError } = await db.rpc("resolve_deck_card_names", {
        p_names: uniqueNames,
      });
      if (resolveError) throw resolveError;

      const resolved = (resolvedData ?? []) as ResolvedCard[];
      const byInput = new Map(resolved.map((r) => [r.input_name.toLowerCase(), r]));

      const commanderParsed =
        parsed.find((c) => c.section === "commander") ??
        parsed.find((c) => {
          const r = byInput.get(c.name.toLowerCase());
          return /legendary creature/i.test(r?.type_line ?? "");
        });
      const commanderResolved = commanderParsed
        ? byInput.get(commanderParsed.name.toLowerCase())
        : undefined;

      const { data: deck, error: deckError } = await db
        .from("customer_decks")
        .insert({
          user_id: user.id,
          name: name.trim(),
          format,
          commander_oracle_id: commanderResolved?.oracle_id ?? null,
          commander_name: commanderResolved?.card_name ?? commanderParsed?.name ?? null,
          budget_mode: budget,
          max_card_price_cents: maxPrice ? Math.round(Number(maxPrice) * 100) : null,
          notify_in_app: true,
          notify_email: notifyEmail,
        })
        .select("*")
        .single();
      if (deckError) throw deckError;

      const cards = parsed.map((card) => {
        const r = byInput.get(card.name.toLowerCase());
        return {
          deck_id: deck.id,
          user_id: user.id,
          oracle_id: r?.oracle_id ?? null,
          scryfall_id: r?.scryfall_id ?? null,
          card_name: r?.card_name ?? card.name,
          quantity: card.quantity,
          section: card.section,
          owned: false,
          exact_printing_only: false,
        };
      });

      const { error: cardsError } = await db.from("customer_deck_cards").insert(cards);
      if (cardsError) {
        await db.from("customer_decks").delete().eq("id", deck.id);
        throw cardsError;
      }

      const unmatched = cards.filter((c) => !c.oracle_id).length;
      setStatus(unmatched ? `Saved. ${unmatched} card name(s) need review.` : "Deck saved.");
      window.setTimeout(onCreated, 500);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save this deck.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gg-dash-card gg-deck-importer">
      <h3>Add a Magic deck</h3>
      {status && <div className="gg-alert gg-alert-warn">{status}</div>}

      <div className="gg-form-grid">
        <div className="gg-field">
          <label>Deck name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Muldrotha Reanimator" />
        </div>
        <div className="gg-field">
          <label>MTG format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {MTG_FORMATS.map((item) => (
              <option key={item.value} value={item.value}>{item.label} · {item.deckSize}</option>
            ))}
          </select>
          <span className="gg-card-meta">
            {formatMaxCopies(format) === 1
              ? "Singleton format: normally 1 copy of each card."
              : format === "freeform"
                ? "Freeform supports up to 99 copies per card entry."
                : `Up to ${formatMaxCopies(format)} copies of each card.`}
          </span>
        </div>
        <div className="gg-field">
          <label>Recommendation budget</label>
          <select value={budget} onChange={(e) => setBudget(e.target.value as Deck["budget_mode"])}>
            <option value="budget">Budget (usually under $5/card)</option>
            <option value="balanced">Balanced (usually under $20/card)</option>
            <option value="unlimited">No price limit</option>
          </select>
        </div>
        <div className="gg-field">
          <label>Optional max price per card</label>
          <input type="number" min="0" step="0.01" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="10.00" />
        </div>
        <div className="gg-field">
          <label>Deck file (.txt or .csv)</label>
          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => void importFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>

      <div className="gg-field">
        <label>Paste decklist</label>
        <div className="gg-deck-textarea-wrap">
        <textarea
          ref={deckTextareaRef}
          rows={13}
          value={text}
          onChange={(e) => void updateCardSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={(e) => {
            const target = e.currentTarget;
            void updateCardSuggestions(target.value, target.selectionStart ?? target.value.length);
          }}
          placeholder={"Commander\n1 Muldrotha, the Gravetide\n\nMainboard\n1 Sol Ring\n1 Counterspell\n1 Sakura-Tribe Elder"}
        />
        {activeLine && !quantityPick && (
          <div className="gg-deck-autocomplete gg-deck-autocomplete--floating" style={{ top: suggestPosition.top, left: suggestPosition.left }} role="listbox" aria-label="Matching Magic cards">
            {suggestBusy && suggestions.length === 0 ? (
              <div className="gg-deck-autocomplete__loading">Finding cards…</div>
            ) : suggestions.length === 0 ? (
              <div className="gg-deck-autocomplete__loading">No matching cards found.</div>
            ) : suggestions.map((card) => (
              <div
                key={card.card_name}
                className="gg-deck-autocomplete__option"
                role="option"
                tabIndex={-1}
                onPointerDown={(event) => {
                  event.preventDefault();
                  chooseSuggestion(card.card_name);
                }}
                onTouchStart={(event) => event.preventDefault()}
              >
                <span>
                  <strong>{card.card_name}</strong>
                  {card.type_line && <small>{card.type_line}</small>}
                </span>
              </div>
            ))}
          </div>
        )}
        {quantityPick && (
          <div
            className="gg-deck-autocomplete gg-deck-autocomplete--floating"
            style={{ top: suggestPosition.top, left: suggestPosition.left }}
            role="group"
            aria-label={`Choose quantity for ${quantityPick.cardName}`}
          >
            <div className="gg-deck-autocomplete__loading">{quantityPick.cardName} · choose quantity</div>
            <div className="gg-deck-quantity-picker">
              {Array.from({ length: Math.min(formatMaxCopies(format), 4) }, (_, index) => index + 1).map((quantity) => (
                <button
                  key={quantity}
                  type="button"
                  className="gg-btn gg-btn-sm"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    chooseQuantity(quantity);
                  }}
                >
                  {quantity}×
                </button>
              ))}
            </div>
            {formatMaxCopies(format) > 4 && (
              <div className="gg-deck-quantity-custom">
                <button
                  type="button"
                  className="gg-btn gg-btn-sm gg-deck-quantity-custom__step"
                  aria-label="Decrease quantity"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setFreeformQty((q) => Math.max(5, q - 1));
                  }}
                >
                  −
                </button>
                <span className="gg-deck-quantity-custom__value">{freeformQty}×</span>
                <button
                  type="button"
                  className="gg-btn gg-btn-sm gg-deck-quantity-custom__step"
                  aria-label="Increase quantity"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setFreeformQty((q) => Math.min(formatMaxCopies(format), q + 1));
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  className="gg-btn gg-btn-sm gg-deck-quantity-custom__add"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    chooseQuantity(freeformQty);
                  }}
                >
                  Add {freeformQty}×
                </button>
              </div>
            )}
          </div>
        )}
        </div>
        <span className="gg-card-meta">Supports common Moxfield/Archidekt-style plain-text exports, section headings, and simple CSV lines.</span>
      </div>

      <label className="gg-check">
        <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
        Email me when a missing card from this deck becomes available
      </label>

      <button className="gg-btn" disabled={busy} onClick={create}>
        {busy ? "Importing…" : "Save deck"}
      </button>
    </div>
  );
}

function DeckDetail({ deckId }: { deckId: string }) {
  const { user } = useAuth();
  const { addItem } = useCart();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<DeckCard[]>([]);
  const [matches, setMatches] = useState<InventoryMatch[]>([]);
  const [cardImages, setCardImages] = useState<Record<string, string>>({});
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [enlargedCard, setEnlargedCard] = useState<{ name: string; imageUrl: string } | null>(null);
  const [tab, setTab] = useState<"deck" | "missing" | "suggestions" | "combos">("deck");
  const [loading, setLoading] = useState(true);
  const [addingAll, setAddingAll] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setLoading(true);
    const [{ data: deckRow }, { data: cardRows }, { data: matchRows }, { data: recRows }] = await Promise.all([
      db.from("customer_decks").select("*").eq("id", deckId).eq("user_id", user.id).maybeSingle(),
      db.from("customer_deck_cards").select("*").eq("deck_id", deckId).eq("user_id", user.id).order("section").order("card_name"),
      db.rpc("deck_inventory_matches", { p_deck_id: deckId }),
      db.rpc("deck_recommendations", { p_deck_id: deckId, p_limit: 30 }),
    ]);
    setDeck((deckRow as Deck | null) ?? null);
    setCards((cardRows ?? []) as DeckCard[]);
    const nextMatches = (matchRows ?? []) as InventoryMatch[];
    setMatches(nextMatches);

    const nextImages: Record<string, string> = {};
    for (const match of nextMatches) {
      if (match.image_url) nextImages[match.deck_card_id] = match.image_url;
    }

    const missingImageCards = ((cardRows ?? []) as DeckCard[]).filter(
      (card) => !nextImages[card.id] && card.oracle_id,
    );
    if (missingImageCards.length) {
      const { data: imageRows } = await db.rpc("deck_card_images", { p_deck_id: deckId });
      for (const row of imageRows ?? []) {
        if (row.image_url) nextImages[row.deck_card_id] = row.image_url;
      }
    }
    setCardImages(nextImages);
    setRecommendations((recRows ?? []) as Recommendation[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [user, deckId]);

  const matchByCard = useMemo(() => new Map(matches.map((m) => [m.deck_card_id, m])), [matches]);
  const missing = cards.filter((c) => !c.owned && !matchByCard.get(c.id)?.inventory_item_id);
  const available = cards.filter((c) => !c.owned && !!matchByCard.get(c.id)?.inventory_item_id);
  const ownedCount = cards.filter((c) => c.owned).length;

  async function toggleOwned(card: DeckCard) {
    await db.from("customer_deck_cards").update({ owned: !card.owned, updated_at: new Date().toISOString() }).eq("id", card.id);
    setCards((rows) => rows.map((r) => (r.id === card.id ? { ...r, owned: !r.owned } : r)));
  }

  async function updateCardQuantity(card: DeckCard, nextQuantity: number) {
    if (!deck) return;
    const maxCopies = formatMaxCopies(deck.format);
    const quantity = Math.max(1, Math.min(Number(nextQuantity) || 1, maxCopies));
    if (quantity === card.quantity) return;
    const { error } = await db
      .from("customer_deck_cards")
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq("id", card.id)
      .eq("deck_id", deckId);
    if (error) {
      setStatus("Could not update that card quantity.");
      return;
    }
    setCards((rows) => rows.map((row) => (row.id === card.id ? { ...row, quantity } : row)));
  }

  async function addAvailableToCart() {
    setAddingAll(true);
    setStatus(null);
    let added = 0;
    try {
      for (const card of available) {
        const match = matchByCard.get(card.id);
        if (!match?.inventory_item_id) continue;
        await addItem(match.inventory_item_id, Math.min(card.quantity, match.available_quantity ?? 1));
        added += 1;
      }
      setStatus(`Added ${added} available deck card${added === 1 ? "" : "s"} to your cart.`);
    } finally {
      setAddingAll(false);
    }
  }

  async function removeDeck() {
    if (!window.confirm("Delete this saved deck and its card watches?")) return;
    await db.from("customer_decks").delete().eq("id", deckId);
    window.location.href = "/account/decks";
  }

  if (loading) return <p>Loading deck…</p>;
  if (!deck) return <div className="gg-alert gg-alert-error">Deck not found.</div>;

  return (
    <div className="gg-deck-detail">
      <div className="gg-deck-detail__hero">
        <div>
          <Link to="/account/decks" className="gg-card-meta">← My Decks</Link>
          <h2>{deck.name}</h2>
          <p>{deck.commander_name ? `Commander: ${deck.commander_name}` : "Commander not identified"}</p>
        </div>
        <div className="gg-deck-detail__actions">
          <button className="gg-btn" disabled={!available.length || addingAll} onClick={addAvailableToCart}>
            {addingAll ? "Adding…" : `Add available (${available.length})`}
          </button>
          <button className="gg-btn gg-btn-ghost" onClick={removeDeck}>Delete deck</button>
        </div>
      </div>

      {status && <div className="gg-alert gg-alert-ok">{status}</div>}

      <div className="gg-deck-stats">
        <div><strong>{cardCount(cards)}</strong><span>Cards in list</span></div>
        <div><strong>{ownedCount}</strong><span>Already owned</span></div>
        <div><strong>{available.length}</strong><span>Available at Geega</span></div>
        <div><strong>{missing.length}</strong><span>Watched / missing</span></div>
      </div>

      <div className="gg-deck-tabs" role="tablist">
        {([
          ["deck", "Your Deck"],
          ["missing", `Missing (${missing.length})`],
          ["suggestions", "Suggestions"],
          ["combos", "Combos"],
        ] as const).map(([key, label]) => (
          <button key={key} className={tab === key ? "gg-active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "deck" && (
        <div className="gg-deck-visual-list">
          {cards.map((card) => {
            const match = matchByCard.get(card.id);
            const imageUrl = cardImages[card.id] ?? match?.image_url ?? null;
            return (
              <div className="gg-deck-visual-row" key={card.id}>
                <button
                  type="button"
                  className={`gg-deck-card-thumb${imageUrl ? "" : " gg-deck-card-thumb--empty"}`}
                  onClick={() => imageUrl && setEnlargedCard({ name: card.card_name, imageUrl })}
                  disabled={!imageUrl}
                  aria-label={imageUrl ? `Enlarge ${card.card_name}` : `No image available for ${card.card_name}`}
                >
                  {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span>?</span>}
                </button>

                <div className="gg-deck-visual-row__content">
                  <div className="gg-deck-row__main">
                    <div className="gg-deck-card-title">
                      {formatMaxCopies(deck.format) > 1 ? (
                        <select
                          className="gg-deck-quantity"
                          value={card.quantity}
                          aria-label={`Quantity of ${card.card_name}`}
                          onChange={(event) => void updateCardQuantity(card, Number(event.target.value))}
                        >
                          {Array.from({ length: formatMaxCopies(deck.format) }, (_, index) => index + 1).map((quantity) => (
                            <option key={quantity} value={quantity}>{quantity}×</option>
                          ))}
                        </select>
                      ) : (
                        <span className="gg-deck-quantity-static">1×</span>
                      )}
                      <strong>{card.card_name}</strong>
                    </div>
                    <span className="gg-card-meta">{card.section}</span>
                  </div>
                  <div className="gg-deck-row__state">
                    {card.owned ? (
                      <span className="gg-badge">Owned</span>
                    ) : match?.inventory_item_id ? (
                      <>
                        <span className="gg-badge">In stock · {formatCents(match.price_cents ?? 0)}</span>
                        <button className="gg-btn gg-btn-sm" onClick={() => void addItem(match.inventory_item_id!, 1)}>Add</button>
                      </>
                    ) : (
                      <span className="gg-badge gg-badge-foil">Watching</span>
                    )}
                    <label className="gg-check gg-deck-owned">
                      <input type="checkbox" checked={card.owned} onChange={() => void toggleOwned(card)} />
                      I own this
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "missing" && (
        <div className="gg-deck-cardlist">
          {missing.length === 0 ? (
            <div className="gg-empty">Every unowned card in this deck is currently available.</div>
          ) : missing.map((card) => (
            <div className="gg-deck-row" key={card.id}>
              <div className="gg-deck-row__main">
                <strong>{card.quantity}× {card.card_name}</strong>
                <span className="gg-card-meta">We’ll watch all matching printings.</span>
              </div>
              <span className="gg-badge gg-badge-foil">Restock watch active</span>
            </div>
          ))}
        </div>
      )}

      {tab === "suggestions" && (
        <Suggestions recommendations={recommendations} addItem={addItem} />
      )}

      {enlargedCard && (
        <div className="gg-card-lightbox" role="presentation" onMouseDown={() => setEnlargedCard(null)}>
          <div className="gg-card-lightbox__dialog" role="dialog" aria-modal="true" aria-label={enlargedCard.name} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="gg-card-lightbox__close" onClick={() => setEnlargedCard(null)} aria-label="Close enlarged card">×</button>
            <img src={enlargedCard.imageUrl} alt={enlargedCard.name} />
            <strong>{enlargedCard.name}</strong>
          </div>
        </div>
      )}

      {tab === "combos" && (
        <div className="gg-dash-card gg-deck-combos">
          <h3>Combo & interaction research</h3>
          <p>
            Your saved deck is ready to compare against known Commander interactions. For this first release,
            Geega keeps the deck data private and links you to Commander Spellbook rather than scraping or copying their database.
          </p>
          <a
            className="gg-btn"
            href="https://commanderspellbook.com/find-my-combos/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Find my combos on Commander Spellbook ↗
          </a>
          <p className="gg-card-meta">
            Tip: export/copy this same decklist there to see known combos and near-combos.
          </p>
        </div>
      )}
    </div>
  );
}

function Suggestions({
  recommendations,
  addItem,
}: {
  recommendations: Recommendation[];
  addItem: (id: string, qty?: number) => Promise<void>;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, Recommendation[]>();
    for (const rec of recommendations) {
      if (!m.has(rec.category)) m.set(rec.category, []);
      m.get(rec.category)!.push(rec);
    }
    return Array.from(m.entries()).sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]));
  }, [recommendations]);

  if (!recommendations.length) {
    return <div className="gg-empty">Add a recognized Commander to unlock deck suggestions.</div>;
  }

  return (
    <div className="gg-rec-groups">
      <div className="gg-dash-card gg-rec-intro">
        <strong>Beginner-friendly suggestions</strong>
        <p>These suggestions use your commander’s color identity, themes, common deck roles, and your selected budget. “Available at Geega” is shown separately so inventory never decides what counts as a good fit.</p>
      </div>

      {grouped.map(([category, rows]) => (
        <section key={category} className="gg-rec-group">
          <h3>{category}</h3>
          <div className="gg-rec-grid">
            {rows.slice(0, 8).map((rec) => (
              <article className="gg-rec-card" key={rec.oracle_id}>
                {rec.image_url && <img src={rec.image_url} alt="" loading="lazy" />}
                <div className="gg-rec-card__body">
                  <strong>{rec.card_name}</strong>
                  <p>{rec.reason}</p>
                  <div className="gg-rec-card__foot">
                    {rec.in_stock && rec.inventory_item_id ? (
                      <>
                        <span className="gg-badge">At Geega · {formatCents(rec.store_price_cents ?? 0)}</span>
                        <button className="gg-btn gg-btn-sm" onClick={() => void addItem(rec.inventory_item_id!, 1)}>Add</button>
                      </>
                    ) : (
                      <span className="gg-card-meta">
                        Typical card price {rec.scryfall_price_cents ? formatCents(rec.scryfall_price_cents) : "not available"}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
