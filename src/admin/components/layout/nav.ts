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
  {
    key: "partner-leads",
    label: "Partner Leads",
    icon: "users",
    path: `${ADMIN_BASE}/partner-leads`,
  },
  { key: "users", label: "Users", icon: "users", path: `${ADMIN_BASE}/users` },
  { key: "trends", label: "Trends", icon: "trends", path: `${ADMIN_BASE}/trends` },
  {
    key: "market-insights",
    label: "Market Insights",
    icon: "layers",
    path: `${ADMIN_BASE}/market-insights`,
  },
  {
    key: "sale",
    label: "Storewide Sale",
    icon: "sparkle",
    path: `${ADMIN_BASE}/sale`,
  },
  {
    key: "vacation",
    label: "Vacation Mode",
    icon: "pause",
    path: `${ADMIN_BASE}/vacation`,
  },
  {
    key: "audit-log",
    label: "Audit Log",
    icon: "clock",
    path: `${ADMIN_BASE}/audit-log`,
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
  "partner-leads": "Partner Leads",
  users: "Users",
  trends: "Trends",
  "market-insights": "Market Insights",
  sale: "Storewide Sale",
  vacation: "Vacation Mode",
  "audit-log": "Audit Log",
};
