// @vitest-environment jsdom
//
// Component-level coverage for the storefront Sell Your Cards flow: the
// route renders, a card can be found via the public search and added to the
// running list, quantities can be changed, a card can be removed, the
// contact step validates before letting the seller continue, and a full
// submission reaches the success screen with the server's reference number.
// Only `fetch` and the Supabase client are mocked — everything else renders
// through the real <App/> tree, same convention as storefrontSearch.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { default: App } = await import("../src/App");

function goTo(path: string) {
  window.history.pushState({}, "", path);
}

const SAMPLE_PRINTING = {
  scryfallId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  cardName: "Lightning Bolt",
  setName: "Magic 2010",
  setCode: "M10",
  collectorNumber: "146",
  rarity: "common",
  imageUrl: "https://img.example/bolt.jpg",
  availableFinishes: ["nonfoil"],
  treatments: [],
  scryfallPriceCents: 50,
  releasedAt: "2019-01-25",
};

const OLD_PRINTING = {
  scryfallId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  cardName: "Black Lotus",
  setName: "Limited Edition Alpha",
  setCode: "LEA",
  collectorNumber: "232",
  rarity: "rare",
  imageUrl: "https://img.example/lotus.jpg",
  availableFinishes: ["nonfoil"],
  treatments: [],
  scryfallPriceCents: 5_000_000,
  releasedAt: "1993-08-05",
};

function mockFetch({ submitOk = true }: { submitOk?: boolean } = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/sell/scryfall-search")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [SAMPLE_PRINTING], totalCards: 1, hasMore: false, page: 1 }),
      } as Response);
    }
    if (url.includes("/api/sell/submit")) {
      return Promise.resolve({
        ok: submitOk,
        json: async () =>
          submitOk
            ? { ok: true, referenceNumber: "GG-S-100099" }
            : { ok: false, message: "Something went wrong. Please try again." },
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

async function addSampleCard(container: HTMLElement) {
  const searchBox = await screen.findByLabelText(/search for a card/i);
  fireEvent.change(searchBox, { target: { value: "Lightning Bolt" } });
  await waitFor(() => {
    expect(container.querySelector(".gg-sellsearch__results")).toBeTruthy();
  });
  const resultButton = container.querySelector(".gg-sellsearch__result") as HTMLElement;
  fireEvent.click(resultButton);
  await waitFor(() => {
    expect(container.querySelector(".gg-sellcards")?.textContent).toContain("Lightning Bolt");
  });
}

function mockOldCardFetch() {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/sell/scryfall-search")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [OLD_PRINTING], totalCards: 1, hasMore: false, page: 1 }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

async function addOldCard(container: HTMLElement) {
  const searchBox = await screen.findByLabelText(/search for a card/i);
  fireEvent.change(searchBox, { target: { value: "Black Lotus" } });
  await waitFor(() => {
    expect(container.querySelector(".gg-sellsearch__results")).toBeTruthy();
  });
  const resultButton = container.querySelector(".gg-sellsearch__result") as HTMLElement;
  fireEvent.click(resultButton);
  await waitFor(() => {
    expect(container.querySelector(".gg-sellcards")?.textContent).toContain("Black Lotus");
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  goTo("/sell");
});

afterEach(() => {
  cleanup();
});

describe("/sell route", () => {
  it("renders the Sell Your Cards hero", async () => {
    mockFetch();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /sell your magic cards/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not automatically constitute an offer/i)).toBeInTheDocument();
  });
});

describe("adding and editing cards", () => {
  it("adds a card via search and shows it with a default quantity of 1", async () => {
    mockFetch();
    const { container } = render(<App />);
    await addSampleCard(container);
    const qtyInput = container.querySelector(
      ".gg-sellcard-row__fields input[type='number']",
    ) as HTMLInputElement;
    expect(qtyInput.value).toBe("1");
  });

  it("changes a card's quantity", async () => {
    mockFetch();
    const { container } = render(<App />);
    await addSampleCard(container);
    const qtyInput = container.querySelector(
      ".gg-sellcard-row__fields input[type='number']",
    ) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "4" } });
    expect(qtyInput.value).toBe("4");
  });

  it("removes a card from the list", async () => {
    mockFetch();
    const { container } = render(<App />);
    await addSampleCard(container);
    const removeBtn = screen.getByRole("button", { name: /remove lightning bolt/i });
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(container.querySelector(".gg-sellcards")).toBeNull();
    });
  });
});

