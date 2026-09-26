import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  PushPermissionError,
  canPromptInstall,
  deviceState,
  disablePush,
  enablePush,
  fetchPushConfig,
  isStandalone,
  notificationPermission,
  promptInstall,
  pushAvailability,
  sendTestPush,
  subscribeInstallPrompt,
  updatePushKinds,
  type DevicePushState,
  type PushAvailability,
  type PushServerConfig,
} from "../services/push";
import type { StaffPushKind } from "../utils/pushKinds";

export type PushBusy = null | "enable" | "disable" | "kinds" | "test";

export interface PushSettings {
  loading: boolean;
  availability: PushAvailability;
  permission: NotificationPermission;
  standalone: boolean;
  config: PushServerConfig | null;
  device: DevicePushState;
  error: string | null;
  busy: PushBusy;
  canInstall: boolean;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  setKinds: (kinds: StaffPushKind[]) => Promise<boolean>;
  test: () => Promise<boolean>;
  install: () => Promise<void>;
  reload: () => void;
}

const OFF: DevicePushState = { subscribed: false, kinds: [] };

function messageOf(err: unknown): string {
  if (err instanceof PushPermissionError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

/** State and actions for this device's admin push notifications. Loads when `active`. */
export function usePushSettings(active: boolean): PushSettings {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PushServerConfig | null>(null);
  const [device, setDevice] = useState<DevicePushState>(OFF);
  const [permission, setPermission] = useState<NotificationPermission>(notificationPermission);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PushBusy>(null);
  const [nonce, setNonce] = useState(0);
  const availability = pushAvailability();
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cfg = await fetchPushConfig();
        const state = availability === "supported" && cfg.configured ? await deviceState() : OFF;
        if (cancelled) return;
        setConfig(cfg);
        setDevice(state);
        setPermission(notificationPermission());
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, availability, nonce]);

  const run = useCallback(async (kind: Exclude<PushBusy, null>, fn: () => Promise<void>): Promise<boolean> => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    } finally {
      setPermission(notificationPermission());
      setBusy(null);
    }
  }, []);

  return {
    loading,
    availability,
    permission,
    standalone: isStandalone(),
    config,
    device,
    error,
    busy,
    canInstall,
    enable: () =>
      run("enable", async () => {
        if (!config?.publicKey) throw new Error("Push notifications aren't set up on the server yet.");
        setDevice(await enablePush(config.publicKey));
      }),
    disable: () =>
      run("disable", async () => {
        await disablePush();
        setDevice(OFF);
      }),
    setKinds: (kinds) =>
      run("kinds", async () => {
        setDevice(await updatePushKinds(kinds));
      }),
    test: () => run("test", sendTestPush),
    install: async () => {
      await promptInstall();
    },
    reload: () => setNonce((n) => n + 1),
  };
}
