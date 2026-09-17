import type { IconName } from "../ui/Icon";
import { ADMIN_BASE } from "../../hooks/useRouter";
import type { StaffCapability } from "../../permissions";

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  path: string;
  /** Hidden from the sidebar unless the signed-in staff role has this. */
  requires?: StaffCapability;
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
  { key: "pos", label: "Register", icon: "dollar", path: `${ADMIN_BASE}/pos` },
  {
    key: "pickup",
    label: "Pickup Requests",
    icon: "package",
    path: `${ADMIN_BASE}/pickup`,
  },
  {
    key: "scanning",
    label: "Card Scanning",
    icon: "scan",
    path: `${ADMIN_BASE}/scanning`,
  },
  {
    key: "announcements",
    label: "Announcements",
    icon: "announcements",
    path: `${ADMIN_BASE}/announcements`,
  },
  {
    key: "buying-leads",
    label: "Buying Leads",
    icon: "dollar",
    path: `${ADMIN_BASE}/buying-leads`,
  },
  { key: "users", label: "Users", icon: "users", path: `${ADMIN_BASE}/users` },
  { key: "trends", label: "Trends", icon: "trends", path: `${ADMIN_BASE}/trends` },
  {
    key: "audit-log",
    label: "Audit Log",
    icon: "clock",
    path: `${ADMIN_BASE}/audit-log`,
    requires: "audit.view",
  },
];

export const SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  inventory: "Inventory",
  orders: "Orders",
  pos: "Register",
  pickup: "Pickup Requests",
  scanning: "Card Scanning",
  announcements: "Announcements",
  "buying-leads": "Buying Leads",
  users: "Users",
  trends: "Trends",
  "audit-log": "Audit Log",
};
