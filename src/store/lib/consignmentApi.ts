// Loading the payout estimator's rates (consignment_estimator_settings()) and
// turning the database's JSON into consignmentMath's EstimateSettings.
//
// The parser is strict: a channel or schedule with a missing or malformed
// field is left out rather than estimated with a made-up number, and the
// estimator says that channel has no rates yet.

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { parseEstimatorConfig, type EstimatorConfig } from "./consignmentConfig";
import type { AgreementTerms, AcknowledgmentKey, ChannelAnswers } from "./consignmentAgreement";
import type { ConsignmentChannel } from "./consignmentMath";

export { parseEstimatorConfig, type EstimatorConfig } from "./consignmentConfig";

export async function fetchEstimatorConfig(): Promise<EstimatorConfig | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.rpc("consignment_estimator_settings");
  if (error) throw new Error("Could not load the current consignment rates.");
  return parseEstimatorConfig(data);
}

export type EstimatorConfigState =
  | { status: "loading" }
  | { status: "ready"; config: EstimatorConfig }
  | { status: "error"; message: string };

/** The current rates for the estimator. `reloadKey` refetches (e.g. after settings change). */
export function useEstimatorConfig(reloadKey: unknown = 0): EstimatorConfigState {
  const [state, setState] = useState<EstimatorConfigState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchEstimatorConfig()
      .then((config) => {
        if (cancelled) return;
        setState(
          config
            ? { status: "ready", config }
            : { status: "error", message: "Consignment rates haven't been set up yet." },
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "Could not load rates." });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  return state;
}

// ---------------------------------------------------------------- the consignor's side


export const CONSIGN_SIGN_PATH = "/consign/sign";
const CONSIGN_API = "/api/consignments";

export class ConsignmentApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function bearer(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function call<T>(init: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown }): Promise<T> {
  const token = await bearer();
  const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
  let res: Response;
  try {
    res = await fetch(`${CONSIGN_API}${qs}`, {
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
    throw new ConsignmentApiError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !body || body.ok === false) {
    throw new ConsignmentApiError(body?.message || "Something went wrong. Please try again.", res.status);
  }
  return body;
}

export type InviteView =
  | { status: "signed"; consignmentLabel: string; signedAt: string; agreementId: string }
  | {
      status: "pending";
      agreementId: string;
      consignmentLabel: string;
      consignorName: string;
      versionNumber: number | null;
      title: string;
      renderedMd: string;
      agreementSha256: string;
      terms: AgreementTerms;
      expiresAt: string;
    };

export function loadInvite(token: string): Promise<InviteView> {
  return call<InviteView>({ method: "GET", query: { view: "invite", t: token } });
}

export interface SignInput {
  t: string;
  agreementSha256: string;
  acknowledgments: Partial<Record<AcknowledgmentKey, boolean>>;
  channels: ChannelAnswers;
  additionalInsurance: boolean | null;
  legalName: string;
  typedSignature: string;
}

export function signAgreement(input: SignInput): Promise<{ ok: true; agreementId: string; pdfReady: boolean }> {
  return call({ method: "POST", body: { action: "sign", ...input } });
}

/** Open the signed PDF (a short-lived link) in a new tab. */
export async function signedAgreementUrl(agreementId: string): Promise<string> {
  const { url } = await call<{ url: string }>({ method: "GET", query: { view: "pdf", agreement: agreementId } });
  return url;
}

export interface MyAgreement {
  id: string;
  status: "pending" | "signed";
  versionNumber: number;
  invitedAt: string;
  expiresAt: string;
  signedAt: string | null;
  agreementSha256: string;
  hasPdf: boolean;
  pdfSha256: string | null;
  terms: AgreementTerms;
}

export interface MyConsignment {
  id: string;
  consignmentNumber: number;
  status: "draft" | "awaiting_signature" | "signed" | "inventory_received" | "active" | "terminated" | "closed";
  signedAt: string | null;
  termStartedAt: string | null;
  initialTermDays: number;
  elections: { channels: Partial<Record<ConsignmentChannel, boolean>>; additionalInsurance: boolean | null };
  agreements: MyAgreement[];
  /** What we received and how inspection went. Older responses may omit it. */
  cards?: MyConsignedCard[];
  sales?: MyConsignmentSale[];
  payouts?: MyConsignmentPayout[];
}

export interface MyConsignmentSale {
  id: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  channel: ConsignmentChannel;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  soldAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** When the buyer's inspection period ends and the sale can be paid. */
  payableAt: string | null;
  status: "open" | "settled" | "paid" | "cancelled";
  cancelReason: string | null;
  /** Final figures, once the sale is settled. */
  settlement: {
    marketplaceFeeCents: number;
    processingFeeCents: number;
    postageCents: number;
    insuranceCents: number;
    otherExpenseCents: number;
    otherExpenseNote: string | null;
    netSaleCents: number;
    commissionRateBps: number;
    commissionCents: number;
    payoutCents: number;
    settledAt: string;
  } | null;
  payoutId: string | null;
}

export interface MyConsignmentPayout {
  id: string;
  amountCents: number;
  saleCount: number;
  method: string;
  paidAt: string;
  reference: string | null;
  voided: boolean;
}

export interface MyConsignedCard {
  id: string;
  cardName: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  finish: string;
  imageUrl: string | null;
  status: "submitted" | "received" | "under_inspection" | "accepted" | "rejected" | "listed" | "reserved_for_sale" | "sold" | "returned";
  quantitySubmitted: number | null;
  quantityAccepted: number;
  quantityRejected: number;
  declaredCondition: string | null;
  condition: string | null;
  /** Only once accepted. */
  listPriceCents: number | null;
  minPriceCents: number | null;
  rejectionReason: string | null;
  receivedAt: string | null;
}

export async function loadMyConsignments(): Promise<MyConsignment[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("my_consignments");
  if (error) throw new ConsignmentApiError("Could not load your consignments.", 500);
  return Array.isArray(data) ? (data as unknown as MyConsignment[]) : [];
}
