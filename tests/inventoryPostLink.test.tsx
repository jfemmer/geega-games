// @vitest-environment jsdom
//
// Inventory's "Copy Facebook post link": select the cards in a post, copy one
// link that lands on exactly those cards (src/store/lib/postLinks.ts).
// Renders the real InventoryPage on the admin's mock repositories.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../src/supabase", () => ({ isSupabaseConfigured: false, supabase: {} }));
vi.mock("../src/admin/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/repositories")>();
  const mock = await import("../src/admin/repositories/mock");
  return {
    ...actual,
    inventoryRepository: mock.mockInventoryRepository,
    reservationRepository: mock.mockReservationRepository,
    userRepository: mock.mockUserRepository,
  };
});
vi.mock("../src/admin/repositories/photoRequests.supabase", () => ({
  photoRequestsRepository: { openCount: async () => 0 },
}));

const { InventoryPage } = await import("../src/admin/pages/InventoryPage");
const { ToastProvider } = await import("../src/admin/components/ui/ToastProvider");
const { readPickSlugs } = await import("../src/store/lib/postLinks");
const { slugifyCardName } = await import("../src/store/lib/cardSlug");

afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

async function renderInventory() {
  render(
    <ToastProvider>
      <InventoryPage query={new URLSearchParams()} onNavigate={() => {}} />
    </ToastProvider>,
  );
  return screen.findAllByRole("checkbox", { name: "Select row" }, { timeout: 3000 });
}

describe("Copy Facebook post link", () => {
  it("copies one link for the selected cards and says how to use it", async () => {
    // After userEvent.setup(), which installs its own clipboard.
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const boxes = await renderInventory();
    const picked = boxes.slice(0, 3);
    for (const box of picked) await user.click(box);

    const bar = screen.getByRole("region", { name: "Bulk actions" });
    await user.click(within(bar).getByRole("button", { name: "Copy Facebook post link" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const link = new URL(writeText.mock.calls[0][0] as string);
    expect(link.origin).toBe("https://geega-games.com");
    expect(link.searchParams.get("utm_source")).toBe("facebook");
    expect(link.searchParams.get("utm_medium")).toBe("social");

    // The link names exactly the selected rows' cards.
    const rowSlugs = picked.map((box) => slugifyCardName(box.closest("tr")!.textContent ?? ""));
    const slugs = link.pathname === "/shop/picks" ? readPickSlugs(link.searchParams.get("c")) : [link.pathname.replace("/shop/card/", "")];
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(rowSlugs.some((row) => row.includes(slug))).toBe(true);
    for (const row of rowSlugs) expect(slugs.some((slug) => row.includes(slug))).toBe(true);

    expect(await screen.findByText(new RegExp(`Link copied for ${slugs.length} card`))).toBeInTheDocument();
    expect(screen.getByText(/Paste it into your Facebook post/)).toBeInTheDocument();
  });

  it("shows the link to copy by hand when the clipboard is blocked", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("blocked"))) },
    });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const boxes = await renderInventory();
    await user.click(boxes[0]);
    await user.click(screen.getByRole("button", { name: "Copy Facebook post link" }));
    expect(prompt).toHaveBeenCalledWith("Copy this link for your Facebook post:", expect.stringMatching(/^https:\/\/geega-games\.com\/shop\//));
    prompt.mockRestore();
  });
});
