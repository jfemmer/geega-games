import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { CampaignEditor } from "./CampaignEditor";
import { useAsync } from "../hooks/useAsync";
import { campaignRepository } from "../repositories";
import { formatNumber, formatPercent, timeAgo } from "../utils/format";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONE,
  CAMPAIGN_AUDIENCE_LABELS,
} from "../utils/labels";
import type { Campaign } from "../types";

export function AnnouncementsPage() {
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const campaigns = useAsync(() => campaignRepository.list(), []);

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openExisting(c: Campaign) {
    setEditing(c);
    setEditorOpen(true);
  }

  const columns: Column<Campaign>[] = [
    {
      key: "name",
      header: "Campaign",
      render: (c) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{c.name}</span>
          <span className="gg-ordercell__cust">{c.subject}</span>
        </div>
      ),
    },
    {
      key: "audience",
      header: "Audience",
      secondary: true,
      render: (c) => CAMPAIGN_AUDIENCE_LABELS[c.audience],
    },
    {
      key: "recipients",
      header: "Recipients",
      align: "right",
      render: (c) => formatNumber(c.recipientCount),
    },
    {
      key: "open",
      header: "Open rate",
      align: "right",
      secondary: true,
      render: (c) =>
        c.openCount != null && c.deliveredCount > 0
          ? formatPercent((c.openCount / c.deliveredCount) * 100)
          : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <Badge tone={CAMPAIGN_STATUS_TONE[c.status]}>
          {CAMPAIGN_STATUS_LABELS[c.status]}
        </Badge>
      ),
    },
    {
      key: "when",
      header: "Updated",
      align: "right",
      secondary: true,
      render: (c) => timeAgo(c.sentAt ?? c.createdAt),
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Announcements"
        description="Email your players about restocks, sales, and events."
        actions={
          <Button variant="primary" icon="plus" onClick={openNew}>
            New campaign
          </Button>
        }
      />

      <SectionCard title="">
        {campaigns.loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : campaigns.error ? (
          <ErrorState
            message="Could not load campaigns."
            onRetry={campaigns.reload}
          />
        ) : (campaigns.data ?? []).length === 0 ? (
          <EmptyState
            icon="announcements"
            title="No campaigns yet"
            message="Create your first announcement to reach your subscribers."
            action={
              <Button variant="primary" icon="plus" onClick={openNew}>
                New campaign
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={campaigns.data ?? []}
            rowKey={(c) => c.id}
            onRowClick={openExisting}
            caption="Campaigns"
          />
        )}
      </SectionCard>

      <CampaignEditor
        campaign={editing}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => campaigns.reload()}
      />
    </div>
  );
}
