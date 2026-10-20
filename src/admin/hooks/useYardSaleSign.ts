import { useState } from "react";
import { useToast } from "./useToast";
import { yardSaleRepository } from "../repositories/yardSale.supabase";
import { yardSaleSignJob } from "../utils/yardSaleSign";
import type { FlyerJob } from "../components/partners/FlyerPrintView";

/**
 * Opening the printed yard sale sign (Yard Sale Mode and Marketing): loads a
 * hand of the most valuable newer cards at or above the sale's minimum, then
 * hands back the print job for FlyerPrintView. If the cards can't be loaded,
 * the sign still opens, with just the QR code.
 */
export function useYardSaleSign() {
  const toast = useToast();
  const [job, setJob] = useState<FlyerJob | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function open(terms: { minPriceCents: number; discountPercent: number }, extraLine: string | null = null) {
    setPreparing(true);
    let showcase: Awaited<ReturnType<typeof yardSaleRepository.showcase>> = [];
    try {
      showcase = await yardSaleRepository.showcase(terms.minPriceCents);
    } catch {
      toast.error("Couldn't load cards to feature, so the sign shows the QR code without them.");
    } finally {
      setPreparing(false);
    }
    setJob(yardSaleSignJob({ ...terms, showcase, extraLine }));
  }

  return { job, preparing, open, close: () => setJob(null) };
}
