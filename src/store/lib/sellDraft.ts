import {
  emptyCollection,
  emptyContact,
  newLocalId,
  type SellDraft,
} from "./sellTypes";

// Persists the in-progress Sell Your Cards form to localStorage, so an
// accidental refresh doesn't erase a manually-entered card list. Deliberately
// excludes photos — File objects can't be serialized, and the product
// requirement is explicit that image blobs must never sit in localStorage
// indefinitely. Photos are re-attached fresh each session (already-uploaded
// ones survive via their Storage path within the same session's React
// state, but not across a hard refresh — acceptable given the alternative
// would be persisting binary data client-side).

const STORAGE_KEY = "gg_sell_draft_v1";

export function emptyDraft(): SellDraft {
  return {
    draftId: newLocalId(),
    contact: emptyContact(),
    collection: emptyCollection(),
    cards: [],
    agreedToTerms: false,
  };
}

export function loadDraft(): SellDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SellDraft>;
    if (!parsed || typeof parsed !== "object" || !parsed.draftId) return null;
    return {
      draftId: parsed.draftId,
      contact: { ...emptyContact(), ...parsed.contact },
      collection: { ...emptyCollection(), ...parsed.collection },
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      agreedToTerms: false, // never resume a stale agreement across sessions
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: SellDraft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage full/unavailable (private browsing, quota) — the form still
    // works in-memory for this session, it just won't survive a refresh.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
