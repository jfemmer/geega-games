import { describe, expect, it, vi } from "vitest";
import { logAdminAction } from "../api/_lib/auditLog";
import type { StaffContext } from "../api/_lib/adminAuth";

const staff: StaffContext = {
  userId: "staff-1",
  email: "owner@example.com",
  role: "admin",
  staffRole: "owner",
};

function fakeClient(insertResult: { error: { message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as never, insert, from };
}

describe("logAdminAction", () => {
  it("inserts a row shaped from the staff context and entry", async () => {
    const { client, insert, from } = fakeClient({ error: null });

    await logAdminAction(client, staff, {
      action: "order.cancel",
      resourceType: "order",
      resourceId: "order-123",
      before: { status: "paid" },
      after: { status: "cancelled" },
    });

    expect(from).toHaveBeenCalledWith("admin_audit_log");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "staff-1",
        actor_email: "owner@example.com",
        actor_role: "owner",
        action: "order.cancel",
        resource_type: "order",
        resource_id: "order-123",
        before: { status: "paid" },
        after: { status: "cancelled" },
      }),
    );
  });

  it("never throws when the insert fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient({ error: { message: "boom" } });

    await expect(
      logAdminAction(client, staff, {
        action: "inventory.edit",
        resourceType: "inventory_item",
      }),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });

  it("never throws when the client itself throws synchronously", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = {
      from: () => {
        throw new Error("connection lost");
      },
    } as never;

    await expect(
      logAdminAction(client, staff, {
        action: "staff.update",
        resourceType: "staff",
      }),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });
});
