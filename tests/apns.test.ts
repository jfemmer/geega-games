import { EventEmitter } from "node:events";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The iPhone app's push sender: signed provider token, per-type sounds, and
// what each APNs answer means for the device.

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const requests: { headers: Record<string, string>; body: string }[] = [];
let answers: Record<string, { status: number; body?: string }> = {};
let connectedTo: string | null = null;

vi.mock("node:http2", () => {
  const request = (headers: Record<string, string>) => {
    const stream = new EventEmitter() as EventEmitter & Record<string, unknown>;
    let body = "";
    Object.assign(stream, {
      setTimeout() {},
      setEncoding() {},
      close() {},
      end(payload: string) {
        body = payload;
        requests.push({ headers, body });
        const token = String(headers[":path"]).split("/").pop()!;
        const answer = answers[token] ?? { status: 200 };
        queueMicrotask(() => {
          stream.emit("response", { ":status": answer.status });
          if (answer.body) stream.emit("data", answer.body);
          stream.emit("end");
        });
      },
    });
    return stream;
  };
  const connect = (host: string) => {
    connectedTo = host;
    return Object.assign(new EventEmitter(), { request, close() {} });
  };
  return { default: { connect, constants: { NGHTTP2_CANCEL: 8 } }, connect, constants: { NGHTTP2_CANCEL: 8 } };
});

const { apnsConfigured, apnsJwt, apnsPayload, sendApns } = await import("../api/_lib/apns.ts");

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const MESSAGE = { title: "New order", body: "Jordan V. · 2 items", url: "/admin_dashboard/orders?order=1", kind: "order", tag: "order:1" };

beforeEach(() => {
  process.env.APNS_KEY_ID = "KEY1234567";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_PRIVATE_KEY = PEM.replace(/\n/g, "\\n"); // as Vercel may store it
  delete process.env.APNS_ENVIRONMENT;
  requests.length = 0;
  answers = {};
  connectedTo = null;
});

afterEach(() => {
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_PRIVATE_KEY;
});

describe("apnsPayload", () => {
  it("gives each kind its own sound file, with the tap-through link", () => {
    const sound = (kind: string) => JSON.parse(apnsPayload({ ...MESSAGE, kind })).aps.sound;
    expect(sound("order")).toBe("gg-order.wav");
    expect(sound("buying_lead")).toBe("gg-buying-lead.wav");
    expect(sound("partner_lead")).toBe("gg-partner-lead.wav");
    expect(sound("signup")).toBe("gg-signup.wav");
    expect(sound("pickup")).toBe("gg-chime.wav");
    expect(JSON.parse(apnsPayload(MESSAGE))).toMatchObject({
      aps: { alert: { title: "New order", body: "Jordan V. · 2 items" }, "thread-id": "order" },
      url: "/admin_dashboard/orders?order=1",
    });
  });
});

describe("apnsJwt", () => {
  it("is an ES256 token Apple can verify, reused instead of re-signed every time", () => {
    const token = apnsJwt(1_700_000_000_000);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    const ok = verify(
      "SHA256",
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
    expect(apnsJwt(1_700_000_000_000 + 10 * 60 * 1000)).toBe(token);
    expect(apnsJwt(1_700_000_000_000 + 45 * 60 * 1000)).not.toBe(token);
  });
});

describe("sendApns", () => {
  it("sends an alert to Apple's production service with the app's topic", async () => {
    expect(await sendApns([TOKEN_A], MESSAGE)).toEqual(["delivered"]);
    expect(connectedTo).toBe("https://api.push.apple.com");
    const { headers } = requests[0];
    expect(headers).toMatchObject({
      ":method": "POST",
      ":path": `/3/device/${TOKEN_A}`,
      "apns-topic": "com.geegagames.admin",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "order:1",
    });
    expect(headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("marks uninstalled or invalid devices as gone, and config problems as failed", async () => {
    answers = {
      [TOKEN_A]: { status: 410, body: JSON.stringify({ reason: "Unregistered" }) },
      [TOKEN_B]: { status: 403, body: JSON.stringify({ reason: "InvalidProviderToken" }) },
    };
    const bad = "c".repeat(64);
    answers[bad] = { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendApns([TOKEN_A, TOKEN_B, bad], MESSAGE)).toEqual(["gone", "failed", "gone"]);
    errSpy.mockRestore();
  });

  it("uses the sandbox only when told to", async () => {
    process.env.APNS_ENVIRONMENT = "sandbox";
    await sendApns([TOKEN_A], MESSAGE);
    expect(connectedTo).toBe("https://api.sandbox.push.apple.com");
  });

  it("does nothing without the APNs key", async () => {
    delete process.env.APNS_PRIVATE_KEY;
    expect(apnsConfigured()).toBe(false);
    expect(await sendApns([TOKEN_A], MESSAGE)).toEqual(["failed"]);
    expect(connectedTo).toBeNull();
  });
});
