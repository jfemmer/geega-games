import type { StaffPushKind } from "../utils/pushKinds";
import { SOUND_TONES, soundKeyFor, type Tone } from "../utils/soundTones";

// A distinct sound for each kind of admin notification, played by the open
// admin app (the service worker asks it to — see public/admin-sw.js).
//
// Why in the app and not on the notification itself: web push can't choose
// a notification sound on any platform (iOS plays its standard sound;
// Android lets you pick one sound per app in its settings). So while Geega
// Admin is open and visible in a browser, it plays the event's own sound and
// the system notification is shown silently. (The iPhone app gets real
// per-type push sounds — see api/_lib/apns.ts — and uses these only for the
// previews in the Notifications panel.)
//
// The sounds are synthesized with Web Audio from the notes in
// utils/soundTones.ts, the same notes the iPhone app's push sounds are
// rendered from. Browsers only allow audio after the page has been tapped or
// clicked once, so installSoundUnlock() primes it on the first interaction.

export type SoundName = StaffPushKind | "test";

function tonesFor(name: string): Tone[] {
  return SOUND_TONES[soundKeyFor(name)];
}

const ENABLED_KEY = "gg_admin_sounds";
const MASTER_VOLUME = 0.6;

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked — stays on for this visit */
  }
}

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Call from a tap/click/keypress: browsers only start audio after one. */
export function unlockSounds(): void {
  const ctx = audioContext();
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => undefined);
}

/** Prime audio on the first interaction with the admin app. Returns a cleanup. */
export function installSoundUnlock(): () => void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const onFirst = () => {
    unlockSounds();
    events.forEach((e) => window.removeEventListener(e, onFirst, true));
  };
  events.forEach((e) => window.addEventListener(e, onFirst, true));
  return () => events.forEach((e) => window.removeEventListener(e, onFirst, true));
}

/**
 * Play a notification kind's sound. Resolves false if the browser won't play
 * audio yet (nobody has tapped the page since it opened) — the caller then
 * lets the system notification make its normal sound instead.
 */
export async function playNotificationSound(name: string): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    try {
      await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 150))]);
    } catch {
      /* fall through to the state check */
    }
    // resume() changes state asynchronously; TypeScript's narrowing above doesn't know that.
    if ((ctx.state as AudioContextState) !== "running") return false;
  }

  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(ctx.destination);

  for (const tone of tonesFor(name)) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = start + tone.at;
    const t1 = t0 + tone.length;
    osc.type = tone.wave ?? "sine";
    osc.frequency.setValueAtTime(tone.freq, t0);
    if (tone.glideTo) osc.frequency.exponentialRampToValueAtTime(tone.glideTo, t0 + tone.length * 0.8);
    // Quick attack, smooth exponential fade — no clicks.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(tone.level, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.05);
  }
  return true;
}

/**
 * Service worker → app message when a push arrives while this window is
 * visible (public/admin-sw.js). Plays that kind's sound and replies whether
 * it did, so the system notification is silent only when a sound played.
 * Also announces "gg-admin-push" so the bell refreshes. Ignores other messages.
 */
export function handlePushMessage(event: MessageEvent): void {
  const data = event.data as { type?: unknown; kind?: unknown } | null;
  if (data?.type !== "gg-admin-push") return;
  const kind = typeof data.kind === "string" ? data.kind : "default";
  const reply = (played: boolean) => event.ports[0]?.postMessage({ played });
  window.dispatchEvent(new CustomEvent("gg-admin-push", { detail: { kind } }));
  if (!soundsEnabled()) {
    reply(false);
    return;
  }
  playNotificationSound(kind).then(reply, () => reply(false));
}
