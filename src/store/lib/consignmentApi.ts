// Loading the payout estimator's rates (consignment_estimator_settings()) and
// turning the database's JSON into consignmentMath's EstimateSettings.
//
// The parser is strict: a channel or schedule with a missing or malformed
// field is left out rather than estimated with a made-up number, and the
// estimator says that channel has no rates yet.

import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import {
  CONSIGNMENT_CHANNELS,
  type BuyerTerms,
  type ChannelFeeSchedule,
  type CommissionTier,
  type ConsignmentChannel,
  type EstimateSettings,
  type FeeBase,
  type InsuranceBracket,
  type InsuranceSchedule,
} from "./consignmentMath";

export interface EstimatorConfig extends EstimateSettings {
  asOf: string;
  /** When each schedule took effect, for the "Rates as of" line. */
  effectiveFrom: {
    channels: Partial<Record<ConsignmentChannel, string>>;
    insurance: string | null;
    commission: string | null;
  };
  insuranceService: string;
  insuranceSourceUrl: string | null;
  estimatorInsuranceDefault: boolean;
  inspectionDays: number;
  initialTermDays: number;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const intOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : int(v) ?? undefined);
const FEE_BASES: readonly FeeBase[] = ["item", "item_shipping", "item_shipping_tax"];
const feeBase = (v: unknown): FeeBase | null => (FEE_BASES.includes(v as FeeBase) ? (v as FeeBase) : null);

function parseChannel(channel: ConsignmentChannel, raw: unknown): ChannelFeeSchedule | null {
  if (!isObj(raw)) return null;
  const marketplaceBps = int(raw.marketplaceBps);
  const threshold = intOrNull(raw.marketplaceThresholdCents);
  const above = intOrNull(raw.marketplaceAboveThresholdBps);
  const marketplaceBase = feeBase(raw.marketplaceBase);
  const perOrderCents = int(raw.perOrderCents);
  const small = intOrNull(raw.perOrderSmallCents);
  const smallMax = intOrNull(raw.perOrderSmallMaxCents);
  const processingBps = int(raw.processingBps);
  const processingFixedCents = int(raw.processingFixedCents);
  const processingBase = feeBase(raw.processingBase);
  if (
    marketplaceBps == null || threshold === undefined || above === undefined || !marketplaceBase || perOrderCents == null ||
    small === undefined || smallMax === undefined || processingBps == null || processingFixedCents == null || !processingBase
  ) {
    return null;
  }
  return {
    channel,
    marketplaceBps,
    marketplaceThresholdCents: threshold,
    marketplaceAboveThresholdBps: above,
    marketplaceBase,
    perOrderCents,
    perOrderSmallCents: small,
    perOrderSmallMaxCents: smallMax,
    processingBps,
    processingFixedCents,
    processingBase,
  };
}

function parseInsurance(raw: unknown): InsuranceSchedule | null {
  if (!isObj(raw) || !Array.isArray(raw.brackets)) return null;
  const brackets: InsuranceBracket[] = [];
  for (const b of raw.brackets) {
    if (!isObj(b)) return null;
    const maxValueCents = int(b.maxValueCents);
    const premiumCents = int(b.premiumCents);
    if (maxValueCents == null || premiumCents == null) return null;
    brackets.push({ maxValueCents, premiumCents });
  }
  const includedCoverageCents = int(raw.includedCoverageCents);
  const stepCents = int(raw.stepCents);
  const stepPremiumCents = int(raw.stepPremiumCents);
  const maxInsurableCents = int(raw.maxInsurableCents);
  if (includedCoverageCents == null || stepCents == null || stepPremiumCents == null || maxInsurableCents == null) return null;
  return { includedCoverageCents, brackets, stepCents, stepPremiumCents, maxInsurableCents };
}

function parseTiers(raw: unknown): CommissionTier[] | null {
  if (!isObj(raw) || !Array.isArray(raw.tiers) || raw.tiers.length === 0) return null;
  const tiers: CommissionTier[] = [];
  for (const t of raw.tiers) {
    if (!isObj(t)) return null;
    const rateBps = int(t.rateBps);
    const maxPriceCents = intOrNull(t.maxPriceCents);
    if (rateBps == null || maxPriceCents === undefined) return null;
    tiers.push({ maxPriceCents, rateBps });
  }
  return tiers;
}

function parseBuyerTerms(raw: unknown): Partial<Record<ConsignmentChannel, BuyerTerms>> {
  const out: Partial<Record<ConsignmentChannel, BuyerTerms>> = {};
  if (!isObj(raw)) return out;
  for (const channel of CONSIGNMENT_CHANNELS) {
    const t = raw[channel];
    if (!isObj(t)) continue;
    const shippingCents = int(t.shippingCents);
    const freeShippingAtCents = intOrNull(t.freeShippingAtCents);
    const salesTaxBps = int(t.salesTaxBps);
    if (shippingCents == null || freeShippingAtCents === undefined || salesTaxBps == null) continue;
    out[channel] = { shippingCents, freeShippingAtCents, salesTaxBps };
  }
  return out;
}

/**
 * The estimator's configuration from consignment_estimator_settings(), or
 * null when the commission tiers or insurance schedule are missing (without
 * them no estimate can be honest).
 */
export function parseEstimatorConfig(raw: unknown): EstimatorConfig | null {
  if (!isObj(raw)) return null;
  const commissionTiers = parseTiers(raw.commission);
  const insurance = parseInsurance(raw.insurance);
  const settings = isObj(raw.settings) ? raw.settings : null;
  const defaultPostageCents = settings ? int(settings.defaultPostageCents) : null;
  if (!commissionTiers || !insurance || !settings || defaultPostageCents == null) return null;

  const channels: Partial<Record<ConsignmentChannel, ChannelFeeSchedule>> = {};
  const channelDates: Partial<Record<ConsignmentChannel, string>> = {};
  const rawChannels = isObj(raw.channels) ? raw.channels : {};
  for (const channel of CONSIGNMENT_CHANNELS) {
    const parsed = parseChannel(channel, rawChannels[channel]);
    if (!parsed) continue;
    channels[channel] = parsed;
    const effective = (rawChannels[channel] as Json).effectiveFrom;
    if (typeof effective === "string") channelDates[channel] = effective;
  }
  const insuranceRaw = raw.insurance as Json;
  const commissionRaw = raw.commission as Json;
  return {
    asOf: typeof raw.asOf === "string" ? raw.asOf : new Date().toISOString(),
    commissionTiers,
    channels,
    insurance,
    defaultPostageCents,
    buyerTerms: parseBuyerTerms(settings.buyerTerms),
    effectiveFrom: {
      channels: channelDates,
      insurance: typeof insuranceRaw.effectiveFrom === "string" ? insuranceRaw.effectiveFrom : null,
      commission: typeof commissionRaw.effectiveFrom === "string" ? commissionRaw.effectiveFrom : null,
    },
    insuranceService: typeof insuranceRaw.service === "string" ? insuranceRaw.service : "USPS Ground Advantage",
    insuranceSourceUrl: typeof insuranceRaw.sourceUrl === "string" ? insuranceRaw.sourceUrl : null,
    estimatorInsuranceDefault: settings.estimatorInsuranceDefault === true,
    inspectionDays: int(settings.inspectionDays) ?? 3,
    initialTermDays: int(settings.initialTermDays) ?? 90,
  };
}

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
