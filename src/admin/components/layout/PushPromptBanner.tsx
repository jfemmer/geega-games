import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import {
  canPromptInstall,
  currentPermission,
  isIosDevice,
  isStandalone,
  pushAvailability,
  subscribeInstallPrompt,
} from "../../services/push";

// A slim, dismissible nudge at the top of the admin. It shows only when
// there's a clear next step toward notifications on this device:
//   * installed app (home-screen web app or the iPhone app), notifications
//     never asked → turn them on;
//   * iPhone/iPad in the browser → add to home screen first;
//   * a browser offering "Install app" → install.
// "Not now" hides it on this device for 30 days.

const DISMISSED_KEY = "gg_admin_push_prompt_dismissed_at";
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

export function PushPromptBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(recentlyDismissed);
  // Known asynchronously: the iPhone app has to ask the system.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);
  useEffect(() => {
    let active = true;
    void currentPermission().then((p) => {
      if (active) setPermission(p);
    });
    return () => {
      active = false;
    };
  }, []);
  if (dismissed || permission === null) return null;

  const availability = pushAvailability();
  let message: string | null = null;
  let action = "Turn on";
  if (isStandalone() && availability === "supported" && permission === "default") {
    message = "Get notified on this device about new orders, buying leads and offer responses.";
  } else if (isIosDevice() && !isStandalone()) {
    message = "Add Geega Admin to your home screen to get order and lead notifications on this device.";
    action = "Show me how";
  } else if (canInstall && !isStandalone()) {
    message = "Install Geega Admin to get order and lead notifications on this device.";
    action = "Set up";
  }
  if (!message) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* storage blocked — hidden for this visit only */
    }
    setDismissed(true);
  }

  return (
    <div className="gg-pushprompt" role="region" aria-label="Notifications">
      <Icon name="bell" size={18} />
      <p>{message}</p>
      <div className="gg-pushprompt__actions">
        <Button variant="primary" size="sm" onClick={onOpenSettings}>
          {action}
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
