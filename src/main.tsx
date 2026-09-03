import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import ErrorBoundary from "./ErrorBoundary.tsx";

// The storefront and the admin dashboard are separate apps that share a build.
// Anything under /admin loads the admin bundle lazily so storefront visitors
// never download it; everything else renders the storefront.
const AdminApp = lazy(() => import("./admin/AdminApp.tsx"));

const isAdmin = window.location.pathname.startsWith("/admin");

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
