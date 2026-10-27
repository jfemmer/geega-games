// @vitest-environment jsdom
//
// The admin Overview's visitor insights: what visitors search the shop for
// (and which searches found nothing), and visits from post links. Renders
// the real OverviewPage on the admin's mock repositories.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("../src/admin/repositories", async () => {
  const mock = await import("../src/admin/repositories/mock");
  return {
    analyticsRepository: mock.mockAnalyticsRepository,
    orderRepository: mock.mockOrderRepository,
    inventoryRepository: mock.mockInventoryRepository,
  };
});

const { OverviewPage } = await import("../src/admin/pages/OverviewPage");
const { mockAnalyticsRepository } = await import("../src/admin/repositories/mock");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function section(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  return heading.closest(".gg-card, section, [class*='card']") as HTMLElement;
}

describe("Overview visitor insights", () => {
  it("shows the searches that found nothing, the most searched, and visits from post links", async () => {
    render(<OverviewPage onNavigate={() => {}} />);
    await screen.findByRole("heading", { name: "Searched for, not found" }, { timeout: 3000 });

    const missed = section("Searched for, not found");
    expect(within(missed).getByText("sheoldred")).toBeInTheDocument();
    expect(within(missed).getByText("the one ring")).toBeInTheDocument();
    expect(within(missed).queryByText("sol ring")).toBeNull();
    expect(within(missed).getByText(/show up in Market Insights/)).toBeInTheDocument();

    const top = section("Most searched");
    expect(within(top).getByText("sol ring")).toBeInTheDocument();
    expect(within(top).getAllByText("None")).toHaveLength(2);

    const posts = section("Visits from your posts");
    expect(within(posts).getByText("Several cards, Oct 24")).toBeInTheDocument();
    expect(within(posts).getByText("Sheoldred The Apocalypse")).toBeInTheDocument();
    expect(within(posts).getAllByText("Facebook")).toHaveLength(2);
    expect(within(posts).getByText("11")).toBeInTheDocument();

    expect(screen.getByText(/visits were left out in this period/)).toBeInTheDocument();
  });

  it("explains each section before there's anything to show", async () => {
    const real = mockAnalyticsRepository.traffic.bind(mockAnalyticsRepository);
    vi.spyOn(mockAnalyticsRepository, "traffic").mockImplementation(async (range) => ({
      ...(await real(range)),
      filteredVisits: 0,
      searches: [],
      missedSearches: [],
      campaigns: [],
    }));
    render(<OverviewPage onNavigate={() => {}} />);
    expect(await screen.findByText("No empty searches", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("No searches yet")).toBeInTheDocument();
    expect(screen.getByText("No post links used yet")).toBeInTheDocument();
    expect(screen.getByText(/choose Copy Facebook post link/)).toBeInTheDocument();
    expect(screen.queryByText(/left out in this period/)).toBeNull();
  });
});
