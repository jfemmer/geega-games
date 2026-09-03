import type { IconName } from "../ui/Icon";
import { ADMIN_BASE } from "../../hooks/useRouter";

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  path: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: "overview", path: ADMIN_BASE },
  {
    key: "inventory",
    label: "Inventory",
    icon: "inventory",
    path: `${ADMIN_BASE}/inventory`,
  },
  { key: "orders", label: "Orders", icon: "orders", path: `${ADMIN_BASE}/orders` },
  {
    key: "announcements",
    label: "Announcements",
    icon: "announcements",
    path: `${ADMIN_BASE}/announcements`,
  },
  { key: "users", label: "Users", icon: "users", path: `${ADMIN_BASE}/users` },
  { key: "trends", label: "Trends", icon: "trends", path: `${ADMIN_BASE}/trends` },
];

export const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  inventory: "Inventory",
  orders: "Orders",
  announcements: "Announcements",
  users: "Users",
  trends: "Trends",
};
