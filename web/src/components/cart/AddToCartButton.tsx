'use client';

/**
 * AddToCartButton.tsx — PLACEHOLDER for Phase 4 (Cart).
 *
 * The real implementation will call a server action that validates stock and
 * writes to cart_items via RLS-protected queries (never trusting client price).
 * For now this renders the control and its disabled/out-of-stock states so the
 * card detail page is complete, but it does not yet mutate the cart.
 */
import { useState } from 'react';

export function AddToCartButton({
  inventoryItemId,
  maxQuantity,
}: {
  inventoryItemId: string;
  maxQuantity: number;
}) {
  const [added, setAdded] = useState(false);
  const outOfStock = maxQuantity <= 0;

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => {
        // Phase 4: call addToCart server action with inventoryItemId.
        void inventoryItemId;
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
      }}
      className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-neutral-300 sm:w-auto"
    >
      {outOfStock ? 'Out of stock' : added ? 'Added ✓' : 'Add to cart'}
    </button>
  );
}
