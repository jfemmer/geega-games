import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../../supabase";
import { useAuth } from "./AuthContext";

// Cards a customer has saved for later, independent of the deck-builder's
// per-deck watches (customer_deck_cards) and stock-alert email subscriptions
// (card_stock_subscriptions) -- this is just a personal bookmark list, no
// email side effect. Sign-in required, no guest/localStorage variant: unlike
// the cart, a wishlist only has value if it persists across visits/devices.
//
// Loads the signed-in user's full set of wishlisted oracle_ids ONCE (not per
// card) so a page of 24 product cards can each check membership locally
// instead of firing a query per card.

type WishlistContextValue = {
  loaded: boolean;
  isWishlisted: (oracleId: string) => boolean;
  /** oracle_ids currently mid-toggle, so a button can disable itself and avoid a double-click race. */
  pending: Set<string>;
  toggle: (oracleId: string, cardName: string) => Promise<"ok" | "signin_required" | "error">;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    if (!user) {
      setIds(new Set());
      setLoaded(true);
      return;
    }
    setLoaded(false);
    supabase
      .from("customer_wishlist_items")
      .select("oracle_id")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("[Wishlist] failed to load", error);
          setIds(new Set());
        } else {
          setIds(new Set((data ?? []).map((r) => r.oracle_id as string)));
        }
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const isWishlisted = useCallback((oracleId: string) => ids.has(oracleId), [ids]);

  const toggle = useCallback(
    async (oracleId: string, cardName: string) => {
      if (!user) return "signin_required" as const;
      setPending((cur) => new Set(cur).add(oracleId));
      try {
        if (ids.has(oracleId)) {
          const { error } = await supabase
            .from("customer_wishlist_items")
            .delete()
            .eq("user_id", user.id)
            .eq("oracle_id", oracleId);
          if (error) {
            console.error("[Wishlist] remove failed", error);
            return "error" as const;
          }
          setIds((cur) => {
            const next = new Set(cur);
            next.delete(oracleId);
            return next;
          });
        } else {
          const { error } = await supabase
            .from("customer_wishlist_items")
            .insert({ user_id: user.id, oracle_id: oracleId, card_name: cardName });
          if (error) {
            console.error("[Wishlist] add failed", error);
            return "error" as const;
          }
          setIds((cur) => new Set(cur).add(oracleId));
        }
        return "ok" as const;
      } finally {
        setPending((cur) => {
          const next = new Set(cur);
          next.delete(oracleId);
          return next;
        });
      }
    },
    [user, ids],
  );

  const value = useMemo(
    () => ({ loaded, isWishlisted, pending, toggle }),
    [loaded, isWishlisted, pending, toggle],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
