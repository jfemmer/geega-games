import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { useClickOutside } from "../../hooks/useClickOutside";
import { timeAgo } from "../../utils/format";
import { useCurrentAdmin } from "../../hooks/useCurrentAdmin";
import { adminFetch } from "../../repositories/apiClient";

/** Up-to-two-letter initials from a display name or email. */
function adminInitials(name: string, email: string | null): string {
  const source = name && name !== "Staff" ? name : (email ?? "");
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return (letters.join("") || "?").toUpperCase();
}

interface Notification {
  key: string;
  kind: "order" | "pickup" | "buying_lead" | "partner_lead" | "scan" | "inventory";
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  detail: string;
  at: string;
  href: string;
  unread: boolean;
}

interface NotificationResponse {
  notifications: Notification[];
  unreadCount: number;
  refreshedAt: string;
}

const NOTIFICATION_ICON: Record<Notification["kind"], Parameters<typeof Icon>[0]["name"]> = {
  order: "orders",
  pickup: "package",
  buying_lead: "dollar",
  partner_lead: "users",
  scan: "scan",
  inventory: "inventory",
};

export function TopBar({
  breadcrumb,
  onOpenSearch,
  onToggleSidebar,
  onNavigate,
  onOpenNotificationSettings,
  onSignOut,
}: {
  breadcrumb: string[];
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onOpenNotificationSettings: () => void;
  onSignOut: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifActionKey, setNotifActionKey] = useState<string | null>(null);
  const admin = useCurrentAdmin();
  const adminName = admin.name;
  const adminEmail = admin.email;
  const initialsLabel = adminInitials(adminName, adminEmail);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  useClickOutside(notifRef, notifOpen, () => setNotifOpen(false));
  useClickOutside(profileRef, profileOpen, () => setProfileOpen(false));

  const unread = notifications.filter((n) => n.unread).length;

  const loadNotifications = useCallback(async (quiet = false) => {
    if (!quiet) setNotifLoading(true);
    try {
      const result = await adminFetch<NotificationResponse>("/api/admin/notifications", {
        method: "GET",
      });
      setNotifications(result.notifications);
      setNotifError(null);
    } catch (err) {
      setNotifError(
        err instanceof Error ? err.message : "Could not load notifications.",
      );
    } finally {
      if (!quiet) setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    if (notifOpen) void loadNotifications(true);
  }, [notifOpen, loadNotifications]);

  async function applyNotificationAction(
    action: "mark_read" | "dismiss" | "mark_all_read",
    key?: string,
  ) {
    setNotifActionKey(key ?? action);
    try {
      const result = await adminFetch<NotificationResponse>("/api/admin/notifications", {
        method: "PATCH",
        body: { action, key },
      });
      setNotifications(result.notifications);
      setNotifError(null);
    } catch (err) {
      setNotifError(
        err instanceof Error ? err.message : "Could not update notifications.",
      );
    } finally {
      setNotifActionKey(null);
    }
  }

  async function openNotification(notification: Notification) {
    if (notification.unread) {
      await applyNotificationAction("mark_read", notification.key);
    }
    setNotifOpen(false);
    onNavigate(notification.href);
  }

  return (
    <header className="gg-topbar">
      <div className="gg-topbar__left">
        <button
          className="gg-icon-btn gg-topbar__menu"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
        >
          <Icon name="menu" size={20} />
        </button>
        <nav className="gg-breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb} className="gg-breadcrumb__item">
              {i > 0 && (
                <Icon
                  name="chevronRight"
                  size={14}
                  className="gg-breadcrumb__sep"
                />
              )}
              <span
                className={
                  i === breadcrumb.length - 1
                    ? "gg-breadcrumb__current"
                    : ""
                }
                aria-current={i === breadcrumb.length - 1 ? "page" : undefined}
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <div className="gg-topbar__right">
        <button
          className="gg-topbar__searchbtn"
          onClick={onOpenSearch}
          aria-label="Open search"
        >
          <Icon name="search" size={16} />
          <span className="gg-topbar__searchhint">Search</span>
          <kbd className="gg-kbd">/</kbd>
        </button>

        <div className="gg-popover-wrap" ref={notifRef}>
          <button
            className="gg-icon-btn gg-topbar__bell"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            aria-expanded={notifOpen}
          >
            <Icon name="bell" size={19} />
            {unread > 0 && <span className="gg-badge-count">{unread}</span>}
          </button>
          {notifOpen && (
            <div className="gg-popover gg-popover--notif" role="menu">
              <header className="gg-popover__head gg-notif-head">
                <span>
                  Notifications
                  {unread > 0 && <span className="gg-notif-head__count">{unread}</span>}
                </span>
                {unread > 0 && (
                  <button
                    className="gg-notif-head__action"
                    type="button"
                    disabled={notifActionKey === "mark_all_read"}
                    onClick={() => void applyNotificationAction("mark_all_read")}
                  >
                    Mark all read
                  </button>
                )}
              </header>

              {notifLoading ? (
                <div className="gg-notif-state">Loading notifications…</div>
              ) : notifError && notifications.length === 0 ? (
                <div className="gg-notif-state gg-notif-state--error">
                  <span>{notifError}</span>
                  <button type="button" onClick={() => void loadNotifications()}>
                    Retry
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="gg-notif-state">
                  <Icon name="checkCircle" size={22} />
                  <strong>You’re caught up</strong>
                  <span>Nothing needs your attention right now.</span>
                </div>
              ) : (
                <>
                  {notifError && (
                    <div className="gg-notif-inline-error">{notifError}</div>
                  )}
                  <ul className="gg-notif-list">
                    {notifications.map((n) => (
                      <li
                        key={n.key}
                        className={`gg-notif gg-notif--${n.tone} ${n.unread ? "gg-notif--unread" : ""}`}
                      >
                        <button
                          type="button"
                          className="gg-notif__open"
                          onClick={() => void openNotification(n)}
                        >
                          <span className="gg-notif__icon">
                            <Icon name={NOTIFICATION_ICON[n.kind]} size={16} />
                          </span>
                          <span className="gg-notif__body">
                            <span className="gg-notif__title">{n.title}</span>
                            <span className="gg-notif__detail">{n.detail}</span>
                            <span className="gg-notif__time">{timeAgo(n.at)}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="gg-notif__dismiss"
                          aria-label={`Dismiss ${n.title}`}
                          title="Dismiss"
                          disabled={notifActionKey === n.key}
                          onClick={() => void applyNotificationAction("dismiss", n.key)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button
                type="button"
                className="gg-notif-footer"
                onClick={() => {
                  setNotifOpen(false);
                  onOpenNotificationSettings();
                }}
              >
                <Icon name="settings" size={14} /> Notifications on this device
              </button>
            </div>
          )}
        </div>

        <div className="gg-popover-wrap" ref={profileRef}>
          <button
            className="gg-profile-btn"
            onClick={() => setProfileOpen((v) => !v)}
            aria-label="Account menu"
            aria-expanded={profileOpen}
          >
            <span className="gg-avatar">{initialsLabel}</span>
            <span className="gg-profile-btn__name">{adminName}</span>
            <Icon name="chevronDown" size={15} />
          </button>
          {profileOpen && (
            <div className="gg-popover gg-popover--profile" role="menu">
              <div className="gg-popover__profilehead">
                <span className="gg-avatar gg-avatar--lg">
                  {initialsLabel}
                </span>
                <div>
                  <div className="gg-popover__name">{adminName}</div>
                  <div className="gg-popover__email">{adminEmail ?? "—"}</div>
                </div>
              </div>
              <button className="gg-popover__item" role="menuitem">
                <Icon name="user" size={16} /> Profile
              </button>
              <button className="gg-popover__item" role="menuitem">
                <Icon name="settings" size={16} /> Settings
              </button>
              <button
                className="gg-popover__item"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenNotificationSettings();
                }}
              >
                <Icon name="bell" size={16} /> Push notifications
              </button>
              <button
                className="gg-popover__item gg-popover__item--danger"
                role="menuitem"
                onClick={onSignOut}
              >
                <Icon name="logout" size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}