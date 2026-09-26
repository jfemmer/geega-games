// Renders the admin notification sounds (src/admin/utils/soundTones.ts) to
// 16-bit mono .wav files for the iPhone app's push notifications:
//
//   npm run sounds:render   →   native/www/sounds/gg-*.wav
//
// Those files ship inside the app (Capacitor copies native/www into it), the
// app moves them to Library/Sounds on launch, and each push names its file
// in the APNs "sound" field (api/_lib/apns.ts). Re-run after changing a
// sound, then rebuild the app. The synthesis mirrors the Web Audio version
// (src/admin/services/sounds.ts): same waves, glides and envelopes.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SOUND_FILES, SOUND_TONES, type SoundKey, type Tone } from "../src/admin/utils/soundTones.js";

const SAMPLE_RATE = 44_100;
const ATTACK_S = 0.012;
const FLOOR = 0.0001; // exponential ramps can't start or end at 0
const TAIL_S = 0.05;
/** Notifications play through small phone speakers: normalize to a strong but unclipped peak. */
const PEAK = 0.89;

const OUT_DIR = resolve(import.meta.dirname, "..", "native", "www", "sounds");

function envelope(tone: Tone, t: number): number {
  if (t < 0 || t > tone.length) return 0;
  if (t < ATTACK_S) return FLOOR * Math.pow(tone.level / FLOOR, t / ATTACK_S);
  return tone.level * Math.pow(FLOOR / tone.level, (t - ATTACK_S) / (tone.length - ATTACK_S));
}

function frequency(tone: Tone, t: number): number {
  if (!tone.glideTo) return tone.freq;
  const glideS = tone.length * 0.8;
  if (t >= glideS) return tone.glideTo;
  return tone.freq * Math.pow(tone.glideTo / tone.freq, t / glideS);
}

function wave(kind: Tone["wave"], phase: number): number {
  const x = phase * 2 * Math.PI;
  return kind === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(x)) : Math.sin(x);
}

export function renderSamples(tones: Tone[]): Float32Array {
  const totalS = Math.max(...tones.map((t) => t.at + t.length)) + TAIL_S;
  const samples = new Float32Array(Math.ceil(totalS * SAMPLE_RATE));
  for (const tone of tones) {
    let phase = 0;
    const start = Math.floor(tone.at * SAMPLE_RATE);
    const end = Math.min(samples.length, Math.ceil((tone.at + tone.length) * SAMPLE_RATE));
    for (let i = start; i < end; i += 1) {
      const t = (i - start) / SAMPLE_RATE;
      phase += frequency(tone, t) / SAMPLE_RATE;
      samples[i] += wave(tone.wave, phase) * envelope(tone, t);
    }
  }
  const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0) || 1;
  for (let i = 0; i < samples.length; i += 1) samples[i] = (samples[i] / peak) * PEAK;
  return samples;
}

export function encodeWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // linear PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const key of Object.keys(SOUND_TONES) as SoundKey[]) {
    const file = join(OUT_DIR, SOUND_FILES[key]);
    const samples = renderSamples(SOUND_TONES[key]);
    await writeFile(file, encodeWav(samples));
    console.log(`[sounds] ${SOUND_FILES[key]}  ${(samples.length / SAMPLE_RATE).toFixed(2)}s`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main();
}
