// @vitest-environment jsdom
//
// The storefront's page-view beacon (src/store/lib/pageViews.ts): a view is
// sent when a person interacts with the page (engaged) or leaves it without
// doing anything (not engaged), so machines that only load a page can be
// left out of the visitor numbers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const state = vi.hoisted(() => ({
  path: "/",
  user: null as null | { app_metadata?: Record<string, unknown> },
  loading: false,
}));

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: state.user, loading: state.loading }),
}));
vi.mock("../src/store/lib/router", () => ({
  useRouter: () => ({ path: state.path, query: new URLSearchParams() }),
}));

const { createPageViewTracker, landingUtm, PageViewTracker } = await import("../src/store/lib/pageViews");

/** The window listeners the tracker adds, so a test can play a trusted (real) interaction. */
const listeners = new Map<string, EventListener>();
const realAdd = window.addEventListener.bind(window);

function interact(type = "pointerdown", trusted = true) {
  const handler = listeners.get(type);
  expect(handler, `listening for ${type}`).toBeTruthy();
  handler!({ isTrusted: trusted, type } as unknown as Event);
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  listeners.clear();
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, handler: EventListener, options?: unknown) => {
    listeners.set(type, handler);
    realAdd(type, handler, options as AddEventListenerOptions);
  }) as typeof window.addEventListener);
  state.path = "/";
  state.user = null;
  state.loading = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Back to jsdom's own values.
  delete (document as unknown as Record<string, unknown>).visibilityState;
  delete (navigator as unknown as Record<string, unknown>).webdriver;
  localStorage.clear();
});

describe("createPageViewTracker", () => {
  it("waits for a person, then sends the view as engaged, once", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/shop", "https://www.facebook.com/", { s: "facebook", m: "social", c: "picks-2026-10-27" });
    expect(send).not.toHaveBeenCalled();

    interact("pointerdown");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      p: "/shop",
      r: "https://www.facebook.com/",
      e: true,
      u: { s: "facebook", m: "social", c: "picks-2026-10-27" },
    });

    interact("keydown");
    interact("mousemove");
    setHidden(true);
    expect(send).toHaveBeenCalledTimes(1);
    tracker.stop();
  });

  it("ignores events a script made up", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/", "", null);
    interact("pointerdown", false);
    interact("touchstart", false);
    expect(send).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("sends the view as not engaged when the visitor leaves without doing anything", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/", "", null);
    setHidden(true);
    expect(send).toHaveBeenCalledWith({ p: "/", r: "", e: false });
    // Leaving again sends nothing more.
    window.dispatchEvent(new Event("pagehide"));
    expect(send).toHaveBeenCalledTimes(1);
    tracker.stop();
  });

  it("turns that view engaged when they come back and interact", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/sell-my-collection", "", null);
    window.dispatchEvent(new Event("pagehide"));
    setHidden(false);
    interact("touchstart");
    interact("touchstart");
    expect(send.mock.calls).toEqual([[{ p: "/sell-my-collection", r: "", e: false }], [{ t: "e", p: "/sell-my-collection" }]]);
    tracker.stop();
  });

  it("sends a page that was moved on from without any interaction (a redirect)", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/old", "https://google.com/", null);
    tracker.view("/new", "", null);
    expect(send).toHaveBeenCalledWith({ p: "/old", r: "https://google.com/", e: false });
    interact("wheel");
    expect(send).toHaveBeenLastCalledWith({ p: "/new", r: "", e: true });
    expect(send).toHaveBeenCalledTimes(2);
    tracker.stop();
  });

  it("stops listening when stopped", () => {
    const send = vi.fn();
    const tracker = createPageViewTracker(send);
    tracker.view("/", "", null);
    const handler = listeners.get("pointerdown")!;
    tracker.stop();
    setHidden(true);
    expect(send).not.toHaveBeenCalled();
    // The browser no longer calls it; the handler itself is harmless too.
    expect(typeof handler).toBe("function");
  });
});

describe("landingUtm", () => {
  it("reads the campaign tags of the link the visitor arrived on", () => {
    expect(landingUtm("?c=a,b&utm_source=facebook&utm_medium=social&utm_campaign=picks-2026-10-27")).toEqual({
      s: "facebook",
      m: "social",
      c: "picks-2026-10-27",
    });
    expect(landingUtm("?utm_campaign=fall-sale")).toEqual({ s: undefined, m: undefined, c: "fall-sale" });
    expect(landingUtm("?utm_source=" + "x".repeat(200))?.s).toHaveLength(100);
  });

  it("is null when the link had no tags", () => {
    expect(landingUtm("")).toBeNull();
    expect(landingUtm("?q=bolt")).toBeNull();
    expect(landingUtm("?utm_source=%20%20")).toBeNull();
  });
});

describe("PageViewTracker", () => {
  function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body));
  }

  beforeEach(() => {
    // jsdom has no sendBeacon, so the tracker falls back to fetch, which the test reads.
    expect("sendBeacon" in navigator).toBe(false);
  });

  it("tags only the landing page with where the visitor came from", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/shop/picks?c=a,b&utm_source=facebook&utm_medium=social&utm_campaign=picks-2026-10-27");
    state.path = "/shop/picks";
    const { rerender } = render(<PageViewTracker />);
    interact("pointerdown");
    state.path = "/cart";
    rerender(<PageViewTracker />);
    interact("pointerdown");

    const bodies = sentBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ p: "/shop/picks", e: true, u: { s: "facebook", m: "social", c: "picks-2026-10-27" } });
    expect(bodies[1]).toEqual({ p: "/cart", r: "", e: true });
  });

  it("sends nothing from a browser run by automation software", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => true });
    render(<PageViewTracker />);
    expect(listeners.has("pointerdown")).toBe(false);
    setHidden(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never counts staff, and remembers their device", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    state.user = { app_metadata: { role: "admin" } };
    const { rerender } = render(<PageViewTracker />);
    expect(localStorage.getItem("gg_staff_device")).toBe("1");
    // Signed out on the same device: still not counted.
    state.user = null;
    state.path = "/shop";
    rerender(<PageViewTracker />);
    setHidden(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits until it knows who is signed in", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    state.loading = true;
    render(<PageViewTracker />);
    expect(listeners.has("pointerdown")).toBe(false);
  });
});
