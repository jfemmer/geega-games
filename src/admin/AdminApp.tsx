import { useEffect, useMemo } from "react";
import { ToastProvider } from "./components/ui/ToastProvider";
import { AdminLayout } from "./components/layout/AdminLayout";
import { AdminAuthGate } from "./components/auth/AdminAuthGate";
import { SECTION_TITLES } from "./components/layout/nav";
import { useRouter, adminSection, ADMIN_BASE } from "./hooks/useRouter";
import { OverviewPage } from "./pages/OverviewPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ScanSessionsPage } from "./pages/scan/ScanSessionsPage";
import { ScanReviewPage } from "./pages/scan/ScanReviewPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { UsersPage } from "./pages/UsersPage";
import { TrendsPage } from "./pages/TrendsPage";
import "./admin.css";

// The dashboard itself is only rendered once AdminAuthGate confirms a signed-in
// admin/staff user. The gate handles login, the not-authorized state, and
// loading; server endpoints re-check the role, so access control does not rely
// on the client alone.
export default function AdminApp() {
  return (
    <AdminAuthGate>
      <AdminDashboard />
    </AdminAuthGate>
  );
}

function AdminDashboard() {
  const { path, navigate } = useRouter();

  // Normalise /admin -> /admin_dashboard once.
  useEffect(() => {
    const clean = path.split("?")[0].replace(/\/+$/, "");
    if (clean === "/admin") {
      navigate(ADMIN_BASE + window.location.search, { replace: true });
    }
  }, [path, navigate]);

  const section = adminSection(path);
  const query = useMemo(() => {
    const qIndex = path.indexOf("?");
    return new URLSearchParams(qIndex >= 0 ? path.slice(qIndex) : "");
  }, [path]);

  const breadcrumb = [SECTION_TITLES[section] ?? "Overview"];

  function renderPage() {
    switch (section) {
      case "inventory":
        return <InventoryPage query={query} onNavigate={navigate} />;
      case "orders":
        return <OrdersPage query={query} onNavigate={navigate} />;
      case "scanning": {
        // /scanning or /scanning/:sessionId
        const clean = path.split("?")[0].replace(/\/+$/, "");
        const rest = clean.startsWith(ADMIN_BASE)
          ? clean.slice(ADMIN_BASE.length + 1)
          : "";
        const parts = rest.split("/");
        const sessionId = parts[1];
        return sessionId ? (
          <ScanReviewPage sessionId={sessionId} onNavigate={navigate} />
        ) : (
          <ScanSessionsPage onNavigate={navigate} />
        );
      }
      case "announcements":
        return <AnnouncementsPage />;
      case "users":
        return <UsersPage query={query} />;
      case "trends":
        return <TrendsPage />;
      case "overview":
      default:
        return <OverviewPage onNavigate={navigate} />;
    }
  }

  return (
    <ToastProvider>
      <AdminLayout
        activeKey={section}
        breadcrumb={breadcrumb}
        onNavigate={navigate}
      >
        {renderPage()}
      </AdminLayout>
    </ToastProvider>
  );
}