// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeEvaluatorPage } from "../src/admin/pages/TradeEvaluatorPage";
import { NAV_ITEMS, SECTION_TITLES } from "../src/admin/components/layout/nav";
import { adminSection } from "../src/admin/hooks/useRouter";

// Admin → Trade Evaluator: type each card's TCG low on both sides of a trade,
// pick the trade credit percentage, and see what the customer pays or the
// credit they have left. Kept on the device until it's cleared.

const price = (line: number, side: "their" | "your") => screen.getByLabelText(`TCG low price, line ${line} of ${side} cards`);
const quantity = (line: number, side: "their" | "your") => screen.getByLabelText(`Quantity, line ${line} of ${side} cards`);
const summary = () => screen.getByRole("region", { name: "The trade" });
const result = () => within(summary()).getByRole("status");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("Trade Evaluator", () => {
  it("works out what the customer pays at 70% trade credit", async () => {
    const user = userEvent.setup();
    render(<TradeEvaluatorPage />);
    expect(within(result()).getByText("Type TCG low prices to see the trade.")).toBeInTheDocument();

    // Two $50 cards, and Enter for a $20 one on the next line.
    await user.clear(quantity(1, "their"));
    await user.type(quantity(1, "their"), "2");
    await user.type(price(1, "their"), "50{Enter}");
    expect(price(2, "their")).toHaveFocus();
    await user.type(price(2, "their"), "20");
    await user.type(price(1, "your"), "100");

    const theirs = screen.getByRole("region", { name: "They're trading in" });
    expect(within(theirs).getByText("3 cards")).toBeInTheDocument();
    expect(within(theirs).getByText("$120.00")).toBeInTheDocument();
    expect(within(summary()).getByText("Trade credit at 70%").nextElementSibling).toHaveTextContent("$84.00");
    expect(within(summary()).getByText("Your cards at TCG low").nextElementSibling).toHaveTextContent("$100.00");
    expect(result()).toHaveTextContent("They pay you$16.00Or they trade in $22.86 more at TCG low to cover it.");
  });

  it("changes the trade credit with a preset or a typed percentage", async () => {
    const user = userEvent.setup();
    render(<TradeEvaluatorPage />);
    await user.type(price(1, "their"), "120");
    await user.type(price(1, "your"), "100");

    await user.click(screen.getByRole("button", { name: "80%" }));
    expect(screen.getByRole("button", { name: "80%" })).toHaveAttribute("aria-pressed", "true");
    expect(result()).toHaveTextContent("They pay you$4.00");

    const percent = screen.getByLabelText("Trade credit");
    await user.clear(percent);
    await user.type(percent, "90");
    expect(result()).toHaveTextContent("You owe them in trade credit$8.00Or they take $8.00 more of your cards at TCG low.");

    await user.clear(percent);
    await user.type(percent, "0");
    expect(screen.getByText("Enter a whole number from 1 to 150.")).toBeInTheDocument();
    expect(within(summary()).queryByRole("status")).toBeNull();
  });

  it("calls an exact match an even trade", async () => {
    const user = userEvent.setup();
    render(<TradeEvaluatorPage />);
    await user.click(screen.getByRole("button", { name: "75%" }));
    await user.type(price(1, "their"), "40");
    await user.type(price(1, "your"), "30");
    expect(result()).toHaveTextContent("Even trade");
  });

  it("leaves out a price that isn't a number, and says so", async () => {
    const user = userEvent.setup();
    render(<TradeEvaluatorPage />);
    await user.type(price(1, "your"), "12.345");
    expect(price(1, "your")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/1 line isn't counted: fix the\s+price or quantity outlined in red\./)).toBeInTheDocument();
    expect(within(summary()).getByText("Your cards at TCG low").nextElementSibling).toHaveTextContent("$0.00");
  });

  it("adds and removes cards", async () => {
    const user = userEvent.setup();
    render(<TradeEvaluatorPage />);
    await user.type(price(1, "your"), "5");
    await user.click(within(screen.getByRole("region", { name: "They want from you" })).getByRole("button", { name: "Add card" }));
    expect(screen.getByLabelText("Card, line 2 of your cards")).toHaveFocus();
    await user.type(price(2, "your"), "7");
    expect(within(summary()).getByText("Your cards at TCG low").nextElementSibling).toHaveTextContent("$12.00");

    await user.click(screen.getByRole("button", { name: "Remove line 1 of your cards" }));
    expect(price(1, "your")).toHaveValue("7");
    expect(screen.queryByLabelText("TCG low price, line 2 of your cards")).toBeNull();
    // The last line empties rather than going away.
    await user.click(screen.getByRole("button", { name: "Remove line 1 of your cards" }));
    expect(price(1, "your")).toHaveValue("");
  });

  it("keeps the trade on this device until it's cleared, and the percentage after that", async () => {
    const user = userEvent.setup();
    const first = render(<TradeEvaluatorPage />);
    expect(screen.getByRole("button", { name: "Clear trade" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "60%" }));
    await user.type(screen.getByLabelText("Card, line 1 of their cards"), "Sol Ring");
    await user.type(price(1, "their"), "3.50");
    first.unmount();

    // Back from another page (or the app reloading).
    render(<TradeEvaluatorPage />);
    expect(screen.getByLabelText("Card, line 1 of their cards")).toHaveValue("Sol Ring");
    expect(price(1, "their")).toHaveValue("3.50");
    expect(screen.getByRole("button", { name: "60%" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Clear trade" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear this trade?" });
    expect(dialog).toHaveTextContent("Both lists are emptied. The trade credit stays at 60%.");
    await user.click(within(dialog).getByRole("button", { name: "Clear trade" }));
    expect(screen.getByLabelText("Card, line 1 of their cards")).toHaveValue("");
    expect(price(1, "their")).toHaveValue("");
    expect(screen.getByRole("button", { name: "60%" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(window.localStorage.getItem("gg-trade-evaluator") ?? "{}")).toMatchObject({
      creditPercent: "60",
      theirs: [{ name: "", quantity: "1", price: "" }],
    });
  });

  it("starts afresh when what's stored can't be read", () => {
    window.localStorage.setItem("gg-trade-evaluator", "{not json");
    render(<TradeEvaluatorPage />);
    expect(screen.getByLabelText("Trade credit")).toHaveValue("70");
    expect(price(1, "their")).toHaveValue("");
  });

  it("is in the admin menu, next to the register", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    expect(keys.indexOf("trade-evaluator")).toBe(keys.indexOf("pos") + 1);
    expect(NAV_ITEMS.find((item) => item.key === "trade-evaluator")).toMatchObject({
      label: "Trade Evaluator",
      path: "/admin_dashboard/trade-evaluator",
    });
    expect(adminSection("/admin_dashboard/trade-evaluator")).toBe("trade-evaluator");
    expect(SECTION_TITLES["trade-evaluator"]).toBe("Trade Evaluator");
  });
});
