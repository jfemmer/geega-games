// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LabelPrintView, type LabelPrintJob } from "../src/admin/components/orders/LabelPrintView";
import type { Order } from "../src/admin/types";

// One-click label printing: opening the view prints right away (after the
// label image loads, for postage), prints only the label at its real size,
// and closes itself once the print dialog is done.

const order = {
  id: "order-1",
  orderNumber: "#1A2B3C4D",
  customerName: "Jordan Vega",
  shipRecipient: "Jordan Vega",
  shipLine1: "123 Main St",
  shipLine2: "Apt 4",
  shipCity: "Ballwin",
  shipState: "MO",
  shipPostalCode: "63011",
  shipCountry: "US",
} as unknown as Order;

const printSpy = vi.fn();

beforeEach(() => {
  printSpy.mockReset();
  window.print = printSpy;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pageStyle(): string | null {
  return document.querySelector("style[data-gg-label-page]")?.textContent ?? null;
}

describe("LabelPrintView — Plain White Envelope", () => {
  it("prints the return address and the customer's address straight away", () => {
    const job: LabelPrintJob = { kind: "pwe", order, format: "label-4x6" };
    render(<LabelPrintView job={job} onClose={() => {}} />);

    expect(printSpy).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "Envelope label for #1A2B3C4D" });
    expect(dialog).toHaveTextContent("Geega Games");
    expect(dialog).toHaveTextContent("390 Newbury Dr.");
    expect(dialog).toHaveTextContent("Ballwin, MO 63011");
    expect(dialog).toHaveTextContent("Jordan Vega");
    expect(dialog).toHaveTextContent("123 Main St");
    expect(dialog).toHaveTextContent("Apt 4");
    expect(dialog).toHaveTextContent("Order #1A2B3C4D");
    // A 4×6 label page, printing only the label.
    expect(pageStyle()).toContain("size: 4in 6in");
    expect(document.body).toHaveClass("gg-printing-label");
    // Clipped to that one page, so a label printer never feeds a blank second label.
    expect(pageStyle()).toContain("height: 6in !important");
    expect(pageStyle()).toContain("overflow: hidden !important");
  });

  it("places the address for the label and sizes it to fit", () => {
    render(<LabelPrintView job={{ kind: "pwe", order, format: "label-4x6" }} onClose={() => {}} />);
    const address = screen.getByText("123 Main St").parentElement as HTMLElement;
    expect(address).toHaveClass("gg-label__to");
    expect(address.style).toMatchObject({ left: "1.2in", top: "1.4in", width: "4.5in", fontSize: "16pt" });
  });

  it("says how to set up a label printer", () => {
    render(<LabelPrintView job={{ kind: "pwe", order, format: "label-4x6" }} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Envelope label for #1A2B3C4D" });
    expect(dialog).toHaveTextContent("For a 4×6 label printer.");
    expect(dialog).toHaveTextContent("paper size 4×6 (or 100 × 150 mm), margins None and scale 100%");
  });

  it("sizes the page to a #10 envelope when that's the format", () => {
    render(<LabelPrintView job={{ kind: "pwe", order, format: "envelope-10" }} onClose={() => {}} />);
    expect(pageStyle()).toContain("size: 9.5in 4.125in");
    expect(pageStyle()).toContain("height: 4.125in !important");
    expect((screen.getByText("123 Main St").parentElement as HTMLElement).style).toMatchObject({
      left: "3.6in",
      fontSize: "14pt",
    });
  });

  it("cleans up after itself so other printing is unaffected", () => {
    const { unmount } = render(
      <LabelPrintView job={{ kind: "pwe", order, format: "label-4x6" }} onClose={() => {}} />,
    );
    unmount();
    expect(pageStyle()).toBeNull();
    expect(document.body).not.toHaveClass("gg-printing-label");
  });

  it("closes once the print dialog is done", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
    const onClose = vi.fn();
    render(<LabelPrintView job={{ kind: "pwe", order, format: "label-4x6" }} onClose={onClose} />);

    vi.setSystemTime(new Date("2026-09-30T20:00:05Z"));
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open when the dialog didn't block (so a phone can finish printing)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
    const onClose = vi.fn();
    render(<LabelPrintView job={{ kind: "pwe", order, format: "label-4x6" }} onClose={onClose} />);

    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LabelPrintView — postage label", () => {
  const job: LabelPrintJob = { kind: "postage", order, labelUrl: "https://easypost-files.example/label.png" };

  it("waits for the label image before printing", () => {
    render(<LabelPrintView job={job} onClose={() => {}} />);
    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();

    const img = screen.getByRole("img", { name: "Postage label for #1A2B3C4D" });
    Object.defineProperty(img, "naturalWidth", { value: 1200 });
    Object.defineProperty(img, "naturalHeight", { value: 1800 });
    fireEvent.load(img);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(img).not.toHaveClass("gg-label__img--landscape");
  });

  it("turns a sideways label image to fill the page", () => {
    render(<LabelPrintView job={job} onClose={() => {}} />);
    const img = screen.getByRole("img", { name: "Postage label for #1A2B3C4D" });
    Object.defineProperty(img, "naturalWidth", { value: 1800 });
    Object.defineProperty(img, "naturalHeight", { value: 1200 });
    fireEvent.load(img);
    expect(img).toHaveClass("gg-label__img--landscape");
  });

  it("offers the label file when the image won't load", () => {
    render(<LabelPrintView job={job} onClose={() => {}} />);
    fireEvent.error(screen.getByRole("img", { name: "Postage label for #1A2B3C4D" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load the label image");
    expect(screen.getByRole("link", { name: "Open the label file" })).toHaveAttribute(
      "href",
      "https://easypost-files.example/label.png",
    );
    expect(printSpy).not.toHaveBeenCalled();
  });
});
