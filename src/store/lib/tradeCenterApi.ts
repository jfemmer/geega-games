import { useSyncExternalStore } from "react";
import { supabase } from "../../supabase";
import {
  TRADE_CENTER_API,
  type CustomerTrade,
  type CustomerTradeSummary,
  type TradeOfferInput,
  type TradeShipToInput,
  type TradeTerms,
  type TradeWantedInput,
} from "./tradeCenter";

// The storefront's side of the Trade Center (/api/trade-center): the terms
// (shared by the header link, the Trade Cards page and card pages), My
// Trades, and every action on a trade. The signed-in customer's session
// token rides along; the server decides everything else.

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export class TradeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(init: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown }): Promise<T> {
  const token = await accessToken();
  const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
  let res: Response;
  try {
    res = await fetch(`${TRADE_CENTER_API}${qs}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "same-origin",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new TradeApiError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !body || body.ok === false) {
    throw new TradeApiError(body?.message || "Something went wrong. Please try again.", res.status);
  }
  return body;
}

// ---------------------------------------------------------------------------
// The terms, fetched once and shared (the header asks on every page)
// ---------------------------------------------------------------------------

let terms: TradeTerms | null = null;
let termsPromise: Promise<TradeTerms | null> | null = null;
const listeners = new Set<() => void>();

function publish(next: TradeTerms | null) {
  terms = next;
  for (const listener of listeners) listener();
}

/** The current terms; null when trading can't be reached. Cached for the session. */
export function loadTradeTerms(refresh = false): Promise<TradeTerms | null> {
  if (!termsPromise || refresh) {
    termsPromise = request<{ terms: TradeTerms }>({ method: "GET" })
      .then((body) => {
        publish(body.terms);
        return body.terms;
      })
      .catch(() => {
        termsPromise = null; // try again next time
        return null;
      });
  }
  return termsPromise;
}

/** Remembers terms that came back with a trade, so every view agrees. */
export function rememberTerms(next: TradeTerms): void {
  publish(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!termsPromise && typeof window !== "undefined") void loadTradeTerms();
  return () => listeners.delete(listener);
}

/** The terms, for components; null until they arrive (and in the prerendered page). */
export function useTradeTerms(): TradeTerms | null {
  return useSyncExternalStore(
    subscribe,
    () => terms,
    () => null,
  );
}

/** For tests: forget the cached terms. */
export function resetTradeTermsForTests(): void {
  terms = null;
  termsPromise = null;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export interface TradeResponse {
  terms: TradeTerms;
  trade: CustomerTrade;
}

function withTerms<T extends { terms: TradeTerms }>(body: T): T {
  rememberTerms(body.terms);
  return body;
}

export async function loadMyTrades(): Promise<{ terms: TradeTerms; trades: CustomerTradeSummary[] }> {
  return withTerms(await request<{ terms: TradeTerms; trades: CustomerTradeSummary[] }>({ method: "GET", query: { view: "mine" } }));
}

export async function loadTrade(id: string): Promise<TradeResponse> {
  return withTerms(await request<TradeResponse>({ method: "GET", query: { id } }));
}

async function act<T extends { terms: TradeTerms } = TradeResponse>(action: string, payload: Record<string, unknown>): Promise<T> {
  return withTerms(await request<T>({ method: "POST", body: { action, ...payload } }));
}

export type ConfirmResponse = TradeResponse & {
  /** With a deposit: the card payment to finish (Stripe's client secret). */
  clientSecret?: string;
  depositCents?: number;
  /** Something changed while confirming (a card sold): what to tell the customer. */
  notice?: string;
};

interface SignedUpload {
  fileName: string;
  path: string;
  token: string;
  signedUrl: string;
}

export interface TradeTrackingInput {
  carrier: string;
  trackingNumber: string;
  packagingConfirmed: boolean;
  shippedOn: string | null;
}

export const tradeActions = {
  start: (items: TradeWantedInput[]) => act("start", { items }),
  setWanted: (tradeId: string, items: TradeWantedInput[]) => act("setWanted", { tradeId, items }),
  saveOffer: (tradeId: string, cards: TradeOfferInput[]) => act("saveOffer", { tradeId, cards }),
  submit: (tradeId: string, note: string | null) => act("submit", { tradeId, note }),
  /** Confirm an approved trade, agreeing to the terms (version) shown. */
  confirm: (tradeId: string, termsVersion: number) => act<ConfirmResponse>("confirm", { tradeId, acknowledged: true, termsVersion }),
  confirmDeposit: (tradeId: string, paymentIntentId: string) =>
    act<TradeResponse & { paymentStatus?: string }>("confirmDeposit", { tradeId, paymentIntentId }),
  cancel: (tradeId: string, reason: string | null, acceptDepositReview = false) =>
    act("cancel", { tradeId, reason, acceptDepositReview }),
  withdraw: (tradeId: string, reason: string | null) => act("withdraw", { tradeId, reason }),
  askForTime: (tradeId: string, note: string) => act("askForTime", { tradeId, note }),
  /**
   * Their tracking number. A new number (first or replacement shipment) needs
   * their packaging confirmation; the ship date is optional ("YYYY-MM-DD").
   */
  tracking: (tradeId: string, shipment: TradeTrackingInput) => act("tracking", { tradeId, ...shipment }),
  /**
   * Proof of shipping: the files go straight to private storage through
   * signed links (nothing passes through our server), then the note is sent
   * with them.
   */
  async proof(tradeId: string, note: string, files: File[]): Promise<TradeResponse> {
    const draftId = crypto.randomUUID();
    if (files.length > 0) {
      const { uploads } = await request<{ uploads: SignedUpload[] }>({
        method: "POST",
        body: {
          action: "proofUploads",
          tradeId,
          draftId,
          files: files.map((f) => ({ fileName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size })),
        },
      });
      for (let i = 0; i < files.length; i += 1) {
        const target = uploads[i];
        if (!target?.signedUrl) throw new TradeApiError("A file didn't upload. Try again.", 0);
        let ok = false;
        try {
          const res = await fetch(target.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": files[i].type || "application/octet-stream" },
            body: files[i],
          });
          ok = res.ok;
        } catch {
          ok = false;
        }
        if (!ok) throw new TradeApiError(`${files[i].name} didn't upload. Check your connection and try again.`, 0);
      }
    }
    return act("proof", { tradeId, draftId, note });
  },
  accept: (tradeId: string, shipTo: { addressId: string } | { address: TradeShipToInput }) =>
    act<TradeResponse & { amountDueCents: number }>("accept", { tradeId, ...shipTo }),
  adjust: (tradeId: string, message: string) => act("adjust", { tradeId, message }),
  decline: (tradeId: string, reason: string | null) => act("decline", { tradeId, reason }),
  message: (tradeId: string, body: string) => act("message", { tradeId, body }),
  async pay(tradeId: string): Promise<{ clientSecret: string; amountDueCents: number } | { paid: true; trade: CustomerTrade }> {
    const body = await request<{ clientSecret?: string; amountDueCents?: number; paid?: boolean; trade?: CustomerTrade; terms?: TradeTerms }>({
      method: "POST",
      body: { action: "pay", tradeId },
    });
    if (body.terms) rememberTerms(body.terms);
    if (body.paid && body.trade) return { paid: true, trade: body.trade };
    return { clientSecret: body.clientSecret ?? "", amountDueCents: body.amountDueCents ?? 0 };
  },
  confirmPayment: (tradeId: string, paymentIntentId: string) =>
    act<TradeResponse & { paymentStatus?: string }>("confirmPayment", { tradeId, paymentIntentId }),
};
