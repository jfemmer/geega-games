// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";

// The admin Checkout Settings page: staff set the most different cards one
// online order may have, and see whether any customer's cart is over it.

const api = vi.hoisted(() => ({ adminFetch: vi.fn() }));
vi.mock("../src/admin/repositories/apiClient", () => ({ adminFetch: api.adminFetch }));

const { CheckoutSettingsPage } = await import("../src/admin/pages/CheckoutSettingsPage");

const view = (maxOrderLines: number, carts: { largestLines: number; overLimit: number } | null) => ({
  settings: { maxOrderLines, updatedAt: "2026-11-23T20:00:00.000Z" },
  carts,
});

const renderPage = () =>
  render(
    <ToastProvider>
      <CheckoutSettingsPage />
    </ToastProvider>,
  );
const field = () => screen.getByLabelText("Most different cards in one order") as HTMLInputElement;

beforeEach(() => {
  api.adminFetch.mockReset();
});
afterEach(cleanup);

describe("Checkout Settings", () => {
  it("is in the admin nav", () => {
    expect(NAV_ITEMS.some((n) => n.key === "checkout-settings")).toBe(true);
    expect(SECTION_TITLES["checkout-settings"]).toBe("Checkout Settings");
  });

  it("shows the limit and flags a customer stuck over it", async () => {
    api.adminFetch.mockResolvedValueOnce(view(100, { largestLines: 121, overLimit: 1 }));
    renderPage();
    expect(await screen.findByText("Orders can have up to 100 different cards.")).toBeTruthy();
    expect(field().value).toBe("100");
    expect(screen.getByText("1 cart is over the limit")).toBeTruthy();
    expect(screen.getByText(/check out until the limit is at least 121/)).toBeTruthy();
    expect(screen.getByText("121 different cards")).toBeTruthy();
    expect(api.adminFetch).toHaveBeenCalledWith("/api/admin/checkout-settings", { method: "GET" });
  });

  it("saves a new limit", async () => {
    const user = userEvent.setup();
    api.adminFetch.mockResolvedValueOnce(view(100, { largestLines: 121, overLimit: 1 }));
    api.adminFetch.mockResolvedValueOnce(view(500, { largestLines: 121, overLimit: 0 }));
    renderPage();
    await screen.findByText("Orders can have up to 100 different cards.");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing changed yet

    await user.clear(field());
    await user.type(field(), "500");
    await user.click(save);
    expect(api.adminFetch).toHaveBeenLastCalledWith("/api/admin/checkout-settings", {
      method: "PUT",
      body: { maxOrderLines: 500 },
    });
    expect(await screen.findByText("Orders can have up to 500 different cards.")).toBeTruthy();
    expect(screen.getByText("Every cart fits")).toBeTruthy();
    expect(screen.getByText("Orders can now have up to 500 different cards.")).toBeTruthy();
  });

  it("won't save a number outside 1 to 1,000", async () => {
    const user = userEvent.setup();
    api.adminFetch.mockResolvedValueOnce(view(500, { largestLines: 3, overLimit: 0 }));
    renderPage();
    await screen.findByText("Orders can have up to 500 different cards.");
    for (const bad of ["0", "1001", "2.5"]) {
      await user.clear(field());
      await user.type(field(), bad);
      expect(screen.getByText("Enter a whole number from 1 to 1,000.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    }
    expect(api.adminFetch).toHaveBeenCalledTimes(1);
  });
});
