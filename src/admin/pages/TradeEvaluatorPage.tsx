import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SearchInput, TextField } from "../components/ui/Field";
import { Spinner } from "../components/ui/States";
import { InventoryCardImage } from "../components/cards/InventoryCardImage";
import { AddTradeCardDrawer, type TradeCardPick } from "../components/trade/AddTradeCardDrawer";
import { inventoryRepository } from "../repositories";
import { tradeRepository } from "../repositories/trades.supabase";
import { useToast } from "../hooks/useToast";
import { formatCents, formatDateTime } from "../utils/format";
import { priceForFinish } from "../utils/pricing";
import { CONDITION_LABELS, FINISH_LABELS } from "../utils/labels";
import {
  DEFAULT_TRADE_CREDIT_PERCENT,
  MAX_CUSTOMER_NAME,
  MAX_TRADE_CREDIT_PERCENT,
  MAX_TRADE_LINES,
  MAX_TRADE_QUANTITY,
  TRADE_CREDIT_PRESETS,
  countedLines,
  evaluateTrade,
  isEmailAddress,
  isTextablePhone,
  lineErrors,
  parseCreditPercent,
  parsePriceCents,
  parseQuantity,
  pricedTotal,
  regularPriceCents,
  sideTotal,
  smsHref,
  tradeLinkMessage,
  tradeTotals,
  type TradeLineInput,
  type TradeSideTotal,
  type TradeTotals,
} from "../utils/tradeEvaluator";
import type { StaffTradeView, TradeCardPrinting } from "../../store/lib/trades";
import type { CardCondition, CardFinish, InventoryItem } from "../types";

// Trade evaluator: a customer trades cards in for cards from the shop. Staff
// type the TCG low of each card they bring and pick the trade credit
// percentage; the cards they want are picked from inventory at their regular
// website price, never a deal or sale price (see utils/tradeEvaluator.ts).
// The page shows what they pay, or the trade credit they have left.
//
// Confirming needs the customer's name. It saves the trade (the server works
// every number out again and refuses a price that has changed; see
// api/admin/trades.ts) and gives it a private link to the full breakdown, to
// text from this phone or email from the website. Inventory and store credit
// don't change.
//
// The trade in progress is kept on this device, so switching to Inventory to
// check a card, or the phone reloading the app, doesn't lose it. Cards from
// inventory are checked again when the page opens, in case a price or the
// stock changed meanwhile.

type Field = "name" | "quantity" | "price";

interface Line extends TradeLineInput {
  id: string;
  /** A card found with the search: its picture, and Scryfall's price for its finish (a guide to the TCG low). */
  imageUrl?: string | null;
  referenceCents?: number | null;
}

/** A card from inventory on the trade, as it was when last checked. */
interface YourLine {
  /** inventory_items.id */
  id: string;
  cardName: string;
  setName: string | null;
  setCode: string;
  collectorNumber: string;
  scryfallId: string | null;
  imageUrl: string | null;
  condition: CardCondition;
  finish: CardFinish;
  variantType: string | null;
  /** Its regular website price. */
  priceCents: number;
  /** The deal price on the website, when it's on deal: shown as not counting. */
  dealPriceCents: number | null;
  stock: number;
  quantity: number;
  /** Why it can't be traded any more ("is sold out"…), or null. */
  unavailable: string | null;
}

interface Customer {
  name: string;
  phone: string;
  email: string;
}

interface Draft {
  creditPercent: string;
  customer: Customer;
  theirs: Line[];
  yours: YourLine[];
  /** The trade once it's confirmed: the cards can't change after that. */
  confirmed: StaffTradeView | null;
}

const STORAGE_KEY = "gg-trade-draft";
/** Where the first version kept its trade (both sides typed at TCG low). */
const OLD_STORAGE_KEY = "gg-trade-evaluator";

const NOT_CHECKED = { name: false, phone: false, email: false };

let lineCount = 0;
function newLine(): Line {
  lineCount += 1;
  return { id: `line-${lineCount}`, name: "", quantity: "1", price: "" };
}

function emptyDraft(creditPercent = String(DEFAULT_TRADE_CREDIT_PERCENT)): Draft {
  return { creditPercent, customer: { name: "", phone: "", email: "" }, theirs: [newLine()], yours: [], confirmed: null };
}

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function restorePrinting(value: unknown): TradeCardPrinting | null {
  const o = (value ?? {}) as Record<string, unknown>;
  const [scryfallId, setCode, collectorNumber, condition, finish] = [o.scryfallId, o.setCode, o.collectorNumber, o.condition, o.finish];
  if (![scryfallId, setCode, collectorNumber, condition, finish].every((v) => typeof v === "string" && v !== "")) return null;
  return {
    scryfallId: scryfallId as string,
    setName: textOrNull(o.setName),
    setCode: setCode as string,
    collectorNumber: collectorNumber as string,
    condition: condition as string,
    finish: finish as string,
  };
}

function restoreTheirs(value: unknown): Line[] {
  const lines = (Array.isArray(value) ? value : []).slice(0, MAX_TRADE_LINES).flatMap((saved: unknown) => {
    if (!saved || typeof saved !== "object") return [];
    const fields = saved as Record<string, unknown>;
    const printing = restorePrinting(fields.printing);
    return [
      {
        ...newLine(),
        name: text(fields.name),
        quantity: text(fields.quantity, "1"),
        price: text(fields.price),
        ...(printing && { printing, imageUrl: textOrNull(fields.imageUrl), referenceCents: count(fields.referenceCents) }),
      },
    ];
  });
  return lines.length > 0 ? lines : [newLine()];
}

function restoreYours(value: unknown): YourLine[] {
  return (Array.isArray(value) ? value : []).slice(0, MAX_TRADE_LINES).flatMap((saved: unknown) => {
    const o = (saved ?? {}) as Record<string, unknown>;
    const priceCents = count(o.priceCents);
    const stock = count(o.stock);
    const quantity = count(o.quantity);
    // The first version's typed lines have none of these, and are left out.
    if (typeof o.id !== "string" || typeof o.cardName !== "string" || !priceCents || !stock || !quantity) return [];
    return [
      {
        id: o.id,
        cardName: o.cardName,
        setName: textOrNull(o.setName),
        setCode: text(o.setCode),
        collectorNumber: text(o.collectorNumber),
        scryfallId: textOrNull(o.scryfallId),
        imageUrl: textOrNull(o.imageUrl),
        condition: text(o.condition, "NM") as CardCondition,
        finish: text(o.finish, "nonfoil") as CardFinish,
        variantType: textOrNull(o.variantType),
        priceCents,
        dealPriceCents: count(o.dealPriceCents),
        stock,
        quantity: Math.min(quantity, stock),
        unavailable: textOrNull(o.unavailable),
      },
    ];
  });
}

