// @vitest-environment jsdom
//
// "Share" on a card's page (src/store/components/ShareButton.tsx): the
// phone's share sheet where there is one, otherwise the link is copied.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { default: ShareButton } = await import("../src/store/components/ShareButton");

const URL_ = "https://geega-games.com/shop/card/lightning-bolt";

function setNavigator(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).share;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe("ShareButton", () => {
  it("opens the share sheet with the card's page", async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    setNavigator({ share, clipboard: { writeText } });
    render(<ShareButton title="Lightning Bolt" url={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Share Lightning Bolt" }));
    expect(share).toHaveBeenCalledWith({ title: "Lightning Bolt", url: URL_ });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does nothing more when the share sheet is closed", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const writeText = vi.fn(async () => {});
    setNavigator({ share, clipboard: { writeText } });
    render(<ShareButton title="Lightning Bolt" url={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Share Lightning Bolt" }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("copies the link where there's no share sheet, and says so for a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(async () => {});
    setNavigator({ clipboard: { writeText } });
    render(<ShareButton title="Lightning Bolt" url={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Share Lightning Bolt" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText("Link copied")).toBeNull();
  });

  it("falls back to copying when sharing fails for another reason", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const writeText = vi.fn(async () => {});
    setNavigator({ share, clipboard: { writeText } });
    render(<ShareButton title="Lightning Bolt" url={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Share Lightning Bolt" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("shows the link to copy by hand when the clipboard is blocked", async () => {
    setNavigator({ clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("blocked"))) } });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<ShareButton title="Lightning Bolt" url={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Share Lightning Bolt" }));
    expect(prompt).toHaveBeenCalledWith("Copy this link:", URL_);
  });
});
