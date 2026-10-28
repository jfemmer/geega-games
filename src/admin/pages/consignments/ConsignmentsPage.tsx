import { useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { ErrorState, Spinner } from "../../components/ui/States";
import { PayoutEstimator } from "../../../store/components/consignment/PayoutEstimator";
import { useEstimatorConfig } from "../../../store/lib/consignmentApi";
import { ConsignmentSettingsPanel } from "./ConsignmentSettingsPanel";
import { ConsignmentListPanel } from "./ConsignmentListPanel";
import { ConsignmentDetailPanel } from "./ConsignmentDetailPanel";
import { NewConsignmentForm } from "./NewConsignmentForm";
import { AgreementVersionsPanel } from "./AgreementVersionsPanel";
import { ADMIN_BASE } from "../../hooks/useRouter";

// Admin > Consignments: consignments and their agreements, the agreement's
// versions, the Payout Estimator and Consignment Settings. Receiving, sales
// and payouts arrive in the next phases.

type Tab = "consignments" | "agreement" | "estimator" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "consignments", label: "Consignments" },
  { key: "agreement", label: "Agreement" },
  { key: "estimator", label: "Payout estimator" },
  { key: "settings", label: "Settings" },
];
const isTab = (t: string | null): t is Tab => TABS.some((x) => x.key === t);

export function ConsignmentsPage({ query, onNavigate }: { query: URLSearchParams; onNavigate: (path: string) => void }) {
  const rawTab = query.get("tab");
  const tab: Tab = isTab(rawTab) ? rawTab : "consignments";
  const openId = query.get("id");
  const creating = query.get("new") === "1";
  const [reloadKey, setReloadKey] = useState(0);
  const config = useEstimatorConfig(reloadKey);
  const base = `${ADMIN_BASE}/consignments`;

  function go(next: Tab, extra = "") {
    onNavigate(next === "consignments" ? `${base}${extra ? `?${extra}` : ""}` : `${base}?tab=${next}${extra ? `&${extra}` : ""}`);
  }

  return (
    <div className="gg-page">
      <PageHeader
        title="Consignments"
        description="Sell consignors' cards for a commission. Consigned cards are sale-only: they're never available for trades."
      />

      <div className="gg-tabs" role="tablist" aria-label="Consignments">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "gg-tab gg-tab--active" : "gg-tab"}
            onClick={() => go(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "consignments" &&
        (creating ? (
          <NewConsignmentForm onCreated={(id) => go("consignments", `id=${id}`)} onCancel={() => go("consignments")} />
        ) : openId ? (
          <ConsignmentDetailPanel id={openId} onBack={() => go("consignments")} onChanged={() => setReloadKey((k) => k + 1)} />
        ) : (
          <ConsignmentListPanel reloadKey={reloadKey} onOpen={(id) => go("consignments", `id=${id}`)} onNew={() => go("consignments", "new=1")} />
        ))}

      {tab === "agreement" && <AgreementVersionsPanel />}

      {tab === "estimator" && (
        <SectionCard title="Consignment Payout Estimator">
          {config.status === "loading" ? (
            <Spinner label="Loading rates" />
          ) : config.status === "error" ? (
            <ErrorState message={config.message} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <PayoutEstimator key={reloadKey} config={config.config} />
          )}
        </SectionCard>
      )}

      {tab === "settings" && <ConsignmentSettingsPanel onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}

export default ConsignmentsPage;
