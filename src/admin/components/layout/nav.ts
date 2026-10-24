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
    key: "trade-evaluator",
    label: "Trade Evaluator",
    icon: "swap",
    path: `${ADMIN_BASE}/trade-evaluator`,
  },
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
    key: "sorting",
    label: "Collection Sorting",
    icon: "layers",
    path: `${ADMIN_BASE}/sorting`,
  },
  {
    key: "partner-leads",
    label: "Partner Leads",
    icon: "users",
    path: `${ADMIN_BASE}/partner-leads`,
  },
  {
    key: "partners",
    label: "Partners",
    icon: "store",
    path: `${ADMIN_BASE}/partners`,
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "qr",
    path: `${ADMIN_BASE}/marketing`,
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
    key: "yard-sale",
    label: "Yard Sale Mode",
    icon: "tag",
    path: `${ADMIN_BASE}/yard-sale`,
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
  "trade-evaluator": "Trade Evaluator",
  pickup: "Pickup Requests",
  scanning: "Card Scanning",
  announcements: "Announcements",
  "buying-leads": "Buying Leads",
  sorting: "Collection Sorting",
  "partner-leads": "Partner Leads",
  partners: "Partners",
  marketing: "Marketing",
  users: "Users",
  trends: "Trends",
  "market-insights": "Market Insights",
  sale: "Storewide Sale",
  "yard-sale": "Yard Sale Mode",
  vacation: "Vacation Mode",
  "audit-log": "Audit Log",
};
