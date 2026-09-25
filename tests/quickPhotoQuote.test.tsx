// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const { default: QuickPhotoQuote } = await import("../src/store/components/QuickPhotoQuote");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/anything we should know/i), "Two binders from the 2000s");
  await user.type(screen.getByLabelText("First name"), "Jordan");
  await user.type(screen.getByLabelText("Last name"), "Vega");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "jordan@example.com");
}

describe("QuickPhotoQuote", () => {
  it("won't send anything until the seller confirms they can sell the items", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Get my offer" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/own or are authorized/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs photos or a description", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.click(screen.getByRole("button", { name: "Get my offer" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/photos or a short description/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a normal sell submission tagged quick_quote and shows the reference number", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, referenceNumber: "GG-S-100042" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote defaultHandoff="local" />);
    expect(screen.getByLabelText("Meet up or ship?")).toHaveValue("local");
    await fillRequired(user);
    await user.click(screen.getByRole("checkbox", { name: /i confirm that i own/i }));
    await user.click(screen.getByRole("button", { name: "Get my offer" }));

    expect(await screen.findByText("GG-S-100042")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/sell/submit");
    expect(JSON.parse(init.body)).toMatchObject({
      source: "quick_quote",
      agreedToTerms: true,
      cards: [],
      photos: [],
      contact: {
        firstName: "Jordan",
        lastName: "Vega",
        email: "jordan@example.com",
        preferredContactMethod: "email",
        transactionPreference: "local",
      },
      collection: { notes: "Two binders from the 2000s" },
    });
  });
});
