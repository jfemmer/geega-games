// @vitest-environment jsdom
//
// Shop search tracking (src/store/lib/searchTracking.ts): a search is sent
// once its results are on screen and it has stopped changing, or when the
// visitor leaves first — never while typing, never twice in a row, never for
// staff, and never anything that looks like an email address or phone number.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  user: null as null | { app_metadata?: Record<string, unknown> },
  loading: false,
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));

const { SETTLE_MS, searchToRecord, resetSearchTrackingForTests, useSearchTracking } = await import(
  "../src/store/lib/searchTracking"
);

type Props = { query: string; loading?: boolean; results?: number; filtered?: boolean; deals?: boolean };

function Probe({ query, loading = false, results = 0, filtered = false, deals = false }: Props) {
  useSearchTracking({ query, loading, results, filtered, deals });
  return null;
}

let fetchMock: ReturnType<typeof vi.fn>;
function sent() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSearchTrackingForTests();
  auth.user = null;
  auth.loading = false;
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  localStorage.clear();
});

describe("searchToRecord", () => {
  it("tidies a search, and refuses short or personal ones", () => {
    expect(searchToRecord("  Lightning   BOLT ")).toBe("lightning bolt");
    expect(searchToRecord("x")).toBeNull();
    expect(searchToRecord("me@example.com")).toBeNull();
    expect(searchToRecord("314.555.0199")).toBeNull();
    expect(searchToRecord("mh3 297")).toBe("mh3 297");
  });
});

describe("useSearchTracking", () => {
  it("sends a search once its results have been on screen for a moment", () => {
    render(<Probe query="Sheoldred" results={0} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(sent()).toEqual([{ t: "s", q: "sheoldred", n: 0, f: false, d: false }]);
  });

  it("sends only the search the visitor settled on, not every keystroke", () => {
    const { rerender } = render(<Probe query="sh" results={40} />);
    act(() => vi.advanceTimersByTime(500));
    rerender(<Probe query="sheol" results={2} />);
    act(() => vi.advanceTimersByTime(500));
    rerender(<Probe query="sheoldred" results={1} filtered deals />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(sent()).toEqual([{ t: "s", q: "sheoldred", n: 1, f: true, d: true }]);
  });

  it("doesn't count a search while its results are still loading", () => {
    const { rerender } = render(<Probe query="lightning bolt" loading results={12} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS * 3));
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<Probe query="lightning bolt" results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(sent()).toEqual([{ t: "s", q: "lightning bolt", n: 3, f: false, d: false }]);
  });

  it("doesn't send the same search twice in a row", () => {
    const { rerender, unmount } = render(<Probe query="lightning bolt" results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    rerender(<Probe query="Lightning Bolt " results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    unmount();
    render(<Probe query="lightning bolt" results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(sent()).toHaveLength(1);
  });

  it("sends a settled-on-screen search straight away if the visitor leaves first", () => {
    render(<Probe query="black lotus" results={0} />);
    act(() => vi.advanceTimersByTime(300));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sent()).toEqual([{ t: "s", q: "black lotus", n: 0, f: false, d: false }]);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends it when the visitor moves on to another page, too", () => {
    const { unmount } = render(<Probe query="the one ring" results={0} />);
    act(() => vi.advanceTimersByTime(300));
    unmount();
    expect(sent()).toEqual([{ t: "s", q: "the one ring", n: 0, f: false, d: false }]);
  });

  it("never sends an email address or phone number someone typed in", () => {
    const { rerender } = render(<Probe query="jordan@example.com" />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    rerender(<Probe query="314 555 0199" />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never counts staff, or anyone before we know who they are", () => {
    auth.loading = true;
    const { rerender } = render(<Probe query="lightning bolt" results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    auth.loading = false;
    auth.user = { app_metadata: { role: "staff" } };
    rerender(<Probe query="lightning bolt" results={3} />);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
