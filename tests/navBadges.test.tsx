// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// Admin number badges: which count shows on which part of the sidebar, the
// total on the phone menu button and app icon, and keeping them fresh.

const rpc = vi.fn();

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

const { Sidebar } = await import("../src/admin/components/layout/Sidebar");
const { useNavBadges } = await import("../src/admin/hooks/useNavBadges");
const { adminFetch, ADMIN_DATA_CHANGED_EVENT } = await import("../src/admin/repositories/apiClient");
const { navBadgesRepository } = await import("../src/admin/repositories/navBadges.supabase");
const {
  EMPTY_NAV_BADGES,
  badgeText,
  isNewSignup,
  navBadgeTotal,
  parseNavBadges,
} = await import("../src/admin/utils/navBadges");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  rpc.mockReset();
});

describe("badge counts", () => {
  it("reads the database function's counts, treating anything odd as zero", () => {
    expect(parseNavBadges({ new_leads: 2, waiting_pickups: "3", new_users: -1, needs_packing: 1.7 })).toEqual({
      ...EMPTY_NAV_BADGES,
      new_leads: 2,
      waiting_pickups: 3,
      needs_packing: 1,
    });
    expect(parseNavBadges(null)).toEqual(EMPTY_NAV_BADGES);
    expect(parseNavBadges("nope")).toEqual(EMPTY_NAV_BADGES);
  });

  it("adds everything up for the menu button and app icon, and caps the label at 99+", () => {
    expect(navBadgeTotal({ ...EMPTY_NAV_BADGES, new_leads: 2, new_partner_leads: 1, waiting_pickups: 3, new_users: 4 })).toBe(10);
    expect(badgeText(7)).toBe("7");
    expect(badgeText(100)).toBe("99+");
  });

  it("marks customers New only if they signed up after the last visit", () => {
    const since = "2026-09-26T12:00:00Z";
    expect(isNewSignup({ createdAt: "2026-09-26T13:00:00Z", source: "account_signup" }, since)).toBe(true);
    expect(isNewSignup({ createdAt: "2026-09-26T11:00:00Z", source: "account_signup" }, since)).toBe(false);
    // Staff-added and imported customers aren't news.
    expect(isNewSignup({ createdAt: "2026-09-26T13:00:00Z", source: "manual" }, since)).toBe(false);
    expect(isNewSignup({ createdAt: "2026-09-26T13:00:00Z", source: "import" }, since)).toBe(false);
    expect(isNewSignup({ createdAt: "2026-09-26T13:00:00Z", source: "checkout" }, null)).toBe(false);
  });
});

describe("Sidebar", () => {
  function renderSidebar(counts: Partial<typeof EMPTY_NAV_BADGES>, collapsed = false) {
    render(
      <Sidebar
        activeKey="overview"
        collapsed={collapsed}
        mobileOpen={false}
        counts={{ ...EMPTY_NAV_BADGES, ...counts }}
        onNavigate={() => {}}
        onToggleCollapse={() => {}}
        onCloseMobile={() => {}}
      />,
    );
  }

  it("shows a number on Buying Leads, Partner Leads, Pickup Requests and Users", () => {
    renderSidebar({ new_leads: 2, new_partner_leads: 1, waiting_pickups: 3, new_users: 4 });
    expect(screen.getByRole("button", { name: "Buying Leads, 2 new" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Partner Leads, 1 new" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Pickup Requests, 3 waiting" })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Users, 4 new since you last looked" })).toHaveTextContent("4");
  });

  it("keeps the existing Orders and Inventory badges", () => {
    renderSidebar({ needs_packing: 5, open_photo_requests: 1 });
    expect(screen.getByRole("button", { name: "Orders, 5 to pack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inventory, 1 photo request waiting" })).toBeInTheDocument();
  });

  it("shows nothing when there's nothing waiting", () => {
    renderSidebar({});
    expect(screen.getByRole("button", { name: "Buying Leads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
  });

  it("still tells you the count when the sidebar is collapsed to icons", () => {
    renderSidebar({ waiting_pickups: 2 }, true);
    expect(screen.getByTitle("Pickup Requests: 2 waiting")).toBeInTheDocument();
  });
});

describe("useNavBadges", () => {
  function Probe({ page }: { page: string }) {
    const counts = useNavBadges(page);
    return <output data-testid="total">{navBadgeTotal(counts)}</output>;
  }

  const flush = () => act(async () => {});

  it("loads the counts, refreshes soon after an admin change, and mirrors the total on the app icon", async () => {
    vi.useFakeTimers();
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    Object.defineProperty(navigator, "setAppBadge", { value: setAppBadge, configurable: true });
    Object.defineProperty(navigator, "clearAppBadge", { value: clearAppBadge, configurable: true });

    rpc
      .mockResolvedValueOnce({ data: { new_leads: 1, waiting_pickups: 2 }, error: null })
      .mockResolvedValue({ data: {}, error: null });

    render(<Probe page="overview" />);
    await flush();
    expect(rpc).toHaveBeenCalledWith("admin_nav_badges");
    expect(screen.getByTestId("total")).toHaveTextContent("3");
    expect(setAppBadge).toHaveBeenLastCalledWith(3);

    // A lead gets reviewed somewhere in the admin…
    window.dispatchEvent(new Event(ADMIN_DATA_CHANGED_EVENT));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByTestId("total")).toHaveTextContent("0");
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("keeps the last counts when a refresh fails", async () => {
    rpc
      .mockResolvedValueOnce({ data: { new_partner_leads: 2 }, error: null })
      .mockResolvedValue({ data: null, error: { message: "offline" } });
    const { rerender } = render(<Probe page="overview" />);
    await flush();
    expect(screen.getByTestId("total")).toHaveTextContent("2");
    rerender(<Probe page="orders" />);
    await flush();
    expect(screen.getByTestId("total")).toHaveTextContent("2");
  });
});

describe("marking Users as seen", () => {
  it("returns the previous visit and refreshes the badges", async () => {
    const changed = vi.fn();
    window.addEventListener(ADMIN_DATA_CHANGED_EVENT, changed);
    rpc.mockResolvedValue({ data: "2026-09-19T12:00:00+00:00", error: null });
    await expect(navBadgesRepository.markUsersSeen()).resolves.toBe("2026-09-19T12:00:00+00:00");
    expect(rpc).toHaveBeenCalledWith("admin_mark_section_seen", { p_section: "users" });
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(ADMIN_DATA_CHANGED_EVENT, changed);
  });
});

describe("adminFetch", () => {
  it("announces a change after a successful save, but not after a read or a failure", async () => {
    const changed = vi.fn();
    window.addEventListener(ADMIN_DATA_CHANGED_EVENT, changed);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await adminFetch("/api/admin/x", { method: "GET" });
    expect(changed).not.toHaveBeenCalled();

    await adminFetch("/api/admin/x", { method: "POST", body: { a: 1 } });
    expect(changed).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "nope" }), { status: 500 }));
    await expect(adminFetch("/api/admin/x", { method: "PATCH", body: {} })).rejects.toThrow("nope");
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(ADMIN_DATA_CHANGED_EVENT, changed);
  });
});
