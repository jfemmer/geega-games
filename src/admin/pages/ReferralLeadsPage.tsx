import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Modal } from "../components/ui/Modal";
import { SearchInput, SelectField } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { PARTNER_LINK_DAYS, referralLeadsRepository } from "../repositories/referralLeads.supabase";
import { formatDateTime } from "../utils/format";
import { REFERRAL_LEAD_STATUS_TONE } from "../utils/labels";
import type { ReferralLead, ReferralLeadStatus } from "../types";
import {
  REFERRAL_CONTACT_METHODS,
  REFERRAL_HANDOFF_OPTIONS,
  REFERRAL_LEAD_STATUSES,
  REFERRAL_SIZE_OPTIONS,
  optionLabel,
  referralCategoryLabel,
} from "../../store/lib/referralTypes";

// Partner Leads: Pokémon / One Piece / video game sellers from
// /sell-pokemon-cards, /sell-one-piece-cards and /sell-video-games, who
// asked to be connected with the buying partner. Each one also arrives as a
// "New referral lead" email written to be forwarded as-is; this page is the
// record of what has been passed on (New → Sent to partner → Closed).

type TabKey = "all" | ReferralLeadStatus;

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  ...REFERRAL_LEAD_STATUSES.map((s) => ({ key: s.value, label: s.label })),
];

function statusLabel(status: ReferralLeadStatus): string {
  return optionLabel(REFERRAL_LEAD_STATUSES, status) ?? status;
}

function sellerName(lead: ReferralLead): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ");
}

function handoffLabel(handoff: string): string {
  return handoff === "not_sure" ? "Not sure yet" : (optionLabel(REFERRAL_HANDOFF_OPTIONS, handoff) ?? handoff);
}

function contactLabel(method: string): string {
  return optionLabel(REFERRAL_CONTACT_METHODS, method) ?? method;
}

