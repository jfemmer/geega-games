// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useReveal } from "../src/store/lib/useReveal";

// useReveal brings a message into view when it appears far from the button
// that caused it (an error at the top of a long form, on a phone). jsdom has
// no layout and no scrollIntoView, so the tests supply one and check when,
// and on what, it is called.

function Form() {
  const [error, setError] = useState<string | null>(null);
  const [ref, reveal] = useReveal<HTMLParagraphElement>();
  return (
    <div>
      {error && (
        <p ref={ref} role="alert">
          {error}
        </p>
      )}
      <button
        onClick={() => {
          setError("Please enter a 5-digit ZIP code.");
          reveal();
        }}
      >
        Save
      </button>
      <button onClick={() => setError(null)}>Fix it</button>
    </div>
  );
}

const scrollIntoView = vi.fn();
const proto = Element.prototype as unknown as { scrollIntoView?: unknown };

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  scrollIntoView.mockReset();
  proto.scrollIntoView = scrollIntoView;
  reducedMotion(false);
});

afterEach(() => {
  cleanup();
  delete proto.scrollIntoView;
});

describe("useReveal", () => {
  it("does nothing until it is asked", () => {
    render(<Form />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls the message into view once it is on the page", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // The message itself, centered so the sticky header can't cover it.
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("alert"));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("shows it again when a second try fails the same way", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("doesn't scroll when the message goes away", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Fix it" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("jumps instead of gliding for people who ask for less motion", () => {
    reducedMotion(true);
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("is harmless where the browser can't scroll to an element", () => {
    delete proto.scrollIntoView;
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a 5-digit ZIP code.");
  });
});
