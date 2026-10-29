import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Consigned cards are never discounted. 20261029120000_consignment_sales.sql
// switched every function and view that prices inventory to the
// ownership-aware storefront_effective_*(price, original, is_deal, ownership).
// A later migration that redefines one of them from an older copy would bring
// back the three-argument call and quietly put consigned cards on sale, so no
// migration after it may price an inventory row without its ownership.

const dir = new URL("../supabase/migrations/", import.meta.url);
const PHASE4 = "20261029120000_consignment_sales.sql";
const THREE_ARG = /storefront_effective_(price|original_price|discount_percent)\(\s*(\w+\.)?price_cents\s*,\s*(\w+\.)?original_price_cents\s*,\s*(\w+\.)?is_deal\s*\)/;

describe("consigned cards stay undiscounted", () => {
  it("no migration after Phase 4 prices inventory without ownership", () => {
    const later = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f > PHASE4)
      .filter((f) => THREE_ARG.test(readFileSync(new URL(f, dir), "utf8")));
    expect(later).toEqual([]);
  });

  it("Phase 4 itself checks that nothing was missed", () => {
    const sql = readFileSync(new URL(PHASE4, dir), "utf8");
    expect(sql).toContain("still price inventory without ownership");
    expect(sql).toMatch(/elsif p_shipping_method = 'tracked' or v_has_consigned then/);
  });
});
