// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PhotoRequestForm from "../src/store/components/PhotoRequestForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ITEM = "11111111-2222-3333-4444-555555555555";

function renderForm(defaultEmail: string | null = null) {
  return render(
    <PhotoRequestForm
      inventoryItemId={ITEM}
      listingLabel="Commander Masters #395 · Near Mint"
      cardPath="/shop/card/sol-ring"
      defaultEmail={defaultEmail}
      onClose={() => undefined}
    />,
  );
}

describe("PhotoRequestForm", () => {
  it("prefills a signed-in shopper's email", () => {
    renderForm("sam@example.com");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("sam@example.com");
  });

  it("asks for a name and email before sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/first name and a valid email/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the listing id and shows the 24-hour promise", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, referenceNumber: "GG-P-1001" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/first name/i), "Sam");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "sam@example.com");
    await user.type(screen.getByLabelText(/anything specific/i), "back corners");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/photo-requests");
    expect(JSON.parse(init.body)).toMatchObject({
      inventoryItemId: ITEM,
      firstName: "Sam",
      email: "sam@example.com",
      note: "back corners",
      cardPath: "/shop/card/sol-ring",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/within 24 hours/);
    expect(screen.getByText(/GG-P-1001/)).toBeInTheDocument();
  });
});
