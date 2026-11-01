import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
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
