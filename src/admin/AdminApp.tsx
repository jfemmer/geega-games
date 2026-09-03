import { useEffect, useMemo } from "react";
import { ToastProvider } from "./components/ui/ToastProvider";
import { AdminLayout } from "./components/layout/AdminLayout";
import { SECTION_TITLES } from "./components/layout/nav";
import { useRouter, adminSection, ADMIN_BASE } from "./hooks/useRouter";
import { OverviewPage } from "./pages/OverviewPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OrdersPage } from "./pages/OrdersPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { UsersPage } from "./pages/UsersPage";
import { TrendsPage } from "./pages/TrendsPage";
import "./admin.css";

export default function AdminApp() {
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
