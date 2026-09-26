import { adminFetch } from "../repositories/apiClient";
import type { StaffPushKind } from "../utils/pushKinds";
import {
  cachedNativePermission,
  isNativeApp,
  nativeConfig,
  nativeDeviceState,
  nativeDisable,
  nativeEnable,
  nativePermission,
  nativeSendTest,
  nativeSyncOnOpen,
  nativeUpdateKinds,
} from "./nativePush";

export { isNativeApp };

// Browser side of admin push notifications: the service worker
// (public/admin-sw.js), this device's Web Push subscription, and
// /api/admin/push. Also the "Install app" prompt on browsers that offer one.
//
// Where push works:
//   * Android (Chrome, Edge, Samsung Internet) and desktop Chrome/Edge/
//     Firefox/Safari — in the browser or installed.
//   * iPhone/iPad (iOS 16.4+) — ONLY after "Add to Home Screen", opened from
//     the home-screen icon. Safari tabs on iOS have no push at all.
//
// Inside the "Geega Admin" iPhone app, every function here hands off to
// ./nativePush (Apple push notifications, with a sound per type) — the rest
// of the dashboard doesn't need to know which one it's using.

export const ADMIN_SW_URL = "/admin-sw.js";
export const ADMIN_SW_SCOPE = "/admin_dashboard";

/** Set while this device should be receiving notifications; lets the app quietly re-subscribe if the browser rotates the subscription. */
const ENABLED_FLAG = "gg_admin_push_enabled";

export type PushAvailability =
  | "supported"
  | "ios-needs-install" // iPhone/iPad browser tab — needs Add to Home Screen first
  | "unsupported"
  | "insecure"; // http:// (e.g. a LAN dev server)

export interface DevicePushState {
  subscribed: boolean;
  kinds: StaffPushKind[];
}

export class PushPermissionError extends Error {
  readonly permission: NotificationPermission;
  constructor(permission: NotificationPermission) {
    super(
      permission === "denied"
        ? "Notifications are blocked for Geega Admin on this device."
        : "Notifications weren't allowed.",
    );
    this.permission = permission;
  }
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(ENABLED_FLAG) === "1";
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_FLAG, "1");
    else localStorage.removeItem(ENABLED_FLAG);
  } catch {
    /* storage blocked — the flag only helps with re-syncing */
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  if (isNativeApp()) return "supported";
  if (!window.isSecureContext) return "insecure";
  if (isIosDevice() && !isStandalone()) return "ios-needs-install";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return supported ? "supported" : "unsupported";
}

export function notificationPermission(): NotificationPermission {
  if (isNativeApp()) return cachedNativePermission();
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

/** Up-to-date permission (the iPhone app has to ask the system). */
export async function currentPermission(): Promise<NotificationPermission> {
  if (isNativeApp()) return nativePermission().catch(() => cachedNativePermission());
  return notificationPermission();
}

export async function registerAdminServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isNativeApp()) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register(ADMIN_SW_URL, { scope: ADMIN_SW_SCOPE });
  } catch (err) {
    console.warn("[push] service worker registration failed", err);
    return null;
  }
}

/** The active admin service worker, registering it if needed. Push can't subscribe without one. */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration(ADMIN_SW_SCOPE)) ?? (await registerAdminServiceWorker());
  if (!reg) throw new Error("Couldn't start notifications on this device. Reload the page and try again.");
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) throw new Error("Couldn't start notifications on this device. Reload the page and try again.");
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Notifications took too long to start. Try again.")), 10_000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        window.clearTimeout(timer);
        resolve();
      }
    });
  });
  return reg;
}

export async function deviceSubscription(): Promise<PushSubscription | null> {
  if (pushAvailability() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration(ADMIN_SW_SCOPE);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export interface PushServerConfig {
  configured: boolean;
  publicKey: string | null;
}

export function fetchPushConfig(): Promise<PushServerConfig> {
  if (isNativeApp()) return nativeConfig();
  return adminFetch<PushServerConfig>("/api/admin/push", { method: "GET" });
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(current: ArrayBuffer | null, publicKey: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function post<T>(body: Record<string, unknown>): Promise<T> {
  return adminFetch<T>("/api/admin/push", { method: "POST", body });
}

/** What the server has for this device. */
export async function deviceState(): Promise<DevicePushState> {
  if (isNativeApp()) return nativeDeviceState();
  const sub = await deviceSubscription();
  if (!sub) return { subscribed: false, kinds: [] };
  return post<DevicePushState>({ action: "status", endpoint: sub.endpoint });
}

/**
 * Turn notifications on for this device. Call straight from a click: iOS only
 * shows the permission prompt in response to a tap, so nothing slow (like a
 * network request) may run before Notification.requestPermission().
 */
export async function enablePush(publicKey: string, kinds?: StaffPushKind[]): Promise<DevicePushState> {
  if (isNativeApp()) return nativeEnable(kinds);
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionError(permission);

  const reg = await activeRegistration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key can't receive our pushes.
  if (sub && !sameKey(sub.options.applicationServerKey, publicKey)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const state = await post<DevicePushState>({ action: "subscribe", subscription: sub.toJSON(), kinds });
  writeFlag(true);
  return state;
}

export async function disablePush(): Promise<void> {
  if (isNativeApp()) return nativeDisable();
  writeFlag(false);
  const sub = await deviceSubscription();
  if (!sub) return;
  try {
    await post({ action: "unsubscribe", endpoint: sub.endpoint });
  } finally {
    await sub.unsubscribe().catch(() => undefined);
  }
}

export async function updatePushKinds(kinds: StaffPushKind[]): Promise<DevicePushState> {
  if (isNativeApp()) return nativeUpdateKinds(kinds);
  const sub = await deviceSubscription();
  if (!sub) throw new Error("Notifications aren't on for this device.");
  return post<DevicePushState>({ action: "update", endpoint: sub.endpoint, kinds });
}

export async function sendTestPush(): Promise<void> {
  if (isNativeApp()) return nativeSendTest();
  const sub = await deviceSubscription();
  if (!sub) throw new Error("Notifications aren't on for this device.");
  await post({ action: "test", endpoint: sub.endpoint });
}

/**
 * On app open: register the service worker, and if this device had
 * notifications on, make sure the server still has its current
 * subscription (browsers occasionally rotate them). Never prompts.
 */
export async function syncPushOnOpen(): Promise<void> {
  if (isNativeApp()) return nativeSyncOnOpen();
  await registerAdminServiceWorker();
  if (!readFlag() || pushAvailability() !== "supported" || notificationPermission() !== "granted") return;
  try {
    const config = await fetchPushConfig();
    if (!config.configured || !config.publicKey) return;
    await enablePush(config.publicKey);
  } catch (err) {
    console.warn("[push] re-sync failed", err);
  }
}

/** Sign-out: stop this device getting another person's (or anyone's) alerts. Bounded so it never blocks signing out. */
export async function disablePushForSignOut(): Promise<void> {
  if (pushAvailability() !== "supported") return;
  await Promise.race([
    disablePush().catch(() => undefined),
    new Promise((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

// ---- "Install app" (Chrome/Edge/Android fire beforeinstallprompt) ----

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn());
  });
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export function canPromptInstall(): boolean {
  return deferredInstall !== null && !isNativeApp();
}

export async function promptInstall(): Promise<boolean> {
  const event = deferredInstall;
  if (!event) return false;
  deferredInstall = null;
  installListeners.forEach((fn) => fn());
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