describe("age-based condition defaults for manually-added cards", () => {
  it("defaults a card from 2005 or earlier to Heavily Played and explains why", async () => {
    mockOldCardFetch();
    const { container } = render(<App />);
    await addOldCard(container);
    const conditionSelect = container.querySelectorAll(
      ".gg-sellcard-row__fields select",
    )[0] as HTMLSelectElement;
    expect(conditionSelect.value).toBe("HP");
    expect(screen.getByText(/2005 or earlier/i)).toBeInTheDocument();
  });

  it("asks for photos when a manually-added card is marked Near Mint", async () => {
    mockOldCardFetch();
    const { container } = render(<App />);
    await addOldCard(container);
    const conditionSelect = container.querySelectorAll(
      ".gg-sellcard-row__fields select",
    )[0] as HTMLSelectElement;
    fireEvent.change(conditionSelect, { target: { value: "NM" } });
    expect(
      await screen.findByText(/include a clear photo of this card/i),
    ).toBeInTheDocument();
  });

  it("defaults a recent card to Lightly Played with no extra explanation needed", async () => {
    mockFetch();
    const { container } = render(<App />);
    await addSampleCard(container);
    const conditionSelect = container.querySelectorAll(
      ".gg-sellcard-row__fields select",
    )[0] as HTMLSelectElement;
    expect(conditionSelect.value).toBe("LP");
    expect(screen.queryByText(/2005 or earlier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2006–2015/i)).not.toBeInTheDocument();
  });
});

describe("contact step validation", () => {
  it("blocks continuing past the contact step without a name and valid email", async () => {
    mockFetch();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /start your submission/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^continue$/i })); // collection details -> contact
    await screen.findByText(/your contact information/i);

    fireEvent.click(screen.getByRole("button", { name: /^continue$/i })); // attempt to leave contact step empty
    expect(
      await screen.findByText(/enter your first name, last name, and a valid email/i),
    ).toBeInTheDocument();
    // Still on the contact step, not the review step.
    expect(screen.queryByRole("heading", { name: /review & submit/i })).not.toBeInTheDocument();
  });
});

describe("full submission", () => {
  it("walks all four steps and shows the success screen with the server's reference number", async () => {
    mockFetch();
    const { container } = render(<App />);

    // Step 1: add a card, then start the submission.
    await addSampleCard(container);
    fireEvent.click(screen.getByRole("button", { name: /start your submission/i }));

    // Step 2: collection details — nothing required, just continue.
    await screen.findByText(/tell us about the collection/i);
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Step 3: contact info.
    await screen.findByText(/your contact information/i);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Vega" } });
    fireEvent.change(screen.getByLabelText(/^email$/i, { selector: "input[type='email']" }), { target: { value: "jordan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Step 4: review & submit.
    await screen.findByRole("heading", { name: /review & submit/i });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /submit my collection/i }));

    await waitFor(() => {
      expect(screen.getByText("GG-S-100099")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /we received your collection/i })).toBeInTheDocument();

    const submitCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/sell/submit"));
    expect(submitCall).toBeTruthy();
    const sentBody = JSON.parse((submitCall![1] as RequestInit).body as string);
    expect(sentBody.contact.firstName).toBe("Jordan");
    expect(sentBody.cards).toHaveLength(1);
    expect(sentBody.agreedToTerms).toBe(true);
  });

  it("shows a server error and keeps the seller's entered data intact on failure", async () => {
    mockFetch({ submitOk: false });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /start your submission/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    await screen.findByText(/your contact information/i);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Vega" } });
    fireEvent.change(screen.getByLabelText(/^email$/i, { selector: "input[type='email']" }), { target: { value: "jordan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByRole("heading", { name: /review & submit/i });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /submit my collection/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    // The form did NOT reset to the success screen — the seller's info is
    // still right there on the review screen to retry with, not lost.
    expect(screen.getByText(/Jordan Vega/)).toBeInTheDocument();
  });
});