function restoreConfirmed(value: unknown): StaffTradeView | null {
  const o = (value ?? {}) as Record<string, unknown>;
  const numbers = ["tradeNumber", "creditPercent", "theirTcgLowCents", "creditCents", "yourCardsCents", "balanceCents"];
  const strings = ["id", "link", "customerName", "createdAt"];
  return numbers.every((key) => typeof o[key] === "number") && strings.every((key) => typeof o[key] === "string")
    ? (o as unknown as StaffTradeView)
    : null;
}

/** The trade left on this device, if storage allows it. */
function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(OLD_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const customer = (saved.customer ?? {}) as Record<string, unknown>;
      return {
        creditPercent: text(saved.creditPercent, String(DEFAULT_TRADE_CREDIT_PERCENT)),
        customer: { name: text(customer.name), phone: text(customer.phone), email: text(customer.email) },
        theirs: restoreTheirs(saved.theirs),
        yours: restoreYours(saved.yours),
        confirmed: restoreConfirmed(saved.confirmed),
      };
    }
  } catch {
    // Storage blocked or unreadable: start a new trade.
  }
  return emptyDraft();
}

function saveDraft(draft: Draft) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...draft,
        theirs: draft.theirs.map(({ name, quantity, price, printing, imageUrl, referenceCents }) => ({
          name,
          quantity,
          price,
          printing: printing ?? null,
          imageUrl: imageUrl ?? null,
          referenceCents: referenceCents ?? null,
        })),
      }),
    );
    // A trade from the first version has moved over by now.
    window.localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // Not kept, but the trade still works for this visit.
  }
}

function isBlank(line: Line): boolean {
  return line.name.trim() === "" && line.price.trim() === "" && (line.quantity.trim() === "" || line.quantity.trim() === "1");
}

function cardCount(cards: number): string {
  return cards === 1 ? "1 card" : `${cards} cards`;
}

