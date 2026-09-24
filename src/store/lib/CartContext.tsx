import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../../supabase";
import { storefrontImageUrl } from "../../cards";
import { useAuth } from "./AuthContext";
import {
  readGuestCart,
  writeGuestCart,
  clearGuestCart,
  addLine as addGuestLine,
  setLineQuantity as setGuestLineQuantity,
  removeLine as removeGuestLine,
  planCartMerge,
  type GuestCartLine,
} from "./guestCart";

// Unified cart across guest (localStorage) and authenticated (Supabase) states.
// Every displayed line carries the item's CURRENT sellable stock so the UI can
// warn/clamp when availability changed while browsing. Stock is resolved via
// cart_item_availability (inventory_public, which already subtracts active
// reservations, plus the customer's own checkout hold).

export type CartLine = {
  inventoryItemId: string;
  quantity: number;
  name: string;
  setCode: string | null;
  setName: string | null;
  condition: string;
  finish: string;
  imageUrl: string | null;
  priceCents: number;
  /** Current sellable stock for this item (physical minus active reservations). */
  sellable: number;
  /** "Artist Proof", "Special Edition", a custom label, or null for a standard copy. */
  variantType: string | null;
};

type CartContextValue = {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  loading: boolean;
  error: string | null;
  /** True if any line was clamped/dropped on the last stock revalidation. */
  stockAdjusted: boolean;
  addItem: (inventoryItemId: string, qty?: number) => Promise<void>;
  setQuantity: (inventoryItemId: string, qty: number) => Promise<void>;
  removeItem: (inventoryItemId: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

type PublicRow = {
  id: string;
  card_name: string | null;
  set_code: string | null;
  set_name: string | null;
  condition: string | null;
  finish: string | null;
  image_url: string | null;
  price_cents: number | null;
  quantity: number | null; // sellable (view already subtracts reservations)
  variant_type: string | null;
};

/**
 * Fetch sellable stock + display fields for a set of inventory item ids.
 *
 * Uses cart_item_availability rather than inventory_public directly: same
 * rows and stock, except a signed-in customer's OWN checkout hold (cards
 * reserved while they're on the payment step) counts as available to them.
 * Without that, reloading during/after the payment step would see those
 * cards as sold out and prune them from the customer's own cart.
 */
async function fetchItemsByIds(ids: string[]): Promise<Map<string, PublicRow>> {
  const map = new Map<string, PublicRow>();
  if (!ids.length) return map;
  const { data, error } = await supabase.rpc("cart_item_availability", {
    p_ids: Array.from(new Set(ids)),
  });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as PublicRow[]) map.set(row.id, row);
  return map;
}

function buildLine(row: PublicRow, quantity: number): CartLine {
  const sellable = Math.max(0, row.quantity ?? 0);
  return {
    inventoryItemId: row.id,
    quantity: Math.min(quantity, sellable),
    name: row.card_name ?? "Unknown card",
    setCode: row.set_code ?? null,
    setName: row.set_name ?? null,
    condition: row.condition ?? "NM",
    finish: row.finish ?? "nonfoil",
    imageUrl: storefrontImageUrl(row.image_url ?? null),
    priceCents: row.price_cents ?? 0,
    sellable,
    variantType: row.variant_type || null,
  };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stockAdjusted, setStockAdjusted] = useState(false);
  const cartIdRef = useRef<string | null>(null);
  const mergedForUserRef = useRef<string | null>(null);

  // ---- Guest cart hydration (logged out) ------------------------------------
  const hydrateGuest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const guest = readGuestCart();
      if (!guest.length) {
        setLines([]);
        return;
      }
      const items = await fetchItemsByIds(guest.map((l) => l.inventoryItemId));
      let adjusted = false;
      const next: CartLine[] = [];
      for (const g of guest) {
        const row = items.get(g.inventoryItemId);
        if (!row || (row.quantity ?? 0) <= 0) {
          adjusted = true;
          continue;
        }
        const line = buildLine(row, g.quantity);
        if (line.quantity < g.quantity) adjusted = true;
        next.push(line);
      }
      setLines(next);
      setStockAdjusted(adjusted);
      // Persist the possibly-clamped guest cart back.
      writeGuestCart(
        next.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          quantity: l.quantity,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your cart.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Server cart hydration (logged in) ------------------------------------
  const hydrateServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: cartId, error: cartErr } = await supabase.rpc(
        "get_or_create_my_cart",
      );
      if (cartErr) throw new Error(cartErr.message);
      cartIdRef.current = cartId as string;

      const { data: ci, error: ciErr } = await supabase
        .from("cart_items")
        .select("inventory_item_id, quantity")
        .eq("cart_id", cartId as string);
      if (ciErr) throw new Error(ciErr.message);

      const rows = (ci ?? []) as {
        inventory_item_id: string;
        quantity: number;
      }[];
      const items = await fetchItemsByIds(rows.map((r) => r.inventory_item_id));
      let adjusted = false;
      const next: CartLine[] = [];
      for (const r of rows) {
        const row = items.get(r.inventory_item_id);
        if (!row || (row.quantity ?? 0) <= 0) {
          adjusted = true;
          // prune unavailable line from the server cart
          await supabase
            .from("cart_items")
            .delete()
            .eq("cart_id", cartId as string)
            .eq("inventory_item_id", r.inventory_item_id);
          continue;
        }
        const line = buildLine(row, r.quantity);
        if (line.quantity < r.quantity) {
          adjusted = true;
          await supabase
            .from("cart_items")
            .update({ quantity: line.quantity })
            .eq("cart_id", cartId as string)
            .eq("inventory_item_id", r.inventory_item_id);
        }
        next.push(line);
      }
      setLines(next);
      setStockAdjusted(adjusted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your cart.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Merge guest cart into server cart on sign-in -------------------------
  const mergeGuestCart = useCallback(async (cartId: string) => {
    const guest = readGuestCart();
    if (!guest.length) return;

    const { data: ci, error: readErr } = await supabase
      .from("cart_items")
      .select("inventory_item_id, quantity")
      .eq("cart_id", cartId);
    if (readErr) throw new Error(readErr.message);
    const serverQuantities: Record<string, number> = {};
    for (const r of (ci ?? []) as {
      inventory_item_id: string;
      quantity: number;
    }[]) {
      serverQuantities[r.inventory_item_id] = r.quantity;
    }

    const allIds = Array.from(
      new Set([
        ...guest.map((l) => l.inventoryItemId),
        ...Object.keys(serverQuantities),
      ]),
    );
    const items = await fetchItemsByIds(allIds);
    const sellableByItem: Record<string, number> = {};
    for (const id of allIds) {
      sellableByItem[id] = Math.max(0, items.get(id)?.quantity ?? 0);
    }

    // Every write below is checked and THROWS on failure (rather than being
    // silently ignored) so a partial/failed merge propagates to the caller's
    // try/catch, which deliberately skips both marking this user "merged"
    // and clearing the guest cart -- see the effect below. That way a
    // transient failure here just means the merge (and the guest cart) is
    // retried next time instead of the guest's pre-sign-in cart silently
    // vanishing.
    const plan = planCartMerge(guest, serverQuantities, sellableByItem);
    for (const entry of plan) {
      if (entry.desiredQuantity <= 0) {
        const { error } = await supabase
          .from("cart_items")
          .delete()
          .eq("cart_id", cartId)
          .eq("inventory_item_id", entry.inventoryItemId);
        if (error) throw new Error(error.message);
        continue;
      }
      // Upsert on the (cart_id, inventory_item_id) pair.
      const { error } = await supabase.from("cart_items").upsert(
        {
          cart_id: cartId,
          inventory_item_id: entry.inventoryItemId,
          quantity: entry.desiredQuantity,
        },
        { onConflict: "cart_id,inventory_item_id" },
      );
      if (error) throw new Error(error.message);
    }
    clearGuestCart();
  }, []);

  // Hydrate on auth state settle; merge once per signed-in user.
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    (async () => {
      if (user) {
        try {
          const { data: cartId } = await supabase.rpc("get_or_create_my_cart");
          if (cartId && mergedForUserRef.current !== user.id) {
            cartIdRef.current = cartId as string;
            await mergeGuestCart(cartId as string);
            mergedForUserRef.current = user.id;
          }
        } catch {
          /* merge failures shouldn't block cart load */
        }
        if (active) await hydrateServer();
      } else {
        mergedForUserRef.current = null;
        cartIdRef.current = null;
        if (active) await hydrateGuest();
      }
    })();
    return () => {
      active = false;
    };
  }, [user, authLoading, hydrateServer, hydrateGuest, mergeGuestCart]);

  // ---- Mutations ------------------------------------------------------------
  const persistGuest = useCallback((next: CartLine[]) => {
    writeGuestCart(
      next.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        quantity: l.quantity,
      })),
    );
  }, []);

  const addItem = useCallback(
    async (inventoryItemId: string, qty = 1) => {
      setError(null);
      const items = await fetchItemsByIds([inventoryItemId]);
      const row = items.get(inventoryItemId);
      if (!row || (row.quantity ?? 0) <= 0) {
        setError("That item just sold out.");
        return;
      }
      const sellable = Math.max(0, row.quantity ?? 0);
      if (user && cartIdRef.current) {
        // Read the CURRENT server-side quantity right before writing rather
        // than trusting the `lines` React state closure, which can be stale
        // (another tab, or a request already in flight) and would otherwise
        // let this upsert silently clobber a quantity it never saw.
        const { data: existing, error: readErr } = await supabase
          .from("cart_items")
          .select("quantity")
          .eq("cart_id", cartIdRef.current)
          .eq("inventory_item_id", inventoryItemId)
          .maybeSingle();
        if (readErr) {
          setError(readErr.message);
          return;
        }
        const current = existing?.quantity ?? 0;
        const nextQty = Math.min(sellable, current + qty);
        const { error } = await supabase.from("cart_items").upsert(
          {
            cart_id: cartIdRef.current,
            inventory_item_id: inventoryItemId,
            quantity: nextQty,
          },
          { onConflict: "cart_id,inventory_item_id" },
        );
        if (error) setError(error.message);
        await hydrateServer();
      } else {
        const guest = readGuestCart();
        const next = addGuestLine(guest, inventoryItemId, qty, sellable);
        writeGuestCart(next);
        await hydrateGuest();
      }
    },
    [user, hydrateServer, hydrateGuest],
  );

  const setQuantity = useCallback(
    async (inventoryItemId: string, qty: number) => {
      setError(null);
      if (user && cartIdRef.current) {
        if (qty <= 0) {
          const { error } = await supabase
            .from("cart_items")
            .delete()
            .eq("cart_id", cartIdRef.current)
            .eq("inventory_item_id", inventoryItemId);
          if (error) setError(error.message);
        } else {
          const items = await fetchItemsByIds([inventoryItemId]);
          const sellable = Math.max(0, items.get(inventoryItemId)?.quantity ?? 0);
          const clamped = Math.min(qty, sellable);
          if (clamped <= 0) {
            const { error } = await supabase
              .from("cart_items")
              .delete()
              .eq("cart_id", cartIdRef.current)
              .eq("inventory_item_id", inventoryItemId);
            if (error) setError(error.message);
          } else {
            const { error } = await supabase
              .from("cart_items")
              .update({ quantity: clamped })
              .eq("cart_id", cartIdRef.current)
              .eq("inventory_item_id", inventoryItemId);
            if (error) setError(error.message);
          }
        }
        await hydrateServer();
      } else {
        const guest = readGuestCart();
        const items = await fetchItemsByIds([inventoryItemId]);
        const sellable = Math.max(0, items.get(inventoryItemId)?.quantity ?? 0);
        const next = setGuestLineQuantity(guest, inventoryItemId, qty, sellable);
        writeGuestCart(next);
        await hydrateGuest();
      }
    },
    [user, hydrateServer, hydrateGuest],
  );

  const removeItem = useCallback(
    async (inventoryItemId: string) => {
      setError(null);
      if (user && cartIdRef.current) {
        const { error } = await supabase
          .from("cart_items")
          .delete()
          .eq("cart_id", cartIdRef.current)
          .eq("inventory_item_id", inventoryItemId);
        if (error) setError(error.message);
        await hydrateServer();
      } else {
        const next = removeGuestLine(readGuestCart(), inventoryItemId);
        writeGuestCart(next);
        await hydrateGuest();
      }
    },
    [user, hydrateServer, hydrateGuest],
  );

  const clear = useCallback(async () => {
    setError(null);
    if (user && cartIdRef.current) {
      const { error } = await supabase
        .from("cart_items")
        .delete()
        .eq("cart_id", cartIdRef.current);
      if (error) setError(error.message);
      await hydrateServer();
    } else {
      clearGuestCart();
      setLines([]);
    }
  }, [user, hydrateServer]);

  const refresh = useCallback(async () => {
    if (user) await hydrateServer();
    else await hydrateGuest();
  }, [user, hydrateServer, hydrateGuest]);

  // Keep guest storage in sync whenever lines change while logged out.
  useEffect(() => {
    if (!user && !loading) persistGuest(lines);
  }, [lines, user, loading, persistGuest]);

  const itemCount = useMemo(
    () => lines.reduce((n, l) => n + l.quantity, 0),
    [lines],
  );
  const subtotalCents = useMemo(
    () => lines.reduce((n, l) => n + l.priceCents * l.quantity, 0),
    [lines],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      itemCount,
      subtotalCents,
      loading,
      error,
      stockAdjusted,
      addItem,
      setQuantity,
      removeItem,
      clear,
      refresh,
    }),
    [
      lines,
      itemCount,
      subtotalCents,
      loading,
      error,
      stockAdjusted,
      addItem,
      setQuantity,
      removeItem,
      clear,
      refresh,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

export type { GuestCartLine };
