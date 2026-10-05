// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupForm from "../src/SignupForm";

// The home page's email list signup. It used to be the pre-opening "Get the
// launch notice" box ("we'll email you the moment checkout goes live") long
// after checkout was live. It now offers the email list: new arrivals,
// discounts and crazy deals.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubSubscribe(reply: { status?: number; body?: unknown } | "network-error") {
  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body ?? {},
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the email list signup", () => {
  it("offers the email list: new arrivals, discounts and crazy deals", () => {
    render(<SignupForm />);

    const form = screen.getByRole("form", { name: "Join the email list" });
    expect(screen.getByRole("heading", { level: 2, name: "Join the email list" })).toBeInTheDocument();
    expect(form).toHaveTextContent("New arrivals, discounts and crazy deals, straight to your inbox.");

    const promises = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(promises).toEqual([
      "New arrivals and restocks. Often a single copy, so it pays to see them first.",
      "Discounts and sales. Price drops, storewide sales and new Deals & Specials.",
      "Crazy deals. The occasional offer that won’t last long.",
    ]);

    expect(screen.getByRole("button", { name: "Join the list" })).toBeEnabled();
    expect(form).toHaveTextContent(
      "No spam — only when there’s something worth opening. We never sell your email, and you can unsubscribe any time.",
    );
  });

  it("says nothing about a launch any more", () => {
    const { container } = render(<SignupForm />);
    expect(container.textContent).not.toMatch(/launch|goes live|go live|shop opens|notify me/i);
  });

  it("ties the reassurance and any error to the email field for screen readers", () => {
    render(<SignupForm />);
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("aria-describedby", "signup-note signup-fine");
    expect(document.getElementById("signup-fine")).toHaveTextContent(/unsubscribe any time/);
    // The note is in the page from the start, so a later message is announced.
    expect(document.getElementById("signup-note")).toBeEmptyDOMElement();
  });

  it("sends the address to the list and asks the subscriber to confirm by email", async () => {
    const fetchMock = stubSubscribe({ body: { ok: true, status: "confirmation_sent" } });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email address"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Join the list" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "jordan@example.com",
      hp_ref: "",
      source: "storefront",
    });

    await screen.findByRole("heading", { name: "Check your inbox" });
    const done = screen.getByRole("status");
    expect(done).toHaveTextContent("Check your inbox");
    expect(done).toHaveTextContent("Click it to finish joining the list.");
    expect(done).toHaveTextContent("check your spam folder");
    expect(done).not.toHaveTextContent(/launch|shop opens/i);
  });

  // On a phone the top of the box is usually scrolled up behind the header
  // while someone types. The message has to appear where the field was, or
  // they see nothing happen.
  it("puts the “check your inbox” message where the email field was", async () => {
    stubSubscribe({ body: { ok: true, status: "confirmation_sent" } });
    const user = userEvent.setup();
    render(<SignupForm />);
    const form = screen.getByRole("form", { name: "Join the email list" });
    const list = screen.getByRole("list");
    expect(list.nextElementSibling).toHaveClass("field");

    await user.type(screen.getByLabelText("Email address"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Join the list" }));
    await screen.findByRole("heading", { name: "Check your inbox" });

    // Same box, same heading and promises above — only the field is replaced.
    expect(screen.getByRole("form", { name: "Join the email list" })).toBe(form);
    expect(screen.getByRole("list")).toBe(list);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const done = screen.getByRole("status");
    expect(list.nextElementSibling).toBe(done);
    expect(done).toHaveFocus();

    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join the list" })).not.toBeInTheDocument();
    expect(form).not.toHaveTextContent(/No spam/);
  });

  it("stops an address that isn't an email before sending anything", async () => {
    const fetchMock = stubSubscribe({ body: { ok: true } });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email address"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Join the list" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email address.");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");

    // Typing again clears the message.
    await user.type(screen.getByLabelText("Email address"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's message when the address is refused", async () => {
    stubSubscribe({
      status: 400,
      body: { ok: false, status: "validation_error", message: "Please enter a valid email address." },
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("Email address"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Join the list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a valid email address.");
    expect(screen.getByRole("button", { name: "Join the list" })).toBeEnabled();
  });

  it("keeps the form and says so when the server has a problem or can't be reached", async () => {
    const user = userEvent.setup();

    stubSubscribe({ status: 500, body: { ok: false, status: "server_error" } });
    const first = render(<SignupForm />);
    await user.type(screen.getByLabelText("Email address"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Join the list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again shortly.");
    expect(screen.getByLabelText("Email address")).toHaveValue("jordan@example.com");
    first.unmount();

    stubSubscribe("network-error");
    render(<SignupForm />);
    await user.type(screen.getByLabelText("Email address"), "jordan@example.com");
    await user.click(screen.getByRole("button", { name: "Join the list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t reach the server. Please try again shortly.",
    );
  });
});
