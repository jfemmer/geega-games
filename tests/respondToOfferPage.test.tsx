// @vitest-environment jsdom
//
// Component-level coverage for the public "respond to your offer" page:
// the manual lookup form, auto-submit from ?ref=&email= query params, the
// Accept/Decline-only vs. Accept/Decline/Counter branching driven by the
// lookup RPC's allow_counter flag, submitting a counter-offer, and the
// already-responded summary state. Only `fetch` and the Supabase client are
// mocked — everything else renders through the real <App/> tree, same
// convention as sellPage.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let offerLookupResponse: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    rpc: async (name: string) => {
      if (name === "sell_submission_offer_lookup") return offerLookupResponse;
      // StorewideSaleBanner's fire-and-forget call, present around every route.
      return { data: null, error: null };
    },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { default: App } = await import("../src/App");

function goTo(path: string) {
  window.history.pushState({}, "", path);
}

const OFFER_NOT_COUNTERABLE = {
  id: "sub-1",
  reference_number: "GG-S-100042",
  first_name: "Jordan",
  offer_value_cents: 35000,
  offer_sent_at: "2026-09-21T12:00:00Z",
  offer_response: null,
  counter_offer_cents: null,
  offer_responded_at: null,
  allow_counter: false,
};

const OFFER_COUNTERABLE = { ...OFFER_NOT_COUNTERABLE, allow_counter: true };

const OFFER_ALREADY_ACCEPTED = {
  ...OFFER_NOT_COUNTERABLE,
  offer_response: "accepted" as const,
  offer_responded_at: "2026-09-22T00:00:00Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
  offerLookupResponse = { data: null, error: null };
  goTo("/sell/offer");
});

afterEach(() => {
  cleanup();
});

describe("/sell/offer route", () => {
  it("shows the lookup form and a not-found message for a non-matching reference/email", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /respond to your offer/i }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/reference number/i), {
      target: { value: "GG-S-999999" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /find my offer/i }));

    expect(await screen.findByText(/couldn.t find an offer/i)).toBeInTheDocument();
  });

  it("auto-submits the lookup from ?ref=&email= and shows Accept/Decline without Counter when not eligible", async () => {
    offerLookupResponse = { data: OFFER_NOT_COUNTERABLE, error: null };
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    expect(await screen.findByText("$350.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept offer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /counter offer/i })).not.toBeInTheDocument();
  });

  it("shows a Counter option only when the lookup says this submission is eligible", async () => {
    offerLookupResponse = { data: OFFER_COUNTERABLE, error: null };
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    expect(await screen.findByRole("button", { name: /counter offer/i })).toBeInTheDocument();
  });

  it("accepting sends a two-step confirm and posts the response with the matched reference/email", async () => {
    offerLookupResponse = { data: OFFER_NOT_COUNTERABLE, error: null };
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/sell/respond-to-offer")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, response: "accepted" }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /accept offer/i }));
    fireEvent.click(await screen.findByRole("radio", { name: /via paypal/i }));
    fireEvent.click(await screen.findByRole("button", { name: /accept via paypal/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/sell/respond-to-offer"),
      );
      expect(call).toBeTruthy();
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        referenceNumber: "GG-S-100042",
        email: "jordan@example.com",
        response: "accepted",
        payoutMethod: "paypal",
      });
    });
    expect(await screen.findByText(/you accepted our offer/i)).toBeInTheDocument();
  });

  it("offers store credit worth 20% more, asking a signed-out seller to use an account", async () => {
    offerLookupResponse = { data: OFFER_NOT_COUNTERABLE, error: null };
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /accept offer/i }));
    const credit = await screen.findByRole("radio", { name: /in store credit/i });
    expect(credit).toBeChecked();
    expect(screen.getByText(/\+20%/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create a free account/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/signup?next="),
    );
    // No way to submit store credit without an account to hold it.
    expect(screen.queryByRole("button", { name: /accept as store credit/i })).toBeNull();
    const posted = fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sell/respond-to-offer"));
    expect(posted).toBe(false);
  });

  it("lets an eligible seller submit a counter-offer, converting dollars to cents", async () => {
    offerLookupResponse = { data: OFFER_COUNTERABLE, error: null };
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/sell/respond-to-offer")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, response: "countered" }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /counter offer/i }));
    fireEvent.change(screen.getByLabelText(/your counter-offer/i), {
      target: { value: "420" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit counter-offer/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/sell/respond-to-offer"),
      );
      expect(call).toBeTruthy();
      const init = call?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({
        referenceNumber: "GG-S-100042",
        email: "jordan@example.com",
        response: "countered",
        counterOfferCents: 42000,
      });
    });
    expect(await screen.findByText(/you countered our offer/i)).toBeInTheDocument();
  });

  it("shows an already-responded summary instead of action buttons when the offer was already answered", async () => {
    offerLookupResponse = { data: OFFER_ALREADY_ACCEPTED, error: null };
    goTo("/sell/offer?ref=GG-S-100042&email=jordan%40example.com");
    render(<App />);

    expect(await screen.findByText(/you accepted our offer/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept offer/i })).not.toBeInTheDocument();
  });
});
