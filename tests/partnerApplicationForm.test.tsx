// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PartnerApplicationForm from "../src/store/components/PartnerApplicationForm";
import { PARTNER_CATEGORIES } from "../src/store/lib/partnerTypes";

// The applications on /for-stores and /referral-partners: checked in the
// browser before sending, sent with where the applicant came from, and a
// thank-you once saved.

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(response: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ ok: response.ok, json: async () => response.body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillCommon(user: ReturnType<typeof userEvent.setup>, kind: "store" | "referrer") {
  await user.type(screen.getByLabelText(kind === "store" ? "Store name" : "Business name"), "Gateway Games");
  await user.type(screen.getByLabelText("Your name"), "Pat Lee");
  await user.type(screen.getByLabelText("Email"), "pat@gateway.example");
  await user.type(screen.getByLabelText("City"), "Kirkwood");
  await user.selectOptions(screen.getByLabelText("State"), "MO");
}

describe("PartnerApplicationForm — stores", () => {
  it("offers exactly the categories we send leads for", () => {
    render(<PartnerApplicationForm kind="store" />);
    for (const c of PARTNER_CATEGORIES) expect(screen.getByRole("checkbox", { name: c.label })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Yu-Gi-Oh|Lorcana|Sports/i })).toBeNull();
  });

  it("asks what the store buys, then for the standards, before sending anything", async () => {
    const fetchMock = stubFetch({ ok: true, body: { ok: true } });
    const user = userEvent.setup();
    render(<PartnerApplicationForm kind="store" />);
    await fillCommon(user, "store");
    await user.click(screen.getByRole("button", { name: "Apply to be a partner store" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please choose what your store buys.");
    await user.click(screen.getByRole("checkbox", { name: "Pokémon cards" }));
    await user.click(screen.getByRole("button", { name: "Apply to be a partner store" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/partner standards/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the application with where they came from, and thanks them", async () => {
    // They arrived from a card-show QR code earlier.
    localStorage.setItem(
      "gg.attribution.v1",
      JSON.stringify({
        utmSource: "card_show",
        utmMedium: "qr",
        utmCampaign: null,
        ref: null,
        landingPath: "/for-stores",
        referrerHost: null,
        at: Date.now(),
      }),
    );
    const fetchMock = stubFetch({ ok: true, body: { ok: true } });
    const user = userEvent.setup();
    render(<PartnerApplicationForm kind="store" />);
    await fillCommon(user, "store");
    await user.click(screen.getByRole("checkbox", { name: "Pokémon cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Video games & consoles" }));
    await user.click(screen.getByRole("checkbox", { name: /buy by mail/i }));
    await user.click(screen.getByRole("checkbox", { name: /follow the partner standards/i }));
    await user.click(screen.getByRole("button", { name: "Apply to be a partner store" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Thanks, Pat — we got your application!");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/partner-applications");
    expect(JSON.parse(init.body)).toMatchObject({
      kind: "store",
      businessName: "Gateway Games",
      contactName: "Pat Lee",
      email: "pat@gateway.example",
      city: "Kirkwood",
      state: "MO",
      categories: ["pokemon", "video_games"],
      buysByMail: true,
      agreed: true,
      attribution: { utmSource: "card_show", utmMedium: "qr", landingPath: "/for-stores" },
      fax: "",
    });
  });

  it("shows the server's message when it refuses", async () => {
    stubFetch({ ok: false, body: { ok: false, message: "We've already received an application from this email today." } });
    const user = userEvent.setup();
    render(<PartnerApplicationForm kind="store" />);
    await fillCommon(user, "store");
    await user.click(screen.getByRole("checkbox", { name: "Pokémon cards" }));
    await user.click(screen.getByRole("checkbox", { name: /follow the partner standards/i }));
    await user.click(screen.getByRole("button", { name: "Apply to be a partner store" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already received an application");
    expect(screen.getByLabelText("Store name")).toHaveValue("Gateway Games");
  });
});

describe("PartnerApplicationForm — referral partners", () => {
  it("asks what they do instead of what they buy, and promises their link", async () => {
    const fetchMock = stubFetch({ ok: true, body: { ok: true } });
    const user = userEvent.setup();
    render(<PartnerApplicationForm kind="referrer" />);
    expect(screen.queryByRole("checkbox", { name: "Pokémon cards" })).toBeNull();
    await fillCommon(user, "referrer");
    await user.click(screen.getByRole("checkbox", { name: /share my referral link only/i }));
    await user.click(screen.getByRole("button", { name: "Apply to be a referral partner" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please choose what you do.");

    await user.selectOptions(screen.getByLabelText("What do you do?"), "estate_sale");
    await user.click(screen.getByRole("button", { name: "Apply to be a referral partner" }));
    expect(await screen.findByRole("status")).toHaveTextContent("with your personal referral link");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({
      kind: "referrer",
      profession: "estate_sale",
      categories: [],
    });
  });
});
