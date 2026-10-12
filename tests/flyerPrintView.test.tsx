// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FlyerPrintView, TEAR_OFF_STRIPS, type FlyerJob } from "../src/admin/components/partners/FlyerPrintView";
import { marketingPage } from "../src/admin/utils/marketing";

// Printable flyer and table sign (Marketing, and a referral partner's
// drawer): a preview with Print / Close that prints only the page, on US
// Letter, with the QR code for the tagged link and the plain address for
// typing in.

const printSpy = vi.fn();

beforeEach(() => {
  printSpy.mockReset();
  window.print = printSpy;
});

afterEach(() => cleanup());

function job(overrides: Partial<FlyerJob> = {}): FlyerJob {
  return {
    layout: "flyer",
    copy: marketingPage("hub").copy,
    url: "https://geega-games.com/sell-cards-and-games?utm_source=flyer&utm_medium=print",
    address: "geega-games.com/sell-cards-and-games",
    ...overrides,
  };
}

function pageStyle(): string | null {
  return document.querySelector("style[data-gg-flyer-page]")?.textContent ?? null;
}

describe("FlyerPrintView", () => {
  it("previews a flyer with the copy, a QR code, and tear-off strips with the address", () => {
    render(<FlyerPrintView job={job({ extraLine: "Find us at table 12 today" })} onClose={() => {}} />);
    screen.getByRole("dialog", { name: "Flyer preview" });
    const page = screen.getByTestId("flyer-page");
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent("Selling a card or video game collection?");
    expect(within(page).getByRole("img", { name: "QR code for geega-games.com/sell-cards-and-games" })).toBeInTheDocument();
    expect(page).toHaveTextContent("Scan for a free offer");
    expect(page).toHaveTextContent("Find us at table 12 today");
    expect(page).toHaveTextContent("may pay Geega Games a referral fee");
    const strips = page.querySelectorAll(".gg-flyer__strip");
    expect(strips).toHaveLength(TEAR_OFF_STRIPS);
    for (const strip of strips) {
      expect(strip).toHaveTextContent("Sell your collection");
      // Split between the site and the page, so it never breaks mid-word.
      const lines = [...strip.querySelectorAll(".gg-flyer__address > span")].map((l) => l.textContent);
      expect(lines).toEqual(["geega-games.com", "/sell-cards-and-games"]);
    }
    // Doesn't print by itself: the owner checks the preview first.
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("prints only the page, on US Letter, and cleans up after itself", () => {
    const { unmount } = render(<FlyerPrintView job={job()} onClose={() => {}} />);
    expect(document.body).toHaveClass("gg-printing-flyer");
    expect(pageStyle()).toContain("size: 8.5in 11in");
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body).not.toHaveClass("gg-printing-flyer");
    expect(pageStyle()).toBeNull();
  });

  it("previews a table sign with one big QR code and no tear-off strips", () => {
    render(<FlyerPrintView job={job({ layout: "sign" })} onClose={() => {}} />);
    screen.getByRole("dialog", { name: "Table sign preview" });
    const page = screen.getByTestId("sign-page");
    expect(page.querySelector(".gg-qr")).not.toBeNull();
    expect(page.querySelectorAll(".gg-flyer__strip")).toHaveLength(0);
  });

  it("closes with Close or Escape", () => {
    const onClose = vi.fn();
    render(<FlyerPrintView job={job()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
