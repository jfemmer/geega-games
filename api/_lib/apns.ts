import http2 from "node:http2";
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { ServerEnv } from "./env.js";
import { SOUND_FILES, soundKeyFor } from "../../src/admin/utils/soundTones.js";

// Apple Push Notification service (APNs) for the "Geega Admin" iPhone app.
//
// Unlike web push, a native push can name its own sound: each notification
// kind plays its own .wav (src/admin/utils/soundTones.ts → rendered into the
// app, installed to Library/Sounds by ios/App/App/AppDelegate.swift).
//
// Auth is token-based: a short JWT signed (ES256) with the APNs key from the
// Apple Developer account, reused for up to 40 minutes (Apple wants it
// refreshed between 20 and 60). Requests go over HTTP/2, one connection per
// batch. Used by notifyStaff() (api/_lib/staffPush.ts) and the admin "Send a
// test" button (api/admin/native-push.ts). Never throws.

export interface ApnsMessage {
  title: string;
  body: string;
  /** Admin page to open on tap. */
  url: string;
  /** Notification kind — picks the sound. */
  kind: string;
  /** Same tag = a newer notification replaces the older one on the device. */
  tag?: string;
}

/** delivered · gone (uninstalled / token no longer valid: forget it) · failed (try again next time) */
export type ApnsOutcome = "delivered" | "gone" | "failed";

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;
const JWT_MAX_AGE_MS = 40 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const EXPIRY_S = 12 * 60 * 60; // an undelivered alert older than this isn't worth showing

export function apnsConfigured(): boolean {
  return Boolean(ServerEnv.apnsKeyId() && ServerEnv.apnsTeamId() && ServerEnv.apnsPrivateKey());
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

let signingKey: { pem: string; key: KeyObject } | null = null;
let cachedJwt: { token: string; issuedAt: number; keyId: string } | null = null;

/** The provider token APNs expects in `authorization: bearer …`. */
export function apnsJwt(now = Date.now()): string {
  const keyId = ServerEnv.apnsKeyId();
  if (cachedJwt && cachedJwt.keyId === keyId && now - cachedJwt.issuedAt < JWT_MAX_AGE_MS) return cachedJwt.token;

  const pem = ServerEnv.apnsPrivateKey();
  if (signingKey?.pem !== pem) signingKey = { pem, key: createPrivateKey(pem) };

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: ServerEnv.apnsTeamId(), iat: Math.floor(now / 1000) }));
  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    .sign({ key: signingKey.key, dsaEncoding: "ieee-p1363" });
  const token = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { token, issuedAt: now, keyId };
  return token;
}

/** The JSON body: an alert with this kind's sound, plus where to go on tap. */
export function apnsPayload(message: ApnsMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: SOUND_FILES[soundKeyFor(message.kind)],
      // Groups notifications of one kind together in Notification Center.
      "thread-id": message.kind,
    },
    url: message.url,
    kind: message.kind,
  });
}

/** Apple's documented reasons a token will never work again. */
const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "ExpiredToken"]);

function sendOne(
  session: http2.ClientHttp2Session,
  token: string,
  payload: string,
  headers: Record<string, string>,
): Promise<ApnsOutcome> {
  return new Promise((resolve) => {
    let status = 0;
    let body = "";
    const req = session.request({ ":method": "POST", ":path": `/3/device/${token}`, ...headers });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      resolve("failed");
    });
    req.on("response", (h) => {
      status = Number(h[":status"]);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      if (status === 200) return resolve("delivered");
      let reason = "";
      try {
        reason = (JSON.parse(body) as { reason?: string }).reason ?? "";
      } catch {
        /* no JSON body */
      }
      if (status === 410 || GONE_REASONS.has(reason)) return resolve("gone");
      // 403 InvalidProviderToken / TopicDisallowed etc. are configuration
      // problems, not bad devices: keep the device, log loudly.
      console.error("[apns] push rejected", status, reason || body.slice(0, 200));
      resolve("failed");
    });
    req.on("error", (err) => {
      console.error("[apns] request error", err);
      resolve("failed");
    });
    req.end(payload);
  });
}

/** Send one message to several devices. Outcomes are in the same order as `tokens`. */
export async function sendApns(tokens: string[], message: ApnsMessage): Promise<ApnsOutcome[]> {
  if (tokens.length === 0) return [];
  if (!apnsConfigured()) return tokens.map(() => "failed");

  let session: http2.ClientHttp2Session | null = null;
  try {
    const jwt = apnsJwt();
    const headers: Record<string, string> = {
      authorization: `bearer ${jwt}`,
      "apns-topic": ServerEnv.apnsBundleId(),
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + EXPIRY_S),
      ...(message.tag ? { "apns-collapse-id": message.tag.slice(0, 64) } : {}),
    };
    const payload = apnsPayload(message);
    session = http2.connect(HOSTS[ServerEnv.apnsEnvironment()]);
    session.on("error", (err) => console.error("[apns] connection error", err));
    return await Promise.all(tokens.map((token) => sendOne(session!, token, payload, headers)));
  } catch (err) {
    console.error("[apns] send failed", err);
    return tokens.map(() => "failed");
  } finally {
    session?.close();
  }
}
