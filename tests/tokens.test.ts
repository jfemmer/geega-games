import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.EMAIL_TOKEN_SECRET = "test-secret-do-not-use-in-prod";
});

const { normalizeEmail } = await import("../api/_lib/tokens.js");
const { generateToken, hashToken, safeEqualHex } = await import(
  "../api/_lib/tokens.js"
);

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Customer@Example.COM ")).toBe(
      "customer@example.com",
    );
  });

  it("treats different-case addresses as identical", () => {
    expect(normalizeEmail("Customer@Example.com")).toBe(
      normalizeEmail("customer@example.com"),
    );
  });

  it("rejects invalid addresses", () => {
    for (const bad of [
      "",
      "   ",
      "no-at-sign",
      "missing@domain",
      "@nolocal.com",
      "spaces in@email.com",
      "trailing@dot.",
      123 as unknown as string,
      null as unknown as string,
    ]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("rejects over-long addresses", () => {
    const long = "a".repeat(250) + "@x.com";
    expect(normalizeEmail(long)).toBeNull();
  });

  it("accepts a normal address", () => {
    expect(normalizeEmail("jane.doe+tag@sub.example.co")).toBe(
      "jane.doe+tag@sub.example.co",
    );
  });
});

describe("tokens", () => {
  it("generates high-entropy url-safe tokens", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(20);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateToken()).not.toBe(t);
  });

  it("hash is deterministic for same token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("hash differs for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("does not store the raw token in its hash", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it("safeEqualHex compares correctly and constant-length-safely", () => {
    const h = hashToken("same");
    expect(safeEqualHex(h, hashToken("same"))).toBe(true);
    expect(safeEqualHex(h, hashToken("different"))).toBe(false);
    expect(safeEqualHex(h, "ab")).toBe(false); // length mismatch
  });
});
