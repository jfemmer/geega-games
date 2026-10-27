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

type User = ReturnType<typeof userEvent.setup>;

async function fillContact(user: User) {
  await user.type(screen.getByLabelText("First name"), "Jordan");
  await user.type(screen.getByLabelText("Last name"), "Vega");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "jordan@example.com");
}

describe("QuickPhotoQuote", () => {
  it("asks what they're selling first, before any personal details", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);

    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What are you selling?" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /what do you have/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Binders or a collection" })).not.toBeChecked();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    // Nobody is assumed to want a meetup or shipping unless the page says so.
    expect(screen.getByRole("radio", { name: "Not sure yet" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/what kind of cards you have, or add a short note/i);
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("moves to step 2 with a recap of the answers, and Change keeps them", async () => {
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.click(screen.getByRole("checkbox", { name: "Binders or a collection" }));
    await user.click(screen.getByRole("checkbox", { name: "Commander or other decks" }));
    await user.click(screen.getByRole("radio", { name: "1,000–5,000 cards" }));
    await user.type(screen.getByLabelText(/anything we should know/i), "Mostly 2010s");
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Where should we send your offer?" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Binders or a collection, Commander or other decks, 1,000–5,000 cards, plus your note")).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("heading", { name: "What are you selling?" })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Binders or a collection" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Commander or other decks" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "1,000–5,000 cards" })).toBeChecked();
    expect(screen.getByLabelText(/anything we should know/i)).toHaveValue("Mostly 2010s");

    // Unticking a type works too.
    await user.click(screen.getByRole("checkbox", { name: "Commander or other decks" }));
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    expect(screen.getByText("Binders or a collection, 1,000–5,000 cards, plus your note")).toBeInTheDocument();
  });

  it("takes a note on its own as the answer to step 1", async () => {
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.type(screen.getByLabelText(/anything we should know/i), "A shoebox of old cards from my uncle");
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    expect(screen.getByText("“A shoebox of old cards from my uncle”")).toBeInTheDocument();
  });

  it("won't send anything until the seller confirms they can sell the items", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.click(screen.getByRole("checkbox", { name: "Bulk (boxes of commons)" }));
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    await fillContact(user);
    await user.click(screen.getByRole("button", { name: "Get my free offer" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/own or are authorized/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a name and a valid email before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.click(screen.getByRole("checkbox", { name: "Sealed product" }));
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    await user.type(screen.getByLabelText("First name"), "Jordan");
    await user.type(screen.getByLabelText("Last name"), "Vega");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "jordan@");
    await user.click(screen.getByRole("checkbox", { name: /i confirm that i own/i }));
    await user.click(screen.getByRole("button", { name: "Get my free offer" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a normal sell submission tagged quick_quote with what they picked, and shows the reference number", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, referenceNumber: "GG-S-100042" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote defaultHandoff="local" />);
    expect(screen.getByRole("radio", { name: "Meet up in person" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Binders or a collection" }));
    await user.click(screen.getByRole("radio", { name: "1,000–5,000 cards" }));
    await user.type(screen.getByLabelText(/anything we should know/i), "Two binders from the 2000s");
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    expect(screen.getByText("Binders or a collection, 1,000–5,000 cards, Meet up in person, plus your note")).toBeInTheDocument();

    await fillContact(user);
    await user.click(screen.getByRole("checkbox", { name: /i confirm that i own/i }));
    await user.click(screen.getByRole("button", { name: "Get my free offer" }));

    expect(await screen.findByText("GG-S-100042")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/sell/submit");
    expect(JSON.parse(init.body)).toMatchObject({
      source: "quick_quote",
      agreedToTerms: true,
      partnerConsent: false,
      cards: [],
      photos: [],
      contact: {
        firstName: "Jordan",
        lastName: "Vega",
        email: "jordan@example.com",
        preferredContactMethod: "email",
        transactionPreference: "local",
      },
      collection: {
        collectionTypes: ["binder_collection"],
        collectionSize: "1000_to_5000",
        notes: "Two binders from the 2000s",
      },
    });
  });

  it("shows the server's message when the submission fails, and keeps what was typed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, message: "Too many submissions. Please try again later." }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<QuickPhotoQuote />);
    await user.click(screen.getByRole("checkbox", { name: "A few valuable cards" }));
    await user.click(screen.getByRole("button", { name: /next: where to send your offer/i }));
    await fillContact(user);
    await user.click(screen.getByRole("checkbox", { name: /i confirm that i own/i }));
    await user.click(screen.getByRole("button", { name: "Get my free offer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many submissions. Please try again later.");
    expect(screen.getByLabelText("First name")).toHaveValue("Jordan");
    expect(screen.getByRole("button", { name: "Get my free offer" })).toBeEnabled();
  });
});
