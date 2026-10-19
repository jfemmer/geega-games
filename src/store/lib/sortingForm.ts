import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { SHIP_TO_COUNTRY, checkUsAddress } from "./usAddress";
import { SORTING_LIMITS, parseCardCount, sortingEstimateCents, type SortingDeliveryMethod } from "./sortingService";
import type { SortingOption } from "./sortingApi";

// State and checks behind the collection sorting calculator and request form
// (src/store/components/sorting): the customer's choices ("the plan") and
// the estimate they give, and the return address — saved addresses from the
// account's address book (public.addresses), or one typed in, checked with
// the same US-only rules as checkout. Kept out of the component files so
// those only export components.

export interface SortingPlan {
  optionId: string | null;
  /** What the customer typed, e.g. "5,000". */
  cardsInput: string;
  delivery: SortingDeliveryMethod | null;
}

export const EMPTY_SORTING_PLAN: SortingPlan = { optionId: null, cardsInput: "", delivery: null };

export interface SortingEstimate {
  option: SortingOption | null;
  cards: number | null;
  sortingCents: number | null;
}

/** The plan's option, its valid card count, and the sorting estimate (null until both are known). */
export function estimateFor(plan: SortingPlan, options: SortingOption[]): SortingEstimate {
  const option = options.find((o) => o.id === plan.optionId) ?? null;
  const parsed = parseCardCount(plan.cardsInput);
  const cards = parsed !== null && parsed >= 1 && parsed <= SORTING_LIMITS.maxEstimatedCards ? parsed : null;
  const sortingCents = option && cards ? sortingEstimateCents(option.ratePerThousandCents, cards) : null;
  return { option, cards, sortingCents };
}

export interface SavedAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

export interface AddressForm {
  recipient: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
}

export interface ReturnAddressState {
  /** A saved address id, or "new" for the form. */
  selected: string;
  form: AddressForm;
  /** Signed in: also save a typed address to the account's address book. */
  saveToBook: boolean;
}

export const EMPTY_RETURN_ADDRESS: ReturnAddressState = {
  selected: "new",
  form: { recipient: "", line1: "", line2: "", city: "", state: "", postal_code: "" },
  saveToBook: true,
};

/** The signed-in customer's saved addresses, default first (same order as checkout). */
export function useSavedAddresses(userId: string | null): { addresses: SavedAddress[]; loaded: boolean } {
  const [state, setState] = useState<{ addresses: SavedAddress[]; loaded: boolean; userId: string | null }>({
    addresses: [],
    loaded: false,
    userId: null,
  });
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("addresses")
      .select("id, label, recipient, line1, line2, city, state, postal_code, country, is_default")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({ addresses: error ? [] : ((data ?? []) as SavedAddress[]), loaded: true, userId });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (!userId) return { addresses: [], loaded: true };
  return state.userId === userId ? { addresses: state.addresses, loaded: state.loaded } : { addresses: [], loaded: false };
}

export type ReturnAddressResult =
  | { ok: true; savedId: string; address: null }
  | {
      ok: true;
      savedId: null;
      address: { recipient: string; line1: string; line2: string; city: string; state: string; postalCode: string };
    }
  | { ok: false; message: string };

/** Checks the chosen return address and gives what to send, or what to fix. */
export function checkReturnAddress(value: ReturnAddressState, saved: SavedAddress[]): ReturnAddressResult {
  if (value.selected !== "new") {
    const address = saved.find((a) => a.id === value.selected);
    if (!address) return { ok: false, message: "Choose a return address." };
    const check = checkUsAddress({ state: address.state, postalCode: address.postal_code, country: address.country });
    if (!check.ok) return { ok: false, message: `We can't ship back to that saved address. ${check.message}` };
    return { ok: true, savedId: address.id, address: null };
  }
  const f = value.form;
  if (!f.recipient.trim() || !f.line1.trim() || !f.city.trim() || !f.state || !f.postal_code.trim()) {
    return { ok: false, message: "Please enter the name and full address to ship your sorted collection back to." };
  }
  const check = checkUsAddress({ state: f.state, postalCode: f.postal_code, country: SHIP_TO_COUNTRY });
  if (!check.ok) return { ok: false, message: check.message };
  return {
    ok: true,
    savedId: null,
    address: {
      recipient: f.recipient.trim(),
      line1: f.line1.trim(),
      line2: f.line2.trim(),
      city: f.city.trim(),
      state: check.state,
      postalCode: check.postalCode,
    },
  };
}
