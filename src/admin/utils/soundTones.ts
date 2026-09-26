// The admin notification sounds, as notes. One definition feeds both:
//   * the web app, which synthesizes them live with Web Audio
//     (src/admin/services/sounds.ts), and
//   * the iPhone app's push sounds, rendered to .wav files by
//     scripts/renderNotificationSounds.ts (npm run sounds:render) — so the
//     previews in the app sound exactly like the real notifications.
// Pure module — no browser or Node APIs.

export type ToneWave = "sine" | "triangle";

export interface Tone {
  /** Hz */
  freq: number;
  /** Glide to this frequency over the tone (Hz). */
  glideTo?: number;
  /** Seconds from the start of the sound. */
  at: number;
  /** Seconds until it has faded out. */
  length: number;
  wave?: ToneWave;
  /** 0–1 */
  level: number;
}

export type SoundKey = "order" | "buying_lead" | "partner_lead" | "signup" | "default";

export const SOUND_TONES: Record<SoundKey, Tone[]> = {
  // Bright "cha-ching": two quick high notes with a sparkle on top.
  order: [
    { freq: 1568, at: 0, length: 0.12, wave: "triangle", level: 0.35 },
    { freq: 2093, at: 0.09, length: 0.55, wave: "triangle", level: 0.4 },
    { freq: 3136, at: 0.09, length: 0.35, wave: "sine", level: 0.1 },
  ],
  // Rising three-note marimba: C – E – G.
  buying_lead: [
    { freq: 523.25, at: 0, length: 0.28, level: 0.45 },
    { freq: 659.25, at: 0.12, length: 0.28, level: 0.45 },
    { freq: 783.99, at: 0.24, length: 0.55, level: 0.5 },
    { freq: 1567.98, at: 0.24, length: 0.3, level: 0.08 },
  ],
  // Softer, lower "ding-dong" doorbell: E – C.
  partner_lead: [
    { freq: 659.25, at: 0, length: 0.7, wave: "sine", level: 0.45 },
    { freq: 1318.5, at: 0, length: 0.3, wave: "sine", level: 0.06 },
    { freq: 523.25, at: 0.32, length: 0.9, wave: "sine", level: 0.45 },
    { freq: 1046.5, at: 0.32, length: 0.35, wave: "sine", level: 0.06 },
  ],
  // Friendly upward "bloop" and a little welcome ping.
  signup: [
    { freq: 392, glideTo: 784, at: 0, length: 0.22, wave: "sine", level: 0.4 },
    { freq: 1046.5, at: 0.2, length: 0.35, wave: "sine", level: 0.3 },
  ],
  // Everything else (offer responses, pickups, test): one gentle chime.
  default: [
    { freq: 880, at: 0, length: 0.6, wave: "sine", level: 0.4 },
    { freq: 1760, at: 0, length: 0.25, wave: "sine", level: 0.08 },
  ],
};

/** A notification kind's sound; anything without its own uses the default chime. */
export function soundKeyFor(kind: string): SoundKey {
  return kind in SOUND_TONES ? (kind as SoundKey) : "default";
}

/**
 * The file each push asks the iPhone to play (the APNs "sound" field). The
 * app copies these into Library/Sounds on launch (ios/App/App/AppDelegate.swift).
 */
export const SOUND_FILES: Record<SoundKey, string> = {
  order: "gg-order.wav",
  buying_lead: "gg-buying-lead.wav",
  partner_lead: "gg-partner-lead.wav",
  signup: "gg-signup.wav",
  default: "gg-chime.wav",
};
