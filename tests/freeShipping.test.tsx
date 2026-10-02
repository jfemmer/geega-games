// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FreeShippingNote } from "../src/store/components/FreeShippingNote";
import { ShippingMethodPicker } from "../src/store/components/ShippingMethodPicker";

// What the customer sees about free shipping in the cart and at checkout.
// Orders with $75 or more of cards ship free and tracked, automatically (the
// server applies it; see tests/storefrontMoney.test.ts for the numbers).

afterEach(() => cleanup());

describe("free shipping note", () => {
  it("says how much more gets free shipping", () => {
    render(<FreeShippingNote subtotalCents={6000} />);
    expect(screen.getByText(/Add \$15\.00 more and your order ships free with tracking/)).toBeInTheDocument();
    expect(screen.getByText(/orders of \$75 or more/)).toBeInTheDocument();
  });

  it("says the order ships free once it qualifies", () => {
    render(<FreeShippingNote subtotalCents={7500} />);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Free tracked shipping.");
    expect(note).toHaveTextContent("Orders of $75 or more ship free with tracking, automatically.");
    expect(screen.queryByText(/Add \$/)).toBeNull();
  });
});

describe("shipping choice at checkout", () => {
  it("offers tracked and the envelope under $75, with their prices", () => {
    const onChange = vi.fn();
    render(<ShippingMethodPicker subtotalCents={7499} method="tracked" onChange={onChange} />);

    const tracked = screen.getByRole("radio", { name: "Tracked ($5.50)" });
    const envelope = screen.getByRole("radio", { name: "Plain White Envelope ($1.50, untracked)" });
    expect(tracked).toBeChecked();
    expect(envelope).not.toBeChecked();
    expect(screen.getByText(/Add \$0\.01 more and your order ships free with tracking/)).toBeInTheDocument();

    fireEvent.click(envelope);
    expect(onChange).toHaveBeenCalledWith("pwe");
  });

  it("has nothing to choose at $75 or more: free tracked shipping is applied", () => {
    render(<ShippingMethodPicker subtotalCents={7500} method="pwe" onChange={() => {}} />);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/Plain White Envelope/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Free tracked shipping.");
  });
});
