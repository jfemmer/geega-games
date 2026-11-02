import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App, { preloadRoute } from "./App.tsx";
import ErrorBoundary from "./ErrorBoundary.tsx";
import { inject as injectAnalytics } from "@vercel/analytics";

// The storefront and the admin dashboard are separate apps that share a build.
// Anything under /admin loads the admin bundle lazily so storefront visitors
// never download it; everything else renders the storefront.
const AdminApp = lazy(() => import("./admin/AdminApp.tsx"));

const isAdmin = window.location.pathname.startsWith("/admin");

// Vercel Web Analytics (page views, no cookies): the script only reports once
// Web Analytics is switched on for the project in the Vercel dashboard, and
// stays silent in development.
if (!isAdmin && import.meta.env.PROD) injectAnalytics();

// A deploy renames the code files, so a tab opened before it can ask for a page
// that no longer exists. Reload once to pick up the new build instead of
// showing an error; the session flag stops a reload loop if the file is
// really missing.
const RELOAD_FLAG = "gg_chunk_reload";
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        {isAdmin ? (
          <Suspense fallback={null}>
            <AdminApp />
          </Suspense>
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </StrictMode>,
  );
}

// Load this page's code before the first render: mounting replaces the
// prerendered HTML, so the page stays visible until its code is ready rather
// than flashing empty (src/store/lib/lazyPage.tsx). preloadRoute never rejects.
if (isAdmin) mount();
else void preloadRoute(window.location.pathname).then(mount);