/** Plain-text summary to paste into a text or email to the buying partner. */
function partnerText(lead: ReferralLead, photoUrls: string[]): string {
  const lines = [
    `${lead.categories.map(referralCategoryLabel).join(", ")} — ${lead.referenceNumber}`,
    "",
    `Name: ${sellerName(lead)}`,
    `Email: ${lead.email}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    `Best way to reach them: ${contactLabel(lead.preferredContactMethod)}`,
    lead.location ? `Location: ${lead.location}` : null,
    `Meet up or ship: ${handoffLabel(lead.handoff)}`,
    lead.collectionSize ? `How much: ${optionLabel(REFERRAL_SIZE_OPTIONS, lead.collectionSize)}` : null,
    "",
    "What they have:",
    lead.description,
  ];
  if (photoUrls.length > 0) {
    lines.push("", `Photos (links work for ${PARTNER_LINK_DAYS} days):`, ...photoUrls);
  }
  return lines.filter((line) => line !== null).join("\n");
}

export function ReferralLeadsPage({ query }: { query: URLSearchParams }) {
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ReferralLead | null>(null);
  // ?lead=<id> opens that lead from the list until it's closed.
  const [deepLinkId, setDeepLinkId] = useState(() => query.get("lead"));

  const repoQuery = useMemo(() => ({ status: tab, search: search.trim() || undefined }), [tab, search]);
  const leads = useAsync(() => referralLeadsRepository.list(repoQuery), [repoQuery]);
  const rows = useMemo(() => leads.data ?? [], [leads.data]);

  useEffect(() => {
    referralLeadsRepository.counts().then(setCounts).catch(() => undefined);
  }, [leads.data]);

  const openLead = selected ?? (deepLinkId ? (rows.find((l) => l.id === deepLinkId) ?? null) : null);

  const columns: Column<ReferralLead>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (l) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {l.status === "new" && <span className="gg-newdot" aria-hidden="true" />}
            {l.referenceNumber}
          </span>
          <span className="gg-ordercell__cust">{sellerName(l)}</span>
        </div>
      ),
    },
    {
      key: "what",
      header: "Selling",
      render: (l) => l.categories.map(referralCategoryLabel).join(", "),
    },
    {
      key: "date",
      header: "Date",
      secondary: true,
      render: (l) => formatDateTime(l.createdAt),
    },
    {
      key: "handoff",
      header: "Meet or ship",
      secondary: true,
      render: (l) => handoffLabel(l.handoff),
    },
    {
      key: "location",
      header: "Location",
      secondary: true,
      render: (l) => l.location || "—",
    },
    {
      key: "photos",
      header: "Photos",
      align: "right",
      secondary: true,
      render: (l) => (l.photoPaths.length > 0 ? l.photoPaths.length : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (l) => <Badge tone={REFERRAL_LEAD_STATUS_TONE[l.status]}>{statusLabel(l.status)}</Badge>,
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Partner Leads"
        description="Pokémon, One Piece and video game sellers to pass on to our buying partner."
      />

      <SectionCard title="Leads">
        <div className="gg-toolbar">
          <SearchInput
            label="Search partner leads"
            placeholder="Name, email, phone, reference or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs
          ariaLabel="Filter partner leads"
          active={tab}
          onChange={(k) => setTab(k as TabKey)}
          items={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
        />

        {leads.loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : leads.error ? (
          <ErrorState message="Could not load partner leads." onRetry={leads.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="users"
            title="No leads match this filter"
            message="Sellers from the Pokémon, One Piece and video game pages will appear here."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(l) => l.id}
            onRowClick={(l) => setSelected(l)}
            caption="Partner leads"
          />
        )}
      </SectionCard>

      <ReferralLeadDrawer
        lead={openLead}
        onClose={() => {
          setSelected(null);
          setDeepLinkId(null);
        }}
        onStatusChanged={(status) => {
          // Keep the drawer open even if the new status filters it out of the list.
          if (openLead) setSelected({ ...openLead, status });
          leads.reload();
        }}
      />
    </div>
  );
}

function ReferralLeadDrawer({
  lead,
  onClose,
  onStatusChanged,
}: {
  lead: ReferralLead | null;
  onClose: () => void;
  onStatusChanged: (status: ReferralLeadStatus) => void;
}) {
  const toast = useToast();
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [copying, setCopying] = useState(false);

  const leadId = lead?.id;
  const photoPaths = lead?.photoPaths;
  useEffect(() => {
    setPhotoUrls([]);
    if (!photoPaths || photoPaths.length === 0) return;
    let cancelled = false;
    setPhotosLoading(true);
    referralLeadsRepository
      .photoUrls(photoPaths)
      .then((urls) => {
        if (!cancelled) setPhotoUrls(urls);
      })
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-sign only when a different lead opens, not when its status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (!lead) return null;

  const name = sellerName(lead);
  const emailSubject = encodeURIComponent(`Your Geega Games request ${lead.referenceNumber}`);

  async function changeStatus(status: ReferralLeadStatus) {
    if (!lead || status === lead.status) return;
    setSavingStatus(true);
    try {
      await referralLeadsRepository.setStatus(lead.id, status);
      onStatusChanged(status);
      toast.success(`Marked ${statusLabel(status).toLowerCase()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function copyForPartner() {
    if (!lead) return;
    setCopying(true);
    try {
      // Longer-lived links than the drawer's, since the partner may open them later.
      const urls = await referralLeadsRepository.photoUrls(lead.photoPaths, PARTNER_LINK_DAYS * 24 * 60 * 60);
      await navigator.clipboard.writeText(partnerText(lead, urls));
      toast.success(
        lead.status === "new"
          ? "Copied. Mark it “Sent to partner” once you've passed it on."
          : "Copied lead details.",
      );
    } catch {
      toast.error("Couldn't copy to the clipboard. Forward the new-lead email instead.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Lead ${lead.referenceNumber}`} variant="drawer" size="lg">
      <div className="gg-leaddetail">
        <section className="gg-leaddetail__section">
          <h3>Seller</h3>
          <p>
            <strong>{name}</strong>{" "}
            <Badge tone={REFERRAL_LEAD_STATUS_TONE[lead.status]}>{statusLabel(lead.status)}</Badge>
          </p>
          <p className="gg-card-meta">Submitted {formatDateTime(lead.createdAt)}</p>
          <div className="gg-leaddetail__contactlinks">
            <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`mailto:${lead.email}?subject=${emailSubject}`}>
              <Icon name="mail" size={14} /> {lead.email}
            </a>
            {lead.phone && (
              <>
                <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`tel:${lead.phone}`}>
                  Call {lead.phone}
                </a>
                <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`sms:${lead.phone}`}>
                  Text {lead.phone}
                </a>
              </>
            )}
          </div>
          <p className="gg-card-meta">
            Prefers {contactLabel(lead.preferredContactMethod)}
            {lead.location ? ` · ${lead.location}` : ""}
          </p>
          <p className="gg-card-meta">Meet up or ship: {handoffLabel(lead.handoff)}</p>
        </section>

        <section className="gg-leaddetail__section">
          <h3>What they have</h3>
          <p>
            {lead.categories.map((c, i) => (
              <Fragment key={c}>
                {i > 0 && " "}
                <Badge tone="info">{referralCategoryLabel(c)}</Badge>
              </Fragment>
            ))}
            {lead.collectionSize && (
              <span className="gg-card-meta"> · {optionLabel(REFERRAL_SIZE_OPTIONS, lead.collectionSize)}</span>
            )}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{lead.description}</p>
        </section>

        {lead.photoPaths.length > 0 && (
          <section className="gg-leaddetail__section">
            <h3>Photos ({lead.photoPaths.length})</h3>
            {photosLoading ? (
              <p className="gg-card-meta">Loading photos…</p>
            ) : photoUrls.length === 0 ? (
              <p className="gg-card-meta">Couldn&rsquo;t load the photos. Close and reopen to try again.</p>
            ) : (
              <ul className="gg-leaddetail__photos">
                {photoUrls.map((url, i) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt={`Photo ${i + 1}`} loading="lazy" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="gg-leaddetail__section gg-leaddetail__internal">
          <h3>Pass it on</h3>
          <div className="gg-inline-note gg-inline-note--info">
            <Icon name="checkCircle" size={16} />
            <div>
              Agreed to have their details shared with our buying partner on{" "}
              {formatDateTime(lead.consentToShareAt)}
              {lead.sourcePath ? ` (from ${lead.sourcePath})` : ""}.
            </div>
          </div>
          <div className="gg-form-grid">
            <SelectField
              label="Status"
              value={lead.status}
              disabled={savingStatus}
              onChange={(e) => void changeStatus(e.target.value as ReferralLeadStatus)}
            >
              {REFERRAL_LEAD_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="gg-drawer-actions__buttons">
            <Button variant="secondary" size="sm" icon="copy" loading={copying} onClick={copyForPartner}>
              Copy details for partner
            </Button>
            {lead.status === "new" && (
              <Button
                variant="primary"
                size="sm"
                loading={savingStatus}
                onClick={() => void changeStatus("sent_to_partner")}
              >
                Mark sent to partner
              </Button>
            )}
          </div>
          <p className="gg-card-meta">
            The new-lead email is written to be forwarded as-is, or copy the details here to text them.
            Photo links in the copied text work for {PARTNER_LINK_DAYS} days.
          </p>
        </section>
      </div>
    </Modal>
  );
}
