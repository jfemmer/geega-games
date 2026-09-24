import { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { authLinkWithReturn } from "../lib/authRedirect";
import { Link } from "../lib/router";
import { formatCents } from "../lib/money";
import { OPEN_DECK_SHOP_EVENT } from "../lib/deckShopper";
import { Icon } from "./Icon";

const db = supabase as any;

type DeckSummary = {
  id: string;
  name: string;
  format: string;
  commander_name: string | null;
};

type DeckInventoryMatch = {
  deck_card_id: string;
  card_name: string;
  requested_quantity: number;
  owned: boolean;
  inventory_item_id: string | null;
  available_quantity: number | null;
  price_cents: number | null;
};

// Header search-bar entry point for "shop my deck": pick one of your own
// saved decks (never anyone else's — the customer_decks query below is
// scoped to auth.uid() the same way MyDecksPage's deck list is, and RLS
// enforces it server-side regardless) and bulk-add everything from it
// that's currently in stock. Reuses deck_inventory_matches, the same RPC
// DeckDetail's "Add available to cart" already relies on.
export default function ShopByDeck() {
  const { user } = useAuth();
  const { addItem } = useCart();
  const [open, setOpen] = useState(false);
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<DeckSummary | null>(null);
  const [matches, setMatches] = useState<DeckInventoryMatch[] | null>(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function closePopover() {
    setOpen(false);
    setSelectedDeck(null);
    setMatches(null);
    setAddedCount(null);
  }

  useEffect(() => {
    if (!open) return;
    function onOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePopover();
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closePopover();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggleOpen() {
    if (open) {
      closePopover();
      return;
    }
    setOpen(true);
    if (user && decks === null) {
      setLoadingDecks(true);
      const { data } = await db
        .from("customer_decks")
        .select("id, name, format, commander_name")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      setDecks((data ?? []) as DeckSummary[]);
      setLoadingDecks(false);
    }
  }

  // Opened from elsewhere on the page (the home page's deck showcase). Only
  // ever opens — a second click there shouldn't close it. The header is
  // sticky, so the popover is on screen wherever the page is scrolled.
  useEffect(() => {
    function onOpenRequest() {
      if (!open) void toggleOpen();
      containerRef.current?.querySelector<HTMLButtonElement>(".gg-deck-shop-toggle")?.focus();
    }
    window.addEventListener(OPEN_DECK_SHOP_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_DECK_SHOP_EVENT, onOpenRequest);
    // toggleOpen reads only open/user/decks, so re-subscribing on those keeps it current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, decks]);

  async function pickDeck(deck: DeckSummary) {
    setSelectedDeck(deck);
    setAddedCount(null);
    setLoadingMatches(true);
    const { data } = await db.rpc("deck_inventory_matches", { p_deck_id: deck.id });
    setMatches((data ?? []) as DeckInventoryMatch[]);
    setLoadingMatches(false);
  }

  const available = (matches ?? []).filter((m) => !m.owned && m.inventory_item_id);
  const availableTotalCents = available.reduce(
    (sum, m) => sum + (m.price_cents ?? 0) * Math.min(m.requested_quantity, m.available_quantity ?? 1),
    0,
  );

  async function addAllToCart() {
    setAdding(true);
    let added = 0;
    for (const match of available) {
      await addItem(match.inventory_item_id!, Math.min(match.requested_quantity, match.available_quantity ?? 1));
      added += 1;
    }
    setAdding(false);
    setAddedCount(added);
  }

  return (
    <div className="gg-deck-shop" ref={containerRef}>
      <button
        type="button"
        className="gg-deck-shop-toggle"
        onClick={() => void toggleOpen()}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Shop my deck: add a saved deck's in-stock cards to your cart"
        title="Shop my deck"
      >
        <Icon name="deck" size={18} />
        <span className="gg-deck-shop-label gg-deck-shop-label--full">Shop my deck</span>
        <span className="gg-deck-shop-label gg-deck-shop-label--short">Deck</span>
      </button>

      {open && (
        <div className="gg-deck-shop-popover">
          {!user ? (
            <div className="gg-deck-shop-empty">
              <p>
                Save your decks to see what&rsquo;s in stock, add it all to your cart in one
                click, and get restock alerts.
              </p>
              <Link
                to={authLinkWithReturn("/signup", "/account/decks")}
                className="gg-btn gg-btn-sm"
                onClick={closePopover}
              >
                Create a free account
              </Link>
              <Link to={authLinkWithReturn("/login")} onClick={closePopover}>
                Sign in
              </Link>
            </div>
          ) : selectedDeck ? (
            <div className="gg-deck-shop-detail">
              <button type="button" className="gg-deck-shop-back" onClick={() => setSelectedDeck(null)}>
                ← All decks
              </button>
              <strong>{selectedDeck.name}</strong>
              {loadingMatches ? (
                <p className="gg-card-meta">Checking stock…</p>
              ) : (
                <>
                  <p className="gg-card-meta">
                    {available.length} of {(matches ?? []).length} card{(matches ?? []).length === 1 ? "" : "s"} available at
                    Geega{available.length ? ` · ${formatCents(availableTotalCents)}` : ""}.
                  </p>
                  {addedCount !== null ? (
                    <div className="gg-alert gg-alert-ok">
                      Added {addedCount} card{addedCount === 1 ? "" : "s"} to your cart.
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="gg-btn gg-btn-sm"
                      disabled={!available.length || adding}
                      onClick={() => void addAllToCart()}
                    >
                      {adding ? "Adding…" : `Add ${available.length} to cart`}
                    </button>
                  )}
                  <Link to={`/account/decks/${selectedDeck.id}`} className="gg-deck-shop-viewlink" onClick={closePopover}>
                    View full deck →
                  </Link>
                </>
              )}
            </div>
          ) : loadingDecks ? (
            <p className="gg-card-meta">Loading your decks…</p>
          ) : !decks?.length ? (
            <div className="gg-deck-shop-empty">
              <p>You don’t have any saved decks yet.</p>
              <Link to="/account/decks" className="gg-btn gg-btn-sm" onClick={closePopover}>
                Create a deck
              </Link>
            </div>
          ) : (
            <ul className="gg-deck-shop-list" role="listbox" aria-label="Your saved decks">
              {decks.map((deck) => (
                <li key={deck.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => void pickDeck(deck)}>
                    <strong>{deck.name}</strong>
                    <span className="gg-card-meta">{deck.commander_name || deck.format}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
