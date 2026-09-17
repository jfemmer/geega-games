import { describe, expect, it } from "vitest";
import {
  CAPABILITY_ROLES,
  roleCan,
  STAFF_ROLES,
  type StaffCapability,
} from "../src/admin/permissions";

describe("roleCan", () => {
  it("lets every staff role view orders and inventory", () => {
    for (const role of STAFF_ROLES) {
      expect(roleCan(role, "orders.view")).toBe(true);
      expect(roleCan(role, "inventory.view")).toBe(true);
      expect(roleCan(role, "pos.sell")).toBe(true);
    }
  });

  it("restricts refunds and cancellations to owner/administrator", () => {
    expect(roleCan("owner", "orders.refund")).toBe(true);
    expect(roleCan("administrator", "orders.refund")).toBe(true);
    expect(roleCan("fulfillment", "orders.refund")).toBe(false);
    expect(roleCan("inventory", "orders.refund")).toBe(false);

    expect(roleCan("owner", "orders.cancel")).toBe(true);
    expect(roleCan("administrator", "orders.cancel")).toBe(true);
    expect(roleCan("fulfillment", "orders.cancel")).toBe(false);
    expect(roleCan("inventory", "orders.cancel")).toBe(false);
  });

  it("lets fulfillment pack/ship but not touch inventory", () => {
    expect(roleCan("fulfillment", "orders.pack_ship")).toBe(true);
    expect(roleCan("fulfillment", "inventory.write")).toBe(false);
  });

  it("lets inventory staff edit inventory but not pack/ship orders", () => {
    expect(roleCan("inventory", "inventory.write")).toBe(true);
    expect(roleCan("inventory", "orders.pack_ship")).toBe(false);
  });

  it("restricts staff management to owner alone", () => {
    expect(roleCan("owner", "staff.manage")).toBe(true);
    expect(roleCan("administrator", "staff.manage")).toBe(false);
    expect(roleCan("fulfillment", "staff.manage")).toBe(false);
    expect(roleCan("inventory", "staff.manage")).toBe(false);
  });

  it("gives owner every capability", () => {
    for (const capability of Object.keys(CAPABILITY_ROLES) as StaffCapability[]) {
      expect(roleCan("owner", capability)).toBe(true);
    }
  });
});
