// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const status = { ordersPaused: true, message: "We're at a tournament this week.", pausedUntil: "2026-10-03T12:00:00Z" as string | null };
vi.mock("../src/store/lib/storeStatus", () => ({
  useStoreStatus: () => status,
  formatReopenDate: () => "Saturday, October 3",
}));

const { default: OrdersPausedBanner } = await import("../src/store/components/OrdersPausedBanner");

afterEach(cleanup);

describe("OrdersPausedBanner", () => {
  it("starts as one short line and expands to the full message", async () => {
    const user = userEvent.setup();
    const { container } = render(<OrdersPausedBanner />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(container.querySelector(".gg-paused-banner__short")).toHaveTextContent(/^Reopens /);
    await user.click(screen.getByText("Orders paused"));
    expect(details.open).toBe(true);
    expect(screen.getByText(/at a tournament this week/)).toBeVisible();
  });

  it("says browsing is open when there's no reopen date", () => {
    status.pausedUntil = null;
    render(<OrdersPausedBanner />);
    expect(screen.getByText("Browsing is still open")).toBeInTheDocument();
    status.pausedUntil = "2026-10-03T12:00:00Z";
  });

  it("renders nothing when orders aren't paused", () => {
    status.ordersPaused = false;
    const { container } = render(<OrdersPausedBanner />);
    expect(container).toBeEmptyDOMElement();
    status.ordersPaused = true;
  });
});
