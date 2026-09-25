// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReferralLeadForm from "../src/store/components/ReferralLeadForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm() {
  return render(
    <ReferralLeadForm
      category="one_piece"
      descriptionPlaceholder="What do you have?"
      sourcePath="/sell-one-piece-cards"
    />,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/tell us about it/i), "A booster box and some alt arts");
  await user.type(screen.getByLabelText(/^first name/i), "Sam");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "sam@example.com");
}

describe("ReferralLeadForm", () => {
  it("starts with the page's own category ticked", () => {
    renderForm();
    expect(screen.getByRole("checkbox", { name: "One Piece cards" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pokémon cards" })).not.toBeChecked();
  });

  it("won't send anything until the seller agrees to share with the buying partner", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /send to our buying partner/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/share your details/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the lead and shows the reference number", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, referenceNumber: "GG-R-100007" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("checkbox", { name: "Video games & consoles" }));
    await user.click(screen.getByRole("checkbox", { name: /i own these items/i }));
    await user.click(screen.getByRole("button", { name: /send to our buying partner/i }));

    expect(await screen.findByText("GG-R-100007")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("/api/referral-leads");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      categories: ["one_piece", "video_games"],
      description: "A booster box and some alt arts",
      consent: true,
      sourcePath: "/sell-one-piece-cards",
      contact: { firstName: "Sam", email: "sam@example.com", preferredContactMethod: "email" },
      website: "",
    });
  });
});
