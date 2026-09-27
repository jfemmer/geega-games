// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReferralLinksCard } from "../src/admin/components/leads/ReferralLinksCard";
import { ToastProvider } from "../src/admin/components/ui/ToastProvider";
import { REFERRAL_PAGES } from "../src/seo/referralPages";

// Partner Leads → "Referral links": the public Pokémon / One Piece / video
// game pages, with Copy and (where the device has one) Share.

function renderCard() {
  return render(
    <ToastProvider>
      <ReferralLinksCard />
    </ToastProvider>,
  );
}

/** Gives jsdom a share sheet; jsdom has none, like desktop Firefox. */
function stubShare(impl: (data: ShareData) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
  return share;
}

afterEach(() => {
  cleanup();
  delete (navigator as { share?: unknown }).share;
});

describe("ReferralLinksCard", () => {
  it("lists every referral page at its live geega-games.com address", () => {
    renderCard();
    expect(REFERRAL_PAGES.length).toBeGreaterThan(0);
    for (const page of REFERRAL_PAGES) {
      const link = screen.getByRole("link", { name: `geega-games.com${page.path}` });
      expect(link).toHaveAttribute("href", `https://geega-games.com${page.path}`);
      expect(link).toHaveAttribute("target", "_blank");
    }
    expect(screen.getByText("Pokémon cards")).toBeInTheDocument();
    expect(screen.getByText("One Piece cards")).toBeInTheDocument();
    expect(screen.getByText("Video games & consoles")).toBeInTheDocument();
  });

  it("copies the full address", async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText("untouched");
    renderCard();
    await user.click(screen.getByRole("button", { name: "Copy the Pokémon cards link" }));
    expect(await navigator.clipboard.readText()).toBe("https://geega-games.com/sell-pokemon-cards");
    expect(await screen.findByText("Pokémon cards link copied.")).toBeInTheDocument();
  });

  it("offers Share only on devices with a share sheet", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /^Share the/ })).toBeNull();
    cleanup();

    stubShare(async () => {});
    renderCard();
    expect(screen.getAllByRole("button", { name: /^Share the/ })).toHaveLength(REFERRAL_PAGES.length);
  });

  it("opens the share sheet with the page's title and address", async () => {
    const share = stubShare(async () => {});
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Share the One Piece cards link" }));
    expect(share).toHaveBeenCalledWith({
      title: "Sell your One Piece cards in St. Louis",
      url: "https://geega-games.com/sell-one-piece-cards",
    });
  });

  it("does nothing when the share sheet is closed without sharing", async () => {
    stubShare(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const user = userEvent.setup();
    await navigator.clipboard.writeText("untouched");
    renderCard();
    await user.click(screen.getByRole("button", { name: "Share the Video games & consoles link" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });

  it("copies the address instead when sharing isn't allowed", async () => {
    stubShare(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const user = userEvent.setup();
    await navigator.clipboard.writeText("untouched");
    renderCard();
    await user.click(screen.getByRole("button", { name: "Share the Video games & consoles link" }));
    expect(await navigator.clipboard.readText()).toBe("https://geega-games.com/sell-video-games");
    expect(await screen.findByText("Video games & consoles link copied.")).toBeInTheDocument();
  });
});
