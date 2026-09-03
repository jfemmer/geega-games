import { Icon } from "../ui/Icon";
import { NAV_ITEMS } from "./nav";

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
            const badge =
              item.key === "orders" ? counts.needs_packing : undefined;
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
