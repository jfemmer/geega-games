import { useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { ErrorState, Spinner } from "../../components/ui/States";
import { PayoutEstimator } from "../../../store/components/consignment/PayoutEstimator";
import { useEstimatorConfig } from "../../../store/lib/consignmentApi";
import { ConsignmentSettingsPanel } from "./ConsignmentSettingsPanel";
import { ADMIN_BASE } from "../../hooks/useRouter";

// Admin > Consignments. Phase 1 has the Payout Estimator and Consignment
// Settings; consignors, agreements, receiving, sales and payouts arrive in
// the next phases, each as its own tab here.

type Tab = "estimator" | "settings";
const TABS: { key: Tab; label: string }[] = [
  { key: "estimator", label: "Payout estimator" },
  { key: "settings", label: "Settings" },
];

export function ConsignmentsPage({ query, onNavigate }: { query: URLSearchParams; onNavigate: (path: string) => void }) {
  const tab: Tab = query.get("tab") === "settings" ? "settings" : "estimator";
  const [reloadKey, setReloadKey] = useState(0);
  const config = useEstimatorConfig(reloadKey);

  function go(next: Tab) {
    const base = `${ADMIN_BASE}/consignments`;
    onNavigate(next === "estimator" ? base : `${base}?tab=${next}`);
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

      {tab === "estimator" ? (
        <SectionCard title="Consignment Payout Estimator">
          {config.status === "loading" ? (
            <Spinner label="Loading rates" />
          ) : config.status === "error" ? (
            <ErrorState message={config.message} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <PayoutEstimator key={reloadKey} config={config.config} />
          )}
        </SectionCard>
      ) : (
        <ConsignmentSettingsPanel onChanged={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}

export default ConsignmentsPage;
