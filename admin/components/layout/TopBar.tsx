import { useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { useClickOutside } from "../../hooks/useClickOutside";
import { timeAgo } from "../../utils/format";
import { CURRENT_ADMIN } from "../../data/session.mock";

interface Notification {
  id: string;
  title: string;
  detail: string;
  at: string;
  unread: boolean;
}

const NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    title: "2 orders need packing",
    detail: "GG-1042 and GG-1041 are paid and waiting.",
    at: new Date(Date.now() - 6 * 3600000).toISOString(),
    unread: true,
  },
  {
    id: "n2",
    title: "Low stock: 4 cards",
    detail: "Fable of the Mirror-Breaker is out of stock.",
    at: new Date(Date.now() - 20 * 3600000).toISOString(),
    unread: true,
  },
  {
    id: "n3",
    title: "Campaign sending",
    detail: "Weekend Commander sale is in progress.",
    at: new Date(Date.now() - 26 * 3600000).toISOString(),
    unread: false,
  },
];

export function TopBar({
  breadcrumb,
  onOpenSearch,
  onToggleSidebar,
  onSignOut,
}: {
  breadcrumb: string[];
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onSignOut: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  useClickOutside(notifRef, notifOpen, () => setNotifOpen(false));
  useClickOutside(profileRef, profileOpen, () => setProfileOpen(false));

  const unread = NOTIFICATIONS.filter((n) => n.unread).length;

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
              <header className="gg-popover__head">Notifications</header>
              <ul className="gg-notif-list">
                {NOTIFICATIONS.map((n) => (
                  <li
                    key={n.id}
                    className={`gg-notif ${n.unread ? "gg-notif--unread" : ""}`}
                  >
                    <div className="gg-notif__title">{n.title}</div>
                    <div className="gg-notif__detail">{n.detail}</div>
                    <div className="gg-notif__time">{timeAgo(n.at)}</div>
                  </li>
                ))}
              </ul>
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
            <span className="gg-avatar">{CURRENT_ADMIN.initials}</span>
            <span className="gg-profile-btn__name">{CURRENT_ADMIN.name}</span>
            <Icon name="chevronDown" size={15} />
          </button>
          {profileOpen && (
            <div className="gg-popover gg-popover--profile" role="menu">
              <div className="gg-popover__profilehead">
                <span className="gg-avatar gg-avatar--lg">
                  {CURRENT_ADMIN.initials}
                </span>
                <div>
                  <div className="gg-popover__name">{CURRENT_ADMIN.name}</div>
                  <div className="gg-popover__email">{CURRENT_ADMIN.email}</div>
                </div>
              </div>
              <button className="gg-popover__item" role="menuitem">
                <Icon name="user" size={16} /> Profile
              </button>
              <button className="gg-popover__item" role="menuitem">
                <Icon name="settings" size={16} /> Settings
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
