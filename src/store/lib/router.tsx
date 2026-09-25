import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// A tiny History-API router. We avoid react-router to keep the storefront
// bundle lean (the task explicitly discourages a large routing dependency).
// Deep links work because vercel.json rewrites all non-/admin, non-/api paths
// to index.html, so the browser loads the SPA and we read location.pathname.

type RouterContextValue = {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({
  children,
  initialPath,
}: {
  children: ReactNode;
  /**
   * Build-time prerendering only (scripts/prerender.ts), where there is no
   * window to read the location from. The browser always omits this.
   */
  initialPath?: string;
}) {
  const [path, setPath] = useState(() => initialPath ?? (window.location.pathname || "/"));
  const [search, setSearch] = useState(() => (initialPath !== undefined ? "" : window.location.search));

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname || "/");
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      const [toPath, toSearch = ""] = to.split("?");
      const url = toSearch ? `${toPath}?${toSearch}` : toPath;
      if (opts?.replace) {
        window.history.replaceState({}, "", url);
      } else {
        window.history.pushState({}, "", url);
      }
      setPath(toPath || "/");
      setSearch(toSearch ? `?${toSearch}` : "");
      // Scroll to top on navigation, matching normal page-nav expectations,
      // unless the user prefers reduced motion (then jump without smoothing).
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    },
    [],
  );

  const value = useMemo<RouterContextValue>(
    () => ({
      path,
      query: new URLSearchParams(search),
      navigate,
    }),
    [path, search, navigate],
  );

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within RouterProvider");
  return ctx;
}

/**
 * Accessible internal link. Left-click navigates via the History API;
 * modifier-clicks and middle-clicks fall through to the browser so
 * open-in-new-tab keeps working.
 */
export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Match a route pattern like "/account/orders/:id" against a path. */
export function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) {
      params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    } else if (pp[i] !== ap[i]) {
      return null;
    }
  }
  return params;
}
