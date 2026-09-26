// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-type notification sounds, played by the open admin app. A fake Web
// Audio context records what each sound schedules.

interface FakeOsc {
  type: string;
  freqs: number[];
  started: number;
}

const created: FakeOsc[] = [];
let contextState: "running" | "suspended" = "running";

class FakeAudioParam {
  value = 0;
  constructor(private record?: (v: number) => void) {}
  setValueAtTime(v: number) {
    this.record?.(v);
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  get state() {
    return contextState;
  }
  async resume() {
    /* stays however the test set it */
  }
  createGain() {
    return { gain: new FakeAudioParam(), connect() {} };
  }
  createOscillator() {
    const osc: FakeOsc = { type: "sine", freqs: [], started: 0 };
    created.push(osc);
    return {
      set type(t: string) {
        osc.type = t;
      },
      frequency: new FakeAudioParam((v) => osc.freqs.push(v)),
      connect() {},
      start() {
        osc.started += 1;
      },
      stop() {},
    };
  }
}

async function load() {
  vi.resetModules();
  return import("../src/admin/services/sounds");
}

beforeEach(() => {
  created.length = 0;
  contextState = "running";
  localStorage.clear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => vi.unstubAllGlobals());

function signature(): string {
  return created.map((o) => `${o.type}:${o.freqs.join("/")}`).join(",");
}

describe("notification sounds", () => {
  it("gives orders, buying leads, partner leads and sign-ups each their own sound", async () => {
    const sounds = await load();
    const signatures: string[] = [];
    for (const kind of ["order", "buying_lead", "partner_lead", "signup", "offer_response"]) {
      created.length = 0;
      expect(await sounds.playNotificationSound(kind)).toBe(true);
      expect(created.every((o) => o.started === 1)).toBe(true);
      signatures.push(signature());
    }
    expect(new Set(signatures.slice(0, 4)).size).toBe(4);
    // Anything else shares the one gentle default chime.
    created.length = 0;
    await sounds.playNotificationSound("pickup");
    expect(signature()).toBe(signatures[4]);
  });

  it("reports when the browser won't play audio yet, so the system sound is used instead", async () => {
    contextState = "suspended";
    const sounds = await load();
    expect(await sounds.playNotificationSound("order")).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("remembers the on/off choice on this device", async () => {
    const sounds = await load();
    expect(sounds.soundsEnabled()).toBe(true);
    sounds.setSoundsEnabled(false);
    expect(sounds.soundsEnabled()).toBe(false);
  });
});

describe("handlePushMessage", () => {
  function message(data: unknown) {
    const reply = vi.fn();
    const event = { data, ports: [{ postMessage: reply }] } as unknown as MessageEvent;
    return { event, reply };
  }

  it("plays the kind's sound, tells the service worker it did, and refreshes the bell", async () => {
    const sounds = await load();
    const onPush = vi.fn();
    window.addEventListener("gg-admin-push", onPush);
    const { event, reply } = message({ type: "gg-admin-push", kind: "order" });
    sounds.handlePushMessage(event);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ played: true }));
    expect(created.length).toBeGreaterThan(0);
    expect(onPush).toHaveBeenCalled();
    window.removeEventListener("gg-admin-push", onPush);
  });

  it("stays quiet (and says so) when sounds are turned off", async () => {
    const sounds = await load();
    sounds.setSoundsEnabled(false);
    const { event, reply } = message({ type: "gg-admin-push", kind: "order" });
    sounds.handlePushMessage(event);
    expect(reply).toHaveBeenCalledWith({ played: false });
    expect(created).toHaveLength(0);
  });

  it("ignores other messages, like notification-tap navigation", async () => {
    const sounds = await load();
    const { event, reply } = message({ type: "gg-admin-navigate", path: "/admin_dashboard" });
    sounds.handlePushMessage(event);
    expect(reply).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
