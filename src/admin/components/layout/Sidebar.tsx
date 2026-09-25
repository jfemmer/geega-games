import { Icon } from "../ui/Icon";
import { NAV_ITEMS } from "./nav";

/** Which `counts` key, if any, badges each nav item. */
const NAV_BADGE_COUNT_KEY: Partial<Record<(typeof NAV_ITEMS)[number]["key"], string>> = {
  orders: "needs_packing",
  "buying-leads": "new_leads",
  "partner-leads": "new_partner_leads",
};

export function Sidebar({
  activeKey,
  collapsed,
  mobileOpen,
  counts,
  onNavigate,
  onToggleCollapse,
  onCloseMobile,
}: {
  activeKey: string;
  collapsed: boolean;
  mobileOpen: boolean;
  counts: Record<string, number>;
  onNavigate: (path: string) => void;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {mobileOpen && (
        <div
          className="gg-sidebar__scrim"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={[
          "gg-sidebar",
          collapsed ? "gg-sidebar--collapsed" : "",
          mobileOpen ? "gg-sidebar--mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Primary"
      >
        <div className="gg-sidebar__brand">
          <img
            src="/logo.png"
            alt="Geega Games"
            className="gg-sidebar__logo"
            width={40}
            height={35}
          />
          {!collapsed && (
            <span className="gg-sidebar__wordmark">
              Geega <span className="gg-sidebar__wordmark-admin">Admin</span>
            </span>
          )}
        </div>

        <nav className="gg-sidebar__nav">
          {NAV_ITEMS.map((item) => {
            const badgeKey = NAV_BADGE_COUNT_KEY[item.key];
            const badge = badgeKey ? counts[badgeKey] : undefined;
            const active = activeKey === item.key;
            return (
              <button
                key={item.key}
                className={`gg-navlink ${active ? "gg-navlink--active" : ""}`}
                onClick={() => {
                  onNavigate(item.path);
                  onCloseMobile();
                }}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <span className="gg-navlink__icon">
                  <Icon name={item.icon} size={20} />
                </span>
                {!collapsed && (
                  <span className="gg-navlink__label">{item.label}</span>
                )}
                {badge !== undefined && badge > 0 && (
                  <span
                    className={`gg-navlink__badge ${
                      collapsed ? "gg-navlink__badge--dot" : ""
                    }`}
                  >
                    {collapsed ? "" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          className="gg-sidebar__collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={18} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
    </>
  );
}
