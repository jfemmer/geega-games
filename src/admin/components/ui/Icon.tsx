// A tiny, dependency-free icon set. Each icon is a 24x24 stroked path so the
// whole interface shares one visual language without pulling in an icon library.

export type IconName =
  | "overview"
  | "inventory"
  | "orders"
  | "announcements"
  | "users"
  | "trends"
  | "search"
  | "bell"
  | "menu"
  | "close"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "plus"
  | "check"
  | "checkCircle"
  | "alert"
  | "info"
  | "warning"
  | "trash"
  | "edit"
  | "download"
  | "upload"
  | "copy"
  | "external"
  | "filter"
  | "sort"
  | "package"
  | "truck"
  | "mail"
  | "user"
  | "logout"
  | "settings"
  | "eye"
  | "dollar"
  | "box"
  | "clock"
  | "arrowUp"
  | "arrowDown"
  | "sparkle";

const PATHS: Record<IconName, string> = {
  overview:
    "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  inventory:
    "M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10",
  orders:
    "M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h6",
  announcements:
    "M3 11v2l14 5V6L3 11Zm0 0H2a1 1 0 0 0-1 1M17 8a4 4 0 0 1 0 8M7 13v6",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11",
  trends:
    "M3 3v18h18M7 15l4-4 3 3 5-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  bell:
    "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M18 6 6 18M6 6l12 12",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "M20 6 9 17l-5-5",
  checkCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-10 2 2 4-4",
  alert: "M12 2 1 21h22L12 2Zm0 7v5m0 4h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-5m0-3h.01",
  warning: "M12 2 1 21h22L12 2Zm0 7v5m0 4h.01",
  trash:
    "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6h14M10 11v6M14 11v6",
  edit:
    "M11 4H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z",
  download: "M21 15v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4M17 8l-5-5-5 5M12 3v12",
  copy:
    "M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1",
  external: "M15 3h6v6M10 14 21 3M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3Z",
  sort: "M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4",
  package:
    "m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8ZM3.3 7l8.7 5 8.7-5M12 22V12",
  truck:
    "M1 3h15v13H1V3Zm15 5h4l3 3v5h-7V8ZM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm12 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  mail: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 2 8 6 8-6",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  logout: "M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.5-2.4 1a7.3 7.3 0 0 0-2.2-1.3l-.4-2.5h-4l-.4 2.5a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.5 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.5 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.5-2-1.6c.06-.43.1-.86.1-1.3Z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  dollar: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  box: "M3 3h18v18H3V3Zm0 6h18M9 3v18",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  sparkle: "M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1L12 2Z",
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Icons are decorative by default; give a title to make them announced. */
  title?: string;
}

export function Icon({ name, size = 18, className, title }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