/** "a", "a and b", "a, b and c". */
function listOf(items: (string | number)[]): string {
  const words = items.map(String);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function phoneProblem(phone: string): string | undefined {
  return phone.trim() && !isTextablePhone(phone) ? "Check the number: it needs 7 to 15 digits." : undefined;
}

function emailProblem(email: string): string | undefined {
  return email.trim() && !isEmailAddress(email) ? "Check the email address." : undefined;
}

function describeCard(card: {
  setCode: string;
  collectorNumber?: string;
  condition: string;
  finish: string;
  variantType?: string | null;
}): string {
  return [
    `${card.setCode.toUpperCase()}${card.collectorNumber ? ` #${card.collectorNumber}` : ""}`,
    CONDITION_LABELS[card.condition as CardCondition] ?? card.condition,
    card.finish !== "nonfoil" ? (FINISH_LABELS[card.finish as CardFinish] ?? card.finish) : null,
    card.variantType,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An inventory card as a line on the trade, or null when the website isn't selling it. */
function fromInventory(item: InventoryItem): YourLine | null {
  const priceCents = regularPriceCents(item);
  if (item.status !== "active" || priceCents === null || priceCents <= 0 || item.quantity <= 0) return null;
  return {
    id: item.id,
    cardName: item.cardName,
    setName: item.setName,
    setCode: item.setCode,
    collectorNumber: item.collectorNumber,
    scryfallId: item.scryfallId,
    imageUrl: item.imageUrl,
    condition: item.condition,
    finish: item.finish,
    variantType: item.variantType?.trim() || null,
    priceCents,
    dealPriceCents: item.priceCents < priceCents ? item.priceCents : null,
    stock: item.quantity,
    quantity: 1,
    unavailable: null,
  };
}

function unavailableReason(item: InventoryItem | null): string {
  if (!item) return "isn't in inventory any more";
  if (item.quantity <= 0) return "is sold out";
  return "isn't for sale on the website right now";
}

/**
 * Each card as inventory has it now, and what changed since it was added.
 * A card that couldn't be checked (no connection) is left as it was.
 */
async function checkYours(lines: YourLine[]): Promise<{ fresh: Map<string, YourLine>; changes: string[] }> {
  const items = await Promise.all(lines.map((line) => inventoryRepository.get(line.id).catch(() => undefined)));
  const fresh = new Map<string, YourLine>();
  const changes: string[] = [];
  lines.forEach((line, index) => {
    const item = items[index];
    if (item === undefined) return;
    const now = item ? fromInventory(item) : null;
    if (!now) {
      const reason = unavailableReason(item);
      if (line.unavailable !== reason) changes.push(`${line.cardName} ${reason}`);
      fresh.set(line.id, { ...line, unavailable: reason });
      return;
    }
    if (now.priceCents !== line.priceCents) {
      changes.push(`${line.cardName} is now ${formatCents(now.priceCents)}, not ${formatCents(line.priceCents)}`);
    }
    if (now.stock < line.quantity) {
      changes.push(`only ${now.stock} ${line.cardName} ${now.stock === 1 ? "is" : "are"} in stock`);
    }
    fresh.set(line.id, { ...now, quantity: Math.min(line.quantity, now.stock) });
  });
  return { fresh, changes };
}

/** The checked cards into the trade, keeping any quantity changed meanwhile. */
function mergeChecked(yours: YourLine[], fresh: Map<string, YourLine>): YourLine[] {
  return yours.map((line) => {
    const now = fresh.get(line.id);
    if (!now) return line;
    return now.unavailable ? { ...line, unavailable: now.unavailable } : { ...now, quantity: Math.min(line.quantity, now.stock) };
  });
}

/** Sends a confirmed trade's link: email from the website, or a text from this phone. */
function useTradeSharing(onUpdated: (trade: StaffTradeView) => void) {
  const toast = useToast();
  const [emailing, setEmailing] = useState<string | null>(null);

  const email = useCallback(
    async (trade: StaffTradeView, address: string) => {
      setEmailing(trade.id);
      try {
        const updated = await tradeRepository.email(trade.id, address.trim());
        onUpdated(updated);
        toast.success(`Emailed trade #${trade.tradeNumber} to ${updated.emailedTo ?? address.trim()}.`);
      } catch (err) {
        toast.error(err instanceof Error && err.message ? err.message : "The email didn't send. Try again.");
      } finally {
        setEmailing(null);
      }
    },
    [onUpdated, toast],
  );

  /** The messaging app opens from the link itself; this notes the text on the trade. */
  const noteTexted = useCallback(
    (trade: StaffTradeView, phone: string) => {
      tradeRepository.texted(trade.id, phone.trim()).then(onUpdated, () => {
        // Only the note is lost: the text itself goes out from the phone.
      });
    },
    [onUpdated],
  );

  const copy = useCallback(
    async (trade: StaffTradeView) => {
      try {
        await navigator.clipboard.writeText(trade.link);
        toast.success(`Copied the link to trade #${trade.tradeNumber}.`);
      } catch {
        toast.error("Couldn't copy the link. Open it and copy it from the address bar.");
      }
    },
    [toast],
  );

  return { email, noteTexted, copy, emailing };
}

export function TradeEvaluatorPage() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmTrade, setConfirmTrade] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Which customer fields show their errors: after leaving the field, or trying to confirm.
  const [checked, setChecked] = useState(NOT_CHECKED);
  const [recent, setRecent] = useState<StaffTradeView[] | null>(null);
  const [recentFailed, setRecentFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // An input to focus once the next render has put it on the page.
  const pendingFocus = useRef<string | null>(null);
  const openingDraft = useRef(draft);
  const creditId = useId();

  useEffect(() => saveDraft(draft), [draft]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = rootRef.current?.querySelector<HTMLInputElement>(`[data-trade-field="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    target?.focus();
  });

  // A trade left from before: its cards may have changed price, sold or come off the website since.
  useEffect(() => {
    const opening = openingDraft.current;
    if (opening.confirmed || opening.yours.length === 0) return;
    let cancelled = false;
    void checkYours(opening.yours).then(({ fresh, changes }) => {
      if (cancelled) return;
      setDraft((prev) => (prev.confirmed ? prev : { ...prev, yours: mergeChecked(prev.yours, fresh) }));
      if (changes.length > 0) setProblem(`Updated from inventory: ${changes.join("; ")}. Check the new total with them.`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchRecent = useCallback(() => {
    tradeRepository.recent().then(
      (trades) => {
        setRecent(trades);
        setRecentFailed(false);
      },
      () => setRecentFailed(true),
    );
  }, []);
  useEffect(() => fetchRecent(), [fetchRecent]);

  function retryRecent() {
    setRecentFailed(false);
    setRecent(null);
    fetchRecent();
  }

  /** A trade changed on the server (confirmed, emailed, texted): show it everywhere. */
  const tradeUpdated = useCallback((trade: StaffTradeView) => {
    setDraft((prev) => (prev.confirmed?.id === trade.id ? { ...prev, confirmed: trade } : prev));
    setRecent((prev) =>
      prev && (prev.some((t) => t.id === trade.id) ? prev.map((t) => (t.id === trade.id ? trade : t)) : [trade, ...prev]),
    );
  }, []);
  const sharing = useTradeSharing(tradeUpdated);

  const { customer, confirmed } = draft;
  const locked = confirmed !== null;
  const percent = parseCreditPercent(draft.creditPercent);
  const theirTotal = useMemo(() => sideTotal(draft.theirs), [draft.theirs]);
  // A card that's sold or come off the website isn't part of the trade, though it stays listed until it's taken off.
  const tradeable = useMemo(() => draft.yours.filter((line) => !line.unavailable), [draft.yours]);
  const evaluation = percent === null ? null : evaluateTrade(draft.theirs, tradeable, percent);
  // Once confirmed, the numbers are the ones saved with the trade.
  const totals: TradeTotals | null = confirmed
    ? tradeTotals(confirmed.theirTcgLowCents, confirmed.yourCardsCents, confirmed.creditPercent)
    : evaluation;
  const shownPercent = confirmed ? confirmed.creditPercent : percent;
  const hasEntries =
    !draft.theirs.every(isBlank) || draft.yours.length > 0 || Object.values(customer).some((value) => value.trim() !== "");

  /** Staff changing the trade: whatever stopped the last confirm no longer applies. */
  function change(update: (prev: Draft) => Draft) {
    setProblem(null);
    setDraft(update);
  }

  function focusLater(id: string, field: Field) {
    pendingFocus.current = `theirs:${id}:${field}`;
  }

  function setCustomer(field: keyof Customer, value: string) {
    change((prev) => ({ ...prev, customer: { ...prev.customer, [field]: value } }));
  }

  function setCreditPercent(value: string) {
    change((prev) => ({ ...prev, creditPercent: value }));
  }

  function updateLine(id: string, field: Field, value: string) {
    change((prev) => ({ ...prev, theirs: prev.theirs.map((l) => (l.id === id ? { ...l, [field]: value } : l)) }));
  }

  function addLine(focusField: Field = "name") {
    if (draft.theirs.length >= MAX_TRADE_LINES) return;
    const line = newLine();
    focusLater(line.id, focusField);
    change((prev) => ({ ...prev, theirs: [...prev.theirs, line] }));
  }

  function removeLine(id: string) {
    const lines = draft.theirs;
    const index = lines.findIndex((l) => l.id === id);
    if (lines.length === 1) {
      // The last line empties instead, so there's always somewhere to type.
      const fresh = newLine();
      focusLater(fresh.id, "name");
      change((prev) => ({ ...prev, theirs: [fresh] }));
      return;
    }
    const neighbor = lines[index + 1] ?? lines[index - 1];
    if (neighbor) focusLater(neighbor.id, "name");
    change((prev) => ({ ...prev, theirs: prev.theirs.filter((l) => l.id !== id) }));
  }

  // Enter moves down a column, spreadsheet style. On the last line typed by
  // hand it adds another (a card found with the search gets Add card instead).
  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number, field: Field) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = draft.theirs[index + 1];
    if (next) {
      const target = next.printing && field === "name" ? "quantity" : field;
      rootRef.current?.querySelector<HTMLInputElement>(`[data-trade-field="theirs:${next.id}:${target}"]`)?.focus();
    } else if (!draft.theirs[index]?.printing) {
      addLine(field);
    }
  }

  /** A card found with the search: a line of its own, or more of one already on the trade. */
  function addTheirCard(pick: TradeCardPick) {
    const { printing: found, condition, finish } = pick;
    const printing: TradeCardPrinting = {
      scryfallId: found.scryfallId,
      setName: found.setName || null,
      setCode: found.setCode,
      collectorNumber: found.collectorNumber,
      condition,
      finish,
    };
    const same = draft.theirs.find(
      (l) => l.printing?.scryfallId === printing.scryfallId && l.printing.condition === condition && l.printing.finish === finish,
    );
    if (same) {
      const quantity = Math.min((parseQuantity(same.quantity) ?? 0) + pick.quantity, MAX_TRADE_QUANTITY);
      change((prev) => ({
        ...prev,
        theirs: prev.theirs.map((l) =>
          l.id === same.id ? { ...l, quantity: String(quantity), price: l.price.trim() ? l.price : pick.price } : l,
        ),
      }));
      toast.success(`Added ${pick.quantity} more ${found.cardName} (${quantity} on the trade).`);
      return;
    }
    if (draft.theirs.length >= MAX_TRADE_LINES) {
      toast.error(`A trade can have up to ${MAX_TRADE_LINES} of their cards.`);
      return;
    }
    const line: Line = {
      ...newLine(),
      name: found.cardName,
      quantity: String(pick.quantity),
      price: pick.price,
      printing,
      imageUrl: found.images?.small ?? found.imageUrl ?? null,
      referenceCents: priceForFinish(found, finish),
    };
    // The empty line a new trade starts with gives way to the first card found.
    change((prev) => ({
      ...prev,
      theirs: prev.theirs.length === 1 && isBlank(prev.theirs[0]) ? [line] : [...prev.theirs, line],
    }));
  }

  function addYours(item: InventoryItem) {
    const line = fromInventory(item);
    if (!line) return;
    const existing = draft.yours.find((l) => l.id === line.id);
    if (existing && !existing.unavailable && existing.quantity >= line.stock) {
      toast.info(`Only ${line.stock} in stock.`);
      return;
    }
    change((prev) => {
      const onTrade = prev.yours.find((l) => l.id === line.id);
      if (!onTrade) return { ...prev, yours: [...prev.yours, line] };
      // Found again in a search: it's for sale after all, at the price the search found.
      const quantity = onTrade.unavailable ? 1 : Math.min(onTrade.quantity + 1, line.stock);
      return { ...prev, yours: prev.yours.map((l) => (l.id === line.id ? { ...line, quantity } : l)) };
    });
  }

  function setYourQuantity(id: string, quantity: number) {
    change((prev) => ({
      ...prev,
      yours: prev.yours
        .map((l) => (l.id === id ? { ...l, quantity: Math.max(0, Math.min(quantity, l.stock)) } : l))
        .filter((l) => l.quantity > 0),
    }));
  }

  function startOver() {
    setDraft((prev) => emptyDraft(prev.creditPercent));
    setConfirmClear(false);
    setProblem(null);
    setChecked(NOT_CHECKED);
  }

  /** Why the trade can't be confirmed yet, or null when it can. */
  function confirmProblem(): string | null {
    if (!customer.name.trim()) return "Enter their name to confirm the trade.";
    if (phoneProblem(customer.phone)) return "Check their phone number, or leave it blank.";
    if (emailProblem(customer.email)) return "Check their email address, or leave it blank.";
    if (percent === null) return `Choose a trade credit from 1 to ${MAX_TRADE_CREDIT_PERCENT}%.`;
    if (theirTotal.invalidLines > 0) return "Fix the prices or quantities outlined in red first.";
    const unpriced = draft.theirs.flatMap((line, i) => (!isBlank(line) && line.price.trim() === "" ? [i + 1] : []));
    if (unpriced.length > 0) {
      return `Add the TCG low on ${unpriced.length === 1 ? "line" : "lines"} ${listOf(unpriced)} of their cards, or remove ${
        unpriced.length === 1 ? "it" : "them"
      }.`;
    }
    const gone = draft.yours.filter((l) => l.unavailable);
    if (gone.length > 0) {
      return `Take ${listOf(gone.map((l) => l.cardName))} off the trade: ${gone.length === 1 ? "it isn't" : "they aren't"} for sale any more.`;
    }
    if (countedLines(draft.theirs).length === 0 && draft.yours.length === 0) return "Add the cards on at least one side of the trade.";
    return null;
  }

  function askToConfirm() {
    setChecked({ name: true, phone: true, email: true });
    const reason = confirmProblem();
    setProblem(reason);
    if (!reason) setConfirmTrade(true);
    else if (!customer.name.trim()) rootRef.current?.querySelector<HTMLInputElement>('[data-trade-field="customer:name"]')?.focus();
  }

  async function confirmNow() {
    if (percent === null) return;
    const sent = draft;
    try {
      const trade = await tradeRepository.confirm({
        customer: {
          name: sent.customer.name.trim(),
          phone: sent.customer.phone.trim() || null,
          email: sent.customer.email.trim() || null,
        },
        creditPercent: percent,
        theirs: countedLines(sent.theirs),
        yours: sent.yours.map((l) => ({ inventoryItemId: l.id, quantity: l.quantity, priceCents: l.priceCents })),
      });
      setDraft((prev) => ({ ...prev, confirmed: trade }));
      setRecent((prev) => prev && [trade, ...prev.filter((t) => t.id !== trade.id)]);
      setProblem(null);
      toast.success(`Trade #${trade.tradeNumber} confirmed. Send them the breakdown.`);
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : "Could not save the trade. Try again.");
      // A price, the stock or a listing may have changed: show the cards as inventory has them now.
      if (sent.yours.length > 0) {
        const { fresh } = await checkYours(sent.yours);
        setDraft((prev) => (prev.confirmed ? prev : { ...prev, yours: mergeChecked(prev.yours, fresh) }));
      }
    } finally {
      setConfirmTrade(false);
    }
  }

  const name = customer.name.trim();

  return (
    <div className="gg-page" ref={rootRef}>
      <PageHeader
        title="Trade Evaluator"
        description="Their cards at TCG low, yours at the regular website price. Inventory doesn't change when you confirm."
        actions={
          locked ? (
            <Button variant="primary" icon="plus" onClick={startOver}>
              New trade
            </Button>
          ) : (
            <Button variant="ghost" icon="trash" disabled={!hasEntries} onClick={() => setConfirmClear(true)}>
              Clear trade
            </Button>
          )
        }
      />

      <section className="gg-card gg-trade__customer" aria-label="Customer">
        <TextField
          label="Customer name"
          required
          data-trade-field="customer:name"
          maxLength={MAX_CUSTOMER_NAME}
          autoComplete="off"
          autoCapitalize="words"
          value={customer.name}
          disabled={locked}
          error={checked.name && !name ? "Enter their name." : undefined}
          onChange={(e) => setCustomer("name", e.target.value)}
        />
        <TextField
          label="Phone"
          hint="To text them the breakdown"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={32}
          value={customer.phone}
          error={checked.phone ? phoneProblem(customer.phone) : undefined}
          onBlur={() => setChecked((prev) => ({ ...prev, phone: true }))}
          onChange={(e) => setCustomer("phone", e.target.value)}
        />
        <TextField
          label="Email"
          hint="To email it"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          maxLength={254}
          value={customer.email}
          error={checked.email ? emailProblem(customer.email) : undefined}
          onBlur={() => setChecked((prev) => ({ ...prev, email: true }))}
          onChange={(e) => setCustomer("email", e.target.value)}
        />
      </section>

      <div className="gg-trade-wrap">
        <div className="gg-trade">
          <TheirList
            lines={draft.theirs}
            total={theirTotal}
            locked={locked}
            footer={
              totals &&
              shownPercent !== null && (
                <div className="gg-trade__sum gg-trade__sum--credit">
                  <span>Trade credit at {shownPercent}%</span>
                  <span>{formatCents(totals.creditCents)}</span>
                </div>
              )
            }
            onChange={updateLine}
            onSearch={() => setAddingCard(true)}
            onAddByHand={() => addLine()}
            onRemove={removeLine}
            onKeyDown={onFieldKeyDown}
          />
          <YourList lines={draft.yours} locked={locked} onAdd={addYours} onQuantity={setYourQuantity} />

          <section className="gg-card gg-trade__summary" aria-labelledby={`${creditId}-title`}>
            <h2 className="gg-trade__heading" id={`${creditId}-title`}>
              {confirmed ? `Trade #${confirmed.tradeNumber}` : "The trade"}
            </h2>

            {confirmed ? (
              <p className="gg-trade__confirmed">
                <Icon name="checkCircle" size={16} />
                <span>
                  Confirmed for {confirmed.customerName}, {formatDateTime(confirmed.createdAt)}
                </span>
              </p>
            ) : (
              <div className="gg-trade__credit">
                <div className="gg-trade__credit-head">
                  <label className="gg-field__label" htmlFor={creditId}>
                    Trade credit
                  </label>
                  <div className="gg-trade__percent">
                    <input
                      id={creditId}
                      className="gg-input"
                      inputMode="numeric"
                      autoComplete="off"
                      value={draft.creditPercent}
                      aria-invalid={percent === null || undefined}
                      aria-describedby={`${creditId}-hint`}
                      onChange={(e) => setCreditPercent(e.target.value)}
                    />
                    <span aria-hidden="true">%</span>
                  </div>
                </div>
                <div className="gg-trade__presets" role="group" aria-label="Common trade credit percentages">
                  {TRADE_CREDIT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="gg-trade__preset"
                      aria-pressed={percent === preset}
                      onClick={() => setCreditPercent(String(preset))}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
                {percent === null ? (
                  <p className="gg-field__error" id={`${creditId}-hint`} role="alert">
                    Enter a whole number from 1 to {MAX_TRADE_CREDIT_PERCENT}.
                  </p>
                ) : (
                  <p className="gg-field__hint" id={`${creditId}-hint`}>
                    Their cards count at {percent}% of TCG low. Kept for your next trade.
                  </p>
                )}
              </div>
            )}

            {totals && shownPercent !== null && (
              <>
                <dl className="gg-trade__totals">
                  <div>
                    <dt>Their cards at TCG low</dt>
                    <dd>{formatCents(totals.theirTcgLowCents)}</dd>
                  </div>
                  <div>
                    <dt>Trade credit at {shownPercent}%</dt>
                    <dd>{formatCents(totals.creditCents)}</dd>
                  </div>
                  <div>
                    <dt>Your cards at website price</dt>
                    <dd>{formatCents(totals.yourCents)}</dd>
                  </div>
                </dl>
                <TradeResult totals={totals} />
              </>
            )}

            {confirmed ? (
              <SharePanel
                trade={confirmed}
                phone={customer.phone}
                email={customer.email}
                emailing={sharing.emailing === confirmed.id}
                onEmail={(address) => sharing.email(confirmed, address)}
                onTexted={(phone) => sharing.noteTexted(confirmed, phone)}
                onCopy={() => sharing.copy(confirmed)}
              />
            ) : (
              <>
                {problem && (
                  <p className="gg-trade__problem" role="alert">
                    {problem}
                  </p>
                )}
                <Button variant="primary" icon="check" className="gg-trade__confirm" onClick={askToConfirm}>
                  Confirm trade
                </Button>
              </>
            )}
          </section>
        </div>
      </div>

      <RecentTrades
        trades={recent}
        failed={recentFailed}
        emailing={sharing.emailing}
        onRetry={retryRecent}
        onEmail={(trade) => trade.customerEmail && sharing.email(trade, trade.customerEmail)}
        onTexted={(trade) => trade.customerPhone && sharing.noteTexted(trade, trade.customerPhone)}
        onCopy={sharing.copy}
      />

      {addingCard && <AddTradeCardDrawer onClose={() => setAddingCard(false)} onAdd={addTheirCard} />}

      <ConfirmDialog
        open={confirmClear}
        title="Clear this trade?"
        message={`The customer and both lists are emptied.${percent !== null ? ` The trade credit stays at ${percent}%.` : ""}`}
        confirmLabel="Clear trade"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={startOver}
      />
      <ConfirmDialog
        open={confirmTrade}
        title={`Confirm the trade with ${name || "this customer"}?`}
        message={`${evaluation ? `${resultSentence(evaluation)} ` : ""}This saves the trade, so you can text or email them the full breakdown. Inventory doesn't change.`}
        confirmLabel="Confirm trade"
        onCancel={() => setConfirmTrade(false)}
        onConfirm={confirmNow}
      />
    </div>
  );
}

/** The bottom line in a sentence, for the confirm dialog. */
function resultSentence(totals: TradeTotals): string {
  if (totals.outcome === "they_pay") return `They pay you ${formatCents(-totals.balanceCents)}.`;
  if (totals.outcome === "credit_left") return `You owe them ${formatCents(totals.balanceCents)} in trade credit.`;
  if (totals.outcome === "even") return "It's an even trade.";
  return "";
}

/** A card found with the search, in the card column: its picture, name and printing. */
function FoundCard({ line, printing }: { line: Line; printing: TradeCardPrinting }) {
  return (
    <div className="gg-trade__found">
      <InventoryCardImage
        item={{
          scryfallId: printing.scryfallId,
          setCode: printing.setCode,
          collectorNumber: printing.collectorNumber,
          imageUrl: line.imageUrl ?? null,
          cardName: line.name,
        }}
        size="xs"
        loadingPriority="lazy"
      />
      <span className="gg-trade__found-body">
        <span className="gg-trade__found-name">{line.name}</span>
        <span className="gg-trade__found-meta">
          {describeCard(printing)}
          {line.referenceCents != null && ` · Scryfall ${formatCents(line.referenceCents)}`}
        </span>
      </span>
    </div>
  );
}

function TheirList({
  lines,
  total,
  locked,
  footer,
  onChange,
  onSearch,
  onAddByHand,
  onRemove,
  onKeyDown,
}: {
  lines: Line[];
  total: TradeSideTotal;
  locked: boolean;
  footer?: ReactNode;
  onChange: (id: string, field: Field, value: string) => void;
  /** Add card: find it with the card search. */
  onSearch: () => void;
  /** Enter by hand: a line to type in. */
  onAddByHand: () => void;
  onRemove: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, index: number, field: Field) => void;
}) {
  const headingId = useId();
  const counted = locked ? lines.filter((line) => !isBlank(line)) : lines;
  return (
    <section className="gg-card gg-trade__list gg-trade__list--theirs" aria-labelledby={headingId}>
      <header className="gg-trade__list-head">
        <h2 className="gg-trade__heading" id={headingId}>
          They're trading in
        </h2>
        <span className="gg-trade__count">{cardCount(total.cards)}</span>
      </header>

      {locked && counted.length === 0 ? (
        <p className="gg-muted gg-trade__empty">None.</p>
      ) : (
        <>
          <div className="gg-trade__cols" aria-hidden="true">
            <span>Card</span>
            <span>Qty</span>
            <span>TCG low</span>
            <span />
          </div>
          <ol className="gg-trade__rows">
            {counted.map((line, index) => {
              const n = index + 1;
              const rowClass = `gg-trade__row${line.printing ? " gg-trade__row--found" : ""}`;
              if (locked) {
                return (
                  <li key={line.id} className={`${rowClass} gg-trade__row--locked`}>
                    {line.printing ? <FoundCard line={line} printing={line.printing} /> : <span>{line.name.trim() || `Card ${n}`}</span>}
                    <span>{parseQuantity(line.quantity)}</span>
                    <span>{formatCents(parsePriceCents(line.price) ?? 0)}</span>
                    <span />
                  </li>
                );
              }
              const errors = lineErrors(line);
              const field = (name: Field) => ({
                "data-trade-field": `theirs:${line.id}:${name}`,
                onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => onKeyDown(e, index, name),
                onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(line.id, name, e.target.value),
                autoComplete: "off",
              });
              return (
                <li key={line.id} className={rowClass}>
                  {line.printing ? (
                    <FoundCard line={line} printing={line.printing} />
                  ) : (
                    <input
                      className="gg-input"
                      type="text"
                      placeholder="Name (optional)"
                      aria-label={`Card, line ${n} of their cards`}
                      value={line.name}
                      {...field("name")}
                    />
                  )}
                  <input
                    className="gg-input gg-trade__qty"
                    type="text"
                    inputMode="numeric"
                    aria-label={`Quantity, line ${n} of their cards`}
                    aria-invalid={errors.quantity || undefined}
                    value={line.quantity}
                    {...field("quantity")}
                  />
                  <div className="gg-trade__money">
                    <span aria-hidden="true">$</span>
                    <input
                      className="gg-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`TCG low price, line ${n} of their cards`}
                      aria-invalid={errors.price || undefined}
                      value={line.price}
                      {...field("price")}
                    />
                  </div>
                  <button
                    type="button"
                    className="gg-icon-btn gg-trade__remove"
                    aria-label={line.printing ? `Remove ${line.name}` : `Remove line ${n} of their cards`}
                    onClick={() => onRemove(line.id)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {!locked && (
        <div className="gg-trade__adds">
          <Button variant="secondary" size="sm" icon="plus" onClick={onSearch} disabled={lines.length >= MAX_TRADE_LINES}>
            Add card
          </Button>
          <Button variant="ghost" size="sm" onClick={onAddByHand} disabled={lines.length >= MAX_TRADE_LINES}>
            Enter by hand
          </Button>
        </div>
      )}

      <div className="gg-trade__foot">
        {total.invalidLines > 0 && (
          <p className="gg-trade__invalid" role="alert">
            {total.invalidLines === 1 ? "1 line isn't counted" : `${total.invalidLines} lines aren't counted`}: fix the
            price or quantity outlined in red.
          </p>
        )}
        <div className="gg-trade__sum">
          <span>TCG low total</span>
          <span>{formatCents(total.tcgLowCents)}</span>
        </div>
        {footer}
      </div>
    </section>
  );
}

function YourList({
  lines,
  locked,
  onAdd,
  onQuantity,
}: {
  lines: YourLine[];
  locked: boolean;
  onAdd: (item: InventoryItem) => void;
  onQuantity: (id: string, quantity: number) => void;
}) {
  const headingId = useId();
  // Cards no longer for sale don't count: they're listed only so they can be taken off.
  const total = pricedTotal(lines.filter((line) => !line.unavailable));
  return (
    <section className="gg-card gg-trade__list gg-trade__list--yours" aria-labelledby={headingId}>
      <header className="gg-trade__list-head">
        <h2 className="gg-trade__heading" id={headingId}>
          They want from you
        </h2>
        <span className="gg-trade__count">{cardCount(total.cards)}</span>
      </header>

      {!locked && <InventorySearch lines={lines} onAdd={onAdd} />}

      {lines.length === 0 ? (
        <p className="gg-muted gg-trade__empty">{locked ? "None." : "Search your inventory to add the cards they want."}</p>
      ) : (
        <ol className="gg-trade__yours">
          {lines.map((line) => (
            <li key={line.id} className={`gg-trade__your${line.unavailable ? " gg-trade__your--gone" : ""}`}>
              <InventoryCardImage item={line} size="xs" loadingPriority="lazy" className="gg-trade__your-img" />
              <div className="gg-trade__your-body">
                <span className="gg-trade__your-name">{line.cardName}</span>
                <span className="gg-trade__your-meta">{describeCard(line)}</span>
                {line.unavailable ? (
                  <span className="gg-trade__your-note gg-trade__your-note--problem">
                    {line.cardName} {line.unavailable}: take it off the trade.
                  </span>
                ) : (
                  line.dealPriceCents !== null && (
                    <span className="gg-trade__your-note">
                      On deal for {formatCents(line.dealPriceCents)}. Trades use the regular price.
                    </span>
                  )
                )}
              </div>
              <div className="gg-trade__your-qty">
                {locked || line.unavailable ? (
                  <span>× {line.quantity}</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="gg-icon-btn"
                      aria-label={`One fewer ${line.cardName}`}
                      onClick={() => onQuantity(line.id, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      className="gg-icon-btn"
                      aria-label={`One more ${line.cardName}`}
                      disabled={line.quantity >= line.stock}
                      onClick={() => onQuantity(line.id, line.quantity + 1)}
                    >
                      +
                    </button>
                  </>
                )}
              </div>
              <span className="gg-trade__your-price">
                {formatCents(line.priceCents * line.quantity)}
                {line.quantity > 1 && <small>{formatCents(line.priceCents)} each</small>}
              </span>
              {locked ? (
                <span />
              ) : (
                <button
                  type="button"
                  className="gg-icon-btn gg-trade__remove"
                  aria-label={`Remove ${line.cardName}`}
                  onClick={() => onQuantity(line.id, 0)}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="gg-trade__foot">
        <div className="gg-trade__sum">
          <span>Website price total</span>
          <span>{formatCents(total.cents)}</span>
        </div>
        <p className="gg-trade__note">Regular website prices: deal and sale prices don't apply to trades.</p>
      </div>
    </section>
  );
}

/** Finds cards the website is selling: active, priced and in stock. */
function InventorySearch({ lines, onAdd }: { lines: YourLine[]; onAdd: (item: InventoryItem) => void }) {
  const [term, setTerm] = useState("");
  // The last search's results, with the words searched for. null items: the search failed.
  const [found, setFound] = useState<{ query: string; items: InventoryItem[] | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const query = term.trim();

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      inventoryRepository.list({ search: query, stock: "in", status: "active", pageSize: 8 }).then(
        (page) => {
          if (!cancelled) setFound({ query, items: page.rows.filter((row) => fromInventory(row) !== null) });
        },
        () => {
          if (!cancelled) setFound({ query, items: null });
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, attempt]);

  // While a search runs, the last results stay up (dimmed) rather than flashing away.
  const current = found?.query === query ? found : null;
  const shown = current ?? (found?.items?.length ? found : null);

  return (
    <div className="gg-trade__search">
      <SearchInput
        label="Find a card in your inventory"
        placeholder="Find a card in your inventory…"
        autoComplete="off"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {query.length >= 2 && (
        <div className="gg-trade__hits" aria-busy={current === null || undefined}>
          {shown === null ? (
            <Spinner label="Searching" />
          ) : shown.items === null ? (
            <p className="gg-muted gg-trade__empty">
              Couldn't search inventory.{" "}
              <button
                type="button"
                className="gg-linkbutton"
                onClick={() => {
                  setFound(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </p>
          ) : shown.items.length === 0 ? (
            <p className="gg-muted gg-trade__empty">No cards for sale match “{shown.query}”.</p>
          ) : (
            <div className={`gg-pos__results${current === null ? " gg-trade__hits--stale" : ""}`}>
              {shown.items.map((item) => {
                const line = fromInventory(item);
                if (!line) return null;
                const onTrade = lines.find((l) => l.id === item.id)?.quantity ?? 0;
                return (
                  <button key={item.id} type="button" className="gg-pos__result" onClick={() => onAdd(item)}>
                    <InventoryCardImage item={item} size="xs" loadingPriority="lazy" />
                    <span className="gg-pos__result-body">
                      <span className="gg-pos__result-name">{item.cardName}</span>
                      <span className="gg-muted">
                        {describeCard(line)} · {item.quantity} in stock
                        {line.dealPriceCents !== null && ` · on deal for ${formatCents(line.dealPriceCents)}`}
                      </span>
                      {onTrade > 0 && <span className="gg-trade__hit-added">{onTrade} on the trade</span>}
                    </span>
                    <span className="gg-pos__result-price">{formatCents(line.priceCents)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeResult({ totals }: { totals: TradeTotals }) {
  const { outcome, balanceCents, makeEvenCents } = totals;
  return (
    <div className={`gg-trade__result gg-trade__result--${outcome}`} role="status">
      {outcome === "empty" && <p className="gg-trade__result-note">Add cards to see the trade.</p>}
      {outcome === "they_pay" && (
        <>
          <p className="gg-trade__result-label">They pay you</p>
          <p className="gg-trade__result-amount">{formatCents(-balanceCents)}</p>
          <p className="gg-trade__result-note">Or they trade in {formatCents(makeEvenCents)} more at TCG low to cover it.</p>
        </>
      )}
      {outcome === "credit_left" && (
        <>
          <p className="gg-trade__result-label">You owe them in trade credit</p>
          <p className="gg-trade__result-amount">{formatCents(balanceCents)}</p>
          <p className="gg-trade__result-note">Or they pick {formatCents(makeEvenCents)} more of your cards.</p>
        </>
      )}
      {outcome === "even" && (
        <>
          <p className="gg-trade__result-label">Even trade</p>
          <p className="gg-trade__result-amount">{formatCents(0)}</p>
          <p className="gg-trade__result-note">Their trade credit covers your cards exactly.</p>
        </>
      )}
    </div>
  );
}

/** After confirming: send the customer the link to the full breakdown. */
function SharePanel({
  trade,
  phone,
  email,
  emailing,
  onEmail,
  onTexted,
  onCopy,
}: {
  trade: StaffTradeView;
  phone: string;
  email: string;
  emailing: boolean;
  onEmail: (address: string) => void;
  onTexted: (phone: string) => void;
  onCopy: () => void;
}) {
  const canText = isTextablePhone(phone);
  const canEmail = isEmailAddress(email);
  return (
    <div className="gg-trade__share">
      <p className="gg-trade__share-title">Send them the full breakdown</p>
      <div className="gg-trade__share-actions">
        {canText ? (
          <a
            className="gg-btn gg-btn--primary gg-btn--md gg-trade__share-send"
            href={smsHref(phone, tradeLinkMessage(trade))}
            onClick={() => onTexted(phone)}
          >
            <Icon name="message" size={17} />
            <span>Text the link</span>
          </a>
        ) : (
          <Button variant="primary" icon="message" className="gg-trade__share-send" disabled>
            Text the link
          </Button>
        )}
        <Button
          variant={canText ? "secondary" : "primary"}
          icon="mail"
          className="gg-trade__share-send"
          loading={emailing}
          disabled={!canEmail}
          onClick={() => onEmail(email)}
        >
          Email the link
        </Button>
        <Button variant="secondary" icon="copy" onClick={onCopy}>
          Copy link
        </Button>
        <a className="gg-btn gg-btn--secondary gg-btn--md" href={trade.link} target="_blank" rel="noreferrer">
          <Icon name="external" size={17} />
          <span>Open</span>
        </a>
      </div>
      {!canText && !canEmail && <p className="gg-field__hint">Add their phone or email above to send it.</p>}
      {(trade.textedAt || trade.emailedAt) && (
        <ul className="gg-trade__sent">
          {trade.textedAt && (
            <li>
              Texted to {trade.textedTo}, {formatDateTime(trade.textedAt)}
            </li>
          )}
          {trade.emailedAt && (
            <li>
              Emailed to {trade.emailedTo}, {formatDateTime(trade.emailedAt)}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function balanceLabel(trade: StaffTradeView): string {
  if (trade.balanceCents < 0) return `They pay ${formatCents(-trade.balanceCents)}`;
  if (trade.balanceCents > 0) return `${formatCents(trade.balanceCents)} credit`;
  return "Even";
}

function sentLabel(trade: StaffTradeView): string {
  if (trade.textedAt && trade.emailedAt) return "Texted and emailed";
  if (trade.textedAt) return "Texted";
  if (trade.emailedAt) return "Emailed";
  return "Not sent yet";
}

function RecentTrades({
  trades,
  failed,
  emailing,
  onRetry,
  onEmail,
  onTexted,
  onCopy,
}: {
  trades: StaffTradeView[] | null;
  failed: boolean;
  emailing: string | null;
  onRetry: () => void;
  onEmail: (trade: StaffTradeView) => void;
  onTexted: (trade: StaffTradeView) => void;
  onCopy: (trade: StaffTradeView) => void;
}) {
  const headingId = useId();
  return (
    <section className="gg-card gg-trade__recent" aria-labelledby={headingId}>
      <h2 className="gg-trade__heading" id={headingId}>
        Recent trades
      </h2>
      {failed ? (
        <p className="gg-muted gg-trade__empty">
          Couldn't load recent trades.{" "}
          <button type="button" className="gg-linkbutton" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : trades === null ? (
        <Spinner label="Loading recent trades" />
      ) : trades.length === 0 ? (
        <p className="gg-muted gg-trade__empty">Trades you confirm show up here, with their links.</p>
      ) : (
        <ul className="gg-trade__recent-list">
          {trades.map((trade) => (
            <li key={trade.id} className="gg-trade__recent-row">
              <div className="gg-trade__recent-who">
                <span className="gg-trade__recent-name">
                  #{trade.tradeNumber} {trade.customerName}
                </span>
                <span className="gg-trade__recent-when">
                  {formatDateTime(trade.createdAt)} · {sentLabel(trade)}
                </span>
              </div>
              <span className="gg-trade__recent-balance">{balanceLabel(trade)}</span>
              <div className="gg-trade__recent-actions">
                {trade.customerPhone && isTextablePhone(trade.customerPhone) && (
                  <a
                    className="gg-btn gg-btn--ghost gg-btn--sm"
                    href={smsHref(trade.customerPhone, tradeLinkMessage(trade))}
                    onClick={() => onTexted(trade)}
                    aria-label={`Text trade #${trade.tradeNumber} to ${trade.customerName}`}
                  >
                    <span>Text</span>
                  </a>
                )}
                {trade.customerEmail && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={emailing === trade.id}
                    aria-label={`Email trade #${trade.tradeNumber} to ${trade.customerName}`}
                    onClick={() => onEmail(trade)}
                  >
                    Email
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Copy the link to trade #${trade.tradeNumber}`}
                  onClick={() => onCopy(trade)}
                >
                  Copy link
                </Button>
                <a
                  className="gg-btn gg-btn--ghost gg-btn--sm"
                  href={trade.link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open trade #${trade.tradeNumber}`}
                >
                  <span>Open</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
