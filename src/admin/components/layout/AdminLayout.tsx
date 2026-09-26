import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { GlobalSearch } from "./GlobalSearch";
import { SECTION_TITLES } from "./nav";
import { orderRepository } from "../../repositories";
import { buyingLeadsRepository } from "../../repositories/buyingLeads.supabase";
import { referralLeadsRepository } from "../../repositories/referralLeads.supabase";
import { useToast } from "../../hooks/useToast";
import { supabase } from "../../../supabase";
import { disablePushForSignOut, syncPushOnOpen } from "../../services/push";
import { handlePushMessage, installSoundUnlock } from "../../services/sounds";
import { NotificationSettingsModal } from "./NotificationSettingsModal";
import { PushPromptBanner } from "./PushPromptBanner";

export function AdminLayout({
  activeKey,
  breadcrumb,
  onNavigate,
  children,
}: {
  activeKey: string;
  breadcrumb: string[];
  onNavigate: (path: string) => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pushSettingsOpen, setPushSettingsOpen] = useState(false);

  // Register the admin service worker, and re-sync this device's push
  // subscription if notifications were on. Never prompts.
  useEffect(() => {
    void syncPushOnOpen();
  }, []);

  // A push arrived while this window is open and visible: the service worker
  // asks us to play that event's own sound (and stays silent itself if we
  // did — see public/admin-sw.js). Audio needs one tap first, so prime it.
  useEffect(() => {
    const cleanupUnlock = installSoundUnlock();
    if (!("serviceWorker" in navigator)) return cleanupUnlock;
    navigator.serviceWorker.addEventListener("message", handlePushMessage);
    navigator.serviceWorker.startMessages();
    return () => {
      cleanupUnlock();
      navigator.serviceWorker.removeEventListener("message", handlePushMessage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    orderRepository.counts().then((c) => {
      if (active) setCounts((prev) => ({ ...prev, ...c }));
    });
    buyingLeadsRepository
      .counts()
      .then((c) => {
        if (active) setCounts((prev) => ({ ...prev, new_leads: c.new ?? 0 }));
      })
      .catch(() => undefined);
    referralLeadsRepository
      .counts()
      .then((c) => {
        if (active) setCounts((prev) => ({ ...prev, new_partner_leads: c.new ?? 0 }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeKey]);

  // "/" opens global search (unless typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (e.key === "/" && !typing && !searchOpen) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const fullBreadcrumb = [
    "Geega Admin",
    ...(breadcrumb.length ? breadcrumb : [SECTION_TITLES[activeKey] ?? "Overview"]),
  ];

  return (
    <div className="gg-admin">
      <Sidebar
        activeKey={activeKey}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        counts={counts}
        onNavigate={onNavigate}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={`gg-main ${collapsed ? "gg-main--collapsed" : ""}`}>
        <TopBar
          breadcrumb={fullBreadcrumb}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleSidebar={() => setMobileOpen((v) => !v)}
          onNavigate={onNavigate}
          onOpenNotificationSettings={() => setPushSettingsOpen(true)}
          onSignOut={async () => {
            // Signed out = this device stops getting store alerts.
            await disablePushForSignOut();
            const { error } = await supabase.auth.signOut();
            if (error) toast.error(error.message);
          }}
        />
        <main className="gg-content" id="gg-content" tabIndex={-1}>
          <PushPromptBanner onOpenSettings={() => setPushSettingsOpen(true)} />
          {children}
        </main>
      </div>
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={onNavigate}
      />
      <NotificationSettingsModal open={pushSettingsOpen} onClose={() => setPushSettingsOpen(false)} />
    </div>
  );
}
