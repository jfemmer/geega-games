import { useState } from "react";
import { useToast } from "../../hooks/useToast";
import { usePushSettings } from "../../hooks/usePushSettings";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { STAFF_PUSH_KINDS, type StaffPushKind } from "../../utils/pushKinds";
import { isIosDevice } from "../../services/push";
import { playNotificationSound, setSoundsEnabled, soundsEnabled, unlockSounds } from "../../services/sounds";

// "Notifications on this device": turn admin push notifications on or off,
// pick which events buzz this device, send a test, and install the app.
// Every state a phone can be in gets a plain-English next step — the most
// common one being an iPhone in Safari, which has to add Geega Admin to the
// home screen before iOS allows notifications at all.

const SOUND_PREVIEWS = [
  { kind: "order", label: "New order" },
  { kind: "buying_lead", label: "New buying lead" },
  { kind: "partner_lead", label: "New partner lead" },
  { kind: "signup", label: "New sign-up" },
  { kind: "default", label: "Everything else" },
] as const;

/**
 * Per-type sounds. In a browser they play from the open app (see
 * services/sounds.ts for why); in the iPhone app they're the notifications'
 * own sounds, so there's nothing to switch — just previews.
 */
function SoundSettings({ native }: { native: boolean }) {
  const [on, setOn] = useState(soundsEnabled);
  return (
    <section className="gg-pushsettings__sounds">
      <h3>Sounds</h3>
      {native ? (
        <p className="gg-card-meta">
          Each type plays its own sound — even when your iPhone is locked. Silent mode and Focus
          still apply.
        </p>
      ) : (
        <label className="gg-pushsettings__kind">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => {
              setSoundsEnabled(e.target.checked);
              setOn(e.target.checked);
              if (e.target.checked) unlockSounds();
            }}
          />
          <span>
            <strong>A different sound for each type</strong>
            <span className="gg-card-meta">Plays while Geega Admin is open on this device.</span>
          </span>
        </label>
      )}
      <ul className="gg-pushsettings__soundlist">
        {SOUND_PREVIEWS.map((s) => (
          <li key={s.kind}>
            <span>{s.label}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Play the ${s.label.toLowerCase()} sound`}
              onClick={() => {
                unlockSounds();
                void playNotificationSound(s.kind);
              }}
            >
              Play
            </Button>
          </li>
        ))}
      </ul>
      {!native && (
        <p className="gg-card-meta">
          When Geega Admin is closed, notifications use your phone&rsquo;s standard sound — web apps
          can&rsquo;t pick a sound per notification. The Geega Admin iPhone app can: each type
          plays its own sound even on the lock screen.
        </p>
      )}
    </section>
  );
}

export function NotificationSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const push = usePushSettings(open);
  const { availability, config, device, permission, busy, standalone } = push;

  async function toggleKind(kind: StaffPushKind, on: boolean) {
    const next = on ? [...device.kinds, kind] : device.kinds.filter((k) => k !== kind);
    await push.setKinds(next);
  }

  async function onEnable() {
    if (await push.enable()) toast.success("Notifications are on for this device.");
  }

  async function onDisable() {
    if (await push.disable()) toast.success("Notifications are off for this device.");
  }

  async function onTest() {
    if (await push.test()) toast.success("Test sent — it should arrive in a few seconds.");
  }

  let body: React.ReactNode;
  if (push.loading) {
    body = <p className="gg-card-meta">Checking this device…</p>;
  } else if (availability === "ios-needs-install") {
    body = (
      <div className="gg-pushsettings__steps">
        <p>
          On iPhone and iPad, notifications only work in the Geega Admin app on your home screen.
          It takes a few seconds:
        </p>
        <ol>
          <li>
            Tap the <strong>Share</strong> button in Safari (the square with an arrow pointing up).
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>
            Open <strong>Geega Admin</strong> from your home screen and sign in.
          </li>
          <li>
            Open this menu again and tap <strong>Turn on notifications</strong>.
          </li>
        </ol>
        <p className="gg-card-meta">Needs iOS 16.4 or later.</p>
      </div>
    );
  } else if (availability === "unsupported" || availability === "insecure") {
    body = (
      <div className="gg-inline-note gg-inline-note--warning">
        <Icon name="warning" size={16} />
        <div>
          {availability === "insecure"
            ? "Notifications need a secure (https) connection."
            : "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari — or install Geega Admin on your phone."}
        </div>
      </div>
    );
  } else if (config && !config.configured) {
    body = (
      <div className="gg-inline-note gg-inline-note--warning">
        <Icon name="warning" size={16} />
        <div>
          {push.native ? (
            <>
              Notifications for the iPhone app aren&rsquo;t set up on the server yet. Add the Apple
              push key (<code>APNS_KEY_ID</code>, <code>APNS_TEAM_ID</code>,{" "}
              <code>APNS_PRIVATE_KEY</code>) in Vercel — see <code>docs/IOS_APP.md</code> — then
              redeploy.
            </>
          ) : (
            <>
              Push notifications aren&rsquo;t set up on the server yet. Add{" "}
              <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> in Vercel (see{" "}
              <code>.env.example</code>), then redeploy.
            </>
          )}
        </div>
      </div>
    );
  } else if (permission === "denied" && !device.subscribed) {
    body = (
      <div className="gg-inline-note gg-inline-note--warning">
        <Icon name="warning" size={16} />
        <div>
          Notifications are blocked for Geega Admin on this device.{" "}
          {isIosDevice()
            ? "Open Settings → Notifications → Geega Admin and turn on Allow Notifications, then come back."
            : "Allow them in your browser's site settings (the icon left of the address bar), then reopen this."}
        </div>
      </div>
    );
  } else if (!device.subscribed) {
    body = (
      <>
        <p>
          Get a notification on this device the moment something needs you — even when Geega Admin
          is closed.
        </p>
        <ul className="gg-pushsettings__list">
          {STAFF_PUSH_KINDS.map((k) => (
            <li key={k.value}>
              <Icon name="check" size={14} /> {k.label}
            </li>
          ))}
        </ul>
        <Button variant="primary" icon="bell" loading={busy === "enable"} onClick={onEnable}>
          Turn on notifications
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <div className="gg-inline-note gg-inline-note--info">
          <Icon name="checkCircle" size={16} />
          <div>Notifications are on for this device.</div>
        </div>
        <fieldset className="gg-pushsettings__kinds" disabled={busy === "kinds"}>
          <legend>Notify me about</legend>
          {STAFF_PUSH_KINDS.map((k) => (
            <label key={k.value} className="gg-pushsettings__kind">
              <input
                type="checkbox"
                checked={device.kinds.includes(k.value)}
                onChange={(e) => void toggleKind(k.value, e.target.checked)}
              />
              <span>
                <strong>{k.label}</strong>
                <span className="gg-card-meta">{k.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="gg-drawer-actions__buttons gg-pushsettings__actions">
          <Button variant="secondary" size="sm" icon="bell" loading={busy === "test"} onClick={onTest}>
            Send a test
          </Button>
          <Button variant="ghost" size="sm" loading={busy === "disable"} onClick={onDisable}>
            Turn off on this device
          </Button>
        </div>
        <SoundSettings native={push.native} />
      </>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Notifications" size="md">
      <div className="gg-pushsettings">
        {body}
        {push.error && (
          <p className="gg-pushsettings__error" role="alert">
            {push.error}
          </p>
        )}

        {!standalone && availability !== "ios-needs-install" && (
          <section className="gg-pushsettings__install">
            <h3>Get the app</h3>
            {push.canInstall ? (
              <>
                <p className="gg-card-meta">
                  Install Geega Admin for its own icon and window, and one tap to open.
                </p>
                <Button variant="secondary" size="sm" icon="download" onClick={() => void push.install()}>
                  Install Geega Admin
                </Button>
              </>
            ) : (
              <p className="gg-card-meta">
                On Android, open the browser menu (⋮) and tap <strong>Install app</strong> or{" "}
                <strong>Add to Home screen</strong>. On a computer, use the install icon in the
                address bar.
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
