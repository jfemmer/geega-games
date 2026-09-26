import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { adminFetch } from "../repositories/apiClient";
import type { StaffPushKind } from "../utils/pushKinds";

// Native push for the "Geega Admin" iPhone app (Capacitor — capacitor.config.ts,
// docs/IOS_APP.md). The app loads this same dashboard, so services/push.ts
// hands off to these functions when it's running inside the app: Apple push
// notifications (APNs) instead of web push, registered through
// /api/admin/native-push. Each notification plays its own sound, even on the
// lock screen (api/_lib/apns.ts).

const TOKEN_KEY = "gg_admin_apns_token";

export interface NativeDeviceState {
  subscribed: boolean;
  kinds: StaffPushKind[];
}

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

let permission: NotificationPermission = "default";

function toPermission(state: string): NotificationPermission {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "default";
}

/** Last known permission (sync); nativePermission() refreshes it. */
export function cachedNativePermission(): NotificationPermission {
  return permission;
}

export async function nativePermission(): Promise<NotificationPermission> {
  permission = toPermission((await PushNotifications.checkPermissions()).receive);
  return permission;
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked — status just won't be remembered */
  }
}

function deviceName(): string {
  const ipad = /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return ipad ? "iPad" : "iPhone";
}

function post<T>(body: Record<string, unknown>): Promise<T> {
  return adminFetch<T>("/api/admin/native-push", { method: "POST", body });
}

/** Ask for permission if needed, then get this install's APNs token. */
async function registerDevice(): Promise<string> {
  let state = (await PushNotifications.checkPermissions()).receive;
  if (state === "prompt" || state === "prompt-with-rationale") {
    state = (await PushNotifications.requestPermissions()).receive;
  }
  permission = toPermission(state);
  if (state !== "granted") {
    throw new Error(
      state === "denied"
        ? "Notifications are blocked for Geega Admin on this device."
        : "Notifications weren't allowed.",
    );
  }

  const handles: { remove: () => Promise<void> }[] = [];
  const cleanup = () => handles.forEach((h) => void h.remove());
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Apple didn't respond. Check your connection and try again."));
    }, 20_000);
    void Promise.all([
      PushNotifications.addListener("registration", ({ value }) => {
        window.clearTimeout(timer);
        cleanup();
        resolve(value.toLowerCase());
      }),
      PushNotifications.addListener("registrationError", ({ error }) => {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error(error || "Couldn't register for notifications."));
      }),
    ]).then((added) => {
      handles.push(...added);
      void PushNotifications.register();
    });
  });
}

export async function nativeConfig(): Promise<{ configured: boolean; publicKey: null }> {
  const res = await adminFetch<{ configured: boolean }>("/api/admin/native-push", { method: "GET" });
  return { configured: res.configured, publicKey: null };
}

export async function nativeDeviceState(): Promise<NativeDeviceState> {
  await nativePermission().catch(() => undefined);
  const token = storedToken();
  if (!token) return { subscribed: false, kinds: [] };
  return post<NativeDeviceState>({ action: "status", token });
}

export async function nativeEnable(kinds?: StaffPushKind[]): Promise<NativeDeviceState> {
  const previous = storedToken();
  const token = await registerDevice();
  const state = await post<NativeDeviceState>({ action: "register", token, kinds, deviceName: deviceName() });
  storeToken(token);
  // Apple occasionally issues a new token; forget the old one.
  if (previous && previous !== token) void post({ action: "unregister", token: previous }).catch(() => undefined);
  return state;
}

export async function nativeDisable(): Promise<void> {
  const token = storedToken();
  storeToken(null);
  try {
    if (token) await post({ action: "unregister", token });
  } finally {
    await PushNotifications.unregister().catch(() => undefined);
  }
}

export async function nativeUpdateKinds(kinds: StaffPushKind[]): Promise<NativeDeviceState> {
  const token = storedToken();
  if (!token) throw new Error("Notifications aren't on for this iPhone.");
  return post<NativeDeviceState>({ action: "update", token, kinds });
}

export async function nativeSendTest(): Promise<void> {
  const token = storedToken();
  if (!token) throw new Error("Notifications aren't on for this iPhone.");
  await post({ action: "test", token });
}

/** On launch: if this iPhone had notifications on, make sure the server has its current token. Never prompts. */
export async function nativeSyncOnOpen(): Promise<void> {
  if (!storedToken()) return;
  if ((await nativePermission()) !== "granted") return;
  try {
    const config = await nativeConfig();
    if (config.configured) await nativeEnable();
  } catch (err) {
    console.warn("[push] native re-sync failed", err);
  }
}

/**
 * Tapping a notification opens its page; one arriving while the app is open
 * refreshes the bell. Returns a cleanup. Safe to call outside the app (no-op).
 */
export function installNativeNotificationHandlers(onOpen: (path: string) => void): () => void {
  if (!isNativeApp()) return () => undefined;
  const handles: { remove: () => Promise<void> }[] = [];
  let active = true;
  void Promise.all([
    PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = (notification.data as { url?: unknown } | undefined)?.url;
      if (typeof url === "string" && url.startsWith("/admin_dashboard")) onOpen(url);
    }),
    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      const kind = (notification.data as { kind?: unknown } | undefined)?.kind;
      window.dispatchEvent(new CustomEvent("gg-admin-push", { detail: { kind } }));
    }),
  ]).then((added) => {
    if (active) handles.push(...added);
    else added.forEach((h) => void h.remove());
  });
  return () => {
    active = false;
    handles.forEach((h) => void h.remove());
  };
}
