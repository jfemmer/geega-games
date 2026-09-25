import { describe, it, expect, beforeAll } from "vitest";
import { parseClaimParam } from "../src/store/lib/guestClaims";
import { normalizeOrderNumber } from "../src/store/pages/TrackOrderPage";

beforeAll(() => {
  process.env.EMAIL_TOKEN_SECRET = "test-secret-for-guest-tokens";
});

const ORDER = "7c02a1e1-d133-492a-be4f-f41b239a9e4f";
const OTHER = "ea70e19f-37cb-478d-a168-e0bf752d13d2";

describe("guest record tokens", () => {
  it("verifies a token only for the exact kind and id it was issued for", async () => {
    const { signGuestToken, verifyGuestToken } = await import("../api/_lib/guestAccess.ts");
    const token = signGuestToken("order", ORDER);
    expect(verifyGuestToken("order", ORDER, token)).toBe(true);
    expect(verifyGuestToken("order", ORDER.toUpperCase(), token)).toBe(true);
    expect(verifyGuestToken("order", OTHER, token)).toBe(false);
    expect(verifyGuestToken("sell", ORDER, token)).toBe(false);
  });

  it("rejects tampered, malformed or missing tokens", async () => {
    const { signGuestToken, verifyGuestToken } = await import("../api/_lib/guestAccess.ts");
    const token = signGuestToken("order", ORDER);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(verifyGuestToken("order", ORDER, tampered)).toBe(false);
    expect(verifyGuestToken("order", ORDER, "short")).toBe(false);
    expect(verifyGuestToken("order", ORDER, undefined)).toBe(false);
    expect(verifyGuestToken("order", "not-a-uuid", token)).toBe(false);
  });

  it("produces claim links the storefront can parse back", async () => {
    const { claimParam, verifyGuestToken } = await import("../api/_lib/guestAccess.ts");
    const claim = parseClaimParam(claimParam("sell", ORDER));
    expect(claim).toMatchObject({ kind: "sell", id: ORDER });
    expect(verifyGuestToken("sell", claim!.id, claim!.token)).toBe(true);
    expect(parseClaimParam("order.bad.value")).toBeNull();
    expect(parseClaimParam(null)).toBeNull();
  });
});

describe("track-order number normalizing", () => {
  it("accepts the site (#) and email (GG-) formats", () => {
    expect(normalizeOrderNumber("#AB12CD34")).toBe("AB12CD34");
    expect(normalizeOrderNumber(" GG-AB12CD34 ")).toBe("AB12CD34");
    expect(normalizeOrderNumber("gg-ab12cd34")).toBe("ab12cd34");
    expect(normalizeOrderNumber("AB12CD34")).toBe("AB12CD34");
  });
});
