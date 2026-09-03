import { useCallback, useEffect, useState } from "react";

// A tiny history-based router — enough for the admin dashboard without adding a
// routing dependency. It tracks the pathname and exposes navigate(). The admin
// app lives under /admin_dashboard; /admin redirects to it (see AdminApp).

export const ADMIN_BASE = "/admin_dashboard";

export interface RouterState {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

export function useRouter(): RouterState {
  const [path, setPath] = useState<string>(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      if (opts?.replace) {
        window.history.replaceState({}, "", to);
      } else {
        window.history.pushState({}, "", to);
      }
      setPath(currentPath());
      // Scroll content to top on navigation, mirroring real page loads.
      const main = document.querySelector(".gg-content");
      if (main) main.scrollTop = 0;
    },
    [],
  );

  return { path, navigate };
}

/** The admin route key after the base, e.g. "/admin_dashboard/orders" -> "orders". */
export function adminSection(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  if (clean === ADMIN_BASE || clean === "/admin") return "overview";
  const rest = clean.startsWith(ADMIN_BASE)
    ? clean.slice(ADMIN_BASE.length + 1)
    : "";
  return rest.split("/")[0] || "overview";
}
