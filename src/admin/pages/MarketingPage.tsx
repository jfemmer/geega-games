import { useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard, StatCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/States";
import { QrCode } from "../components/partners/QrCode";
import { downloadQrPng, downloadQrSvg } from "../utils/qrCode";
import { FlyerPrintView, type FlyerLayout } from "../components/partners/FlyerPrintView";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { leadSourcesRepository, partnersRepository } from "../repositories/partners.supabase";
import {
  DEFAULT_MARKETING_PAGE,
  MARKETING_PAGES,
  YARD_SALE_MARKETING_KEY,
  daysAgoIso,
  marketingLink,
  marketingPage,
  printedAddress,
  qrFileName,
  summarizeLeadSources,
  yardSaleFlyerCopy,
  type LeadSourceSummary,
} from "../utils/marketing";
import { yardSaleRepository } from "../repositories/yardSale.supabase";
import { SOURCE_PRESETS, cleanCampaignToken, sourceLabel } from "../../store/lib/attribution";

// Marketing: make a tagged link and QR code for wherever sellers will see it
// (a card show table, a flyer, a Facebook group, a partner's estate sale),
// print a flyer or table sign with it, and see which sources bring in leads.
//
// Every lead stores the tags of the link the seller came in on (and a
// referral partner's code, if the link carries one), so the counts below and
// each lead's "Where they came from" say which flyer, show or post it was.
// Links always use the live geega-games.com address, even from a preview
// deployment, since they're for printing and posting.

/** "Where you'll use it" choices that aren't one of the presets. */
const CUSTOM_SOURCE = "custom";
const NO_SOURCE = "none";

type RangeKey = "30" | "90" | "365";

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
];

/** The phone's share sheet (iPhone, Android, most desktop browsers but Firefox). */
function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function MarketingPage() {
  const toast = useToast();
  const partners = useAsync(() => partnersRepository.list(), []);
  const [pageKey, setPageKey] = useState(DEFAULT_MARKETING_PAGE.key);
  const [source, setSource] = useState<string>(SOURCE_PRESETS[0].value);
  const [customSource, setCustomSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [extraLine, setExtraLine] = useState("");
  const [printing, setPrinting] = useState<FlyerLayout | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  const leads = useAsync(() => leadSourcesRepository.since(daysAgoIso(Number(range))), [range]);

  const page = marketingPage(pageKey);
  // The yard sale sign isn't for sellers: no lead tags, and it says the
  // sale's minimum price (from Yard Sale Mode) instead of a fixed one.
  const isYardSale = page.key === YARD_SALE_MARKETING_KEY;
  const yardSale = useAsync(
    () => (isYardSale ? yardSaleRepository.snapshot() : Promise.resolve(null)),
    [isYardSale],
  );
  const flyerCopy = isYardSale ? yardSaleFlyerCopy(yardSale.data?.sale?.minPriceCents) : page.copy;
  const referrers = useMemo(
    () =>
      (partners.data ?? []).filter((p) => p.kind === "referrer" && p.status === "active" && p.referralCode),
    [partners.data],
  );
  const partner = referrers.find((p) => p.id === partnerId) ?? null;
  const preset = SOURCE_PRESETS.find((p) => p.value === source) ?? null;
  const utmSource =
    source === NO_SOURCE ? null : source === CUSTOM_SOURCE ? cleanCampaignToken(customSource) : source;
  const utmCampaign = cleanCampaignToken(campaign);
  const refCode = partner?.referralCode ?? null;
  const link = isYardSale
    ? marketingLink(page.path, {})
    : marketingLink(page.path, {
        source: utmSource,
        medium: preset?.medium ?? null,
        campaign: utmCampaign,
        ref: refCode,
      });
  const address = printedAddress(page.path, isYardSale ? null : refCode);
  const fileName = qrFileName([page.key, utmSource, utmCampaign, refCode]);
  const shareable = canShare();

  // What a lead from this link will say under "Where they came from".
  const tagSummary = isYardSale
    ? ""
    : [
        utmSource ? sourceLabel(utmSource) : null,
        utmCampaign,
        partner ? `credited to ${partner.businessName}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link. Press and hold it to copy it instead.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: flyerCopy.headline, url: link });
    } catch (err) {
      // Closing the share sheet without picking anything isn't an error.
      if ((err as { name?: unknown } | null)?.name === "AbortError") return;
      await copy();
    }
  }

  async function downloadPng() {
    try {
      await downloadQrPng(link, fileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the QR code.");
    }
  }

  const summary = useMemo(() => summarizeLeadSources(leads.data ?? []), [leads.data]);
  const totals = useMemo(() => {
    const rows = leads.data ?? [];
    const sellerLeads = rows.filter((r) => r.kind !== "partner_application");
    const tracked = sellerLeads.filter((r) => r.utmSource || r.refCode);
    return {
      buying: rows.filter((r) => r.kind === "buying_lead").length,
      partner: rows.filter((r) => r.kind === "partner_lead").length,
      trackedPercent: sellerLeads.length ? Math.round((tracked.length / sellerLeads.length) * 100) : null,
    };
  }, [leads.data]);

  const columns: Column<LeadSourceSummary>[] = [
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{row.source}</span>
          {row.campaigns.length > 0 && (
            <span className="gg-ordercell__cust">
              {row.campaigns.map((c) => `${c.campaign} (${c.count})`).join(", ")}
            </span>
          )}
        </div>
      ),
    },
    // Short headers so the counts fit a phone; the stat cards above spell them out.
    { key: "buying", header: "Magic", align: "right", render: (row) => row.buyingLeads || "—" },
    { key: "partner", header: "Partner", align: "right", render: (row) => row.partnerLeads || "—" },
    {
      key: "applications",
      header: "Partner sign-ups",
      align: "right",
      secondary: true,
      render: (row) => row.partnerApplications || "—",
    },
    { key: "total", header: "Total", align: "right", render: (row) => <strong>{row.total}</strong> },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Marketing"
        description="Tagged links, QR codes and printable flyers for card shows, posts and partners, and which of them bring in sellers."
      />

      <SectionCard title="Make a link or QR code">
        <div className="gg-marketing-builder">
          <div className="gg-marketing-builder__form">
            <SelectField label="Link to" value={pageKey} onChange={(e) => setPageKey(e.target.value)}>
              {MARKETING_PAGES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </SelectField>
            {isYardSale ? (
              <p className="gg-card-meta">
                The yard sale page doesn&rsquo;t collect leads, so this link has no tags. The sign shows the
                minimum price set in Yard Sale Mode.
              </p>
            ) : (
              <>
                <SelectField
                  label="Where you'll use it"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  hint="Leads that come in through the link are labeled with it."
                >
                  {SOURCE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value={CUSTOM_SOURCE}>Somewhere else…</option>
                  <option value={NO_SOURCE}>Nowhere in particular (no label)</option>
                </SelectField>
                {source === CUSTOM_SOURCE && (
                  <TextField
                    label="Name it"
                    value={customSource}
                    onChange={(e) => setCustomSource(e.target.value)}
                    placeholder="e.g. church bulletin"
                    maxLength={60}
                  />
                )}
                <TextField
                  label="Campaign (optional)"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  placeholder="e.g. nov 1 card show"
                  hint="Tells two of the same kind apart, like two card shows."
                  maxLength={60}
                />
                {referrers.length > 0 && (
                  <SelectField
                    label="Credit a referral partner (optional)"
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    hint="Puts their referral code in the link, so sellers who use it count as theirs."
                  >
                    <option value="">Nobody</option>
                    {referrers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.businessName}
                      </option>
                    ))}
                  </SelectField>
                )}
              </>
            )}
            <TextField
              label="Extra line for the flyer or sign (optional)"
              value={extraLine}
              onChange={(e) => setExtraLine(e.target.value)}
              placeholder="e.g. Find us at table 12 today"
              maxLength={80}
            />
          </div>

          <div className="gg-marketing-builder__preview">
            <QrCode value={link} size={200} label={`QR code for ${link}`} />
            <a className="gg-marketing-builder__link" href={link} target="_blank" rel="noopener noreferrer">
              {link}
            </a>
            {tagSummary && <p className="gg-card-meta">Leads from this link: {tagSummary}</p>}
            <div className="gg-drawer-actions__buttons">
              <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy()}>
                Copy link
              </Button>
              {shareable && (
                <Button size="sm" variant="secondary" icon="share" onClick={() => void share()}>
                  Share
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="download" onClick={() => void downloadPng()}>
                QR (PNG)
              </Button>
              <Button size="sm" variant="ghost" icon="download" onClick={() => downloadQrSvg(link, fileName)}>
                QR (SVG)
              </Button>
            </div>
            <div className="gg-drawer-actions__buttons">
              <Button size="sm" variant="primary" icon="printer" onClick={() => setPrinting("flyer")}>
                Print flyer
              </Button>
              <Button size="sm" variant="primary" icon="printer" onClick={() => setPrinting("sign")}>
                Print table sign
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Where leads come from"
        className="gg-marketing-sources"
        action={
          <Tabs
            items={RANGE_TABS}
            active={range}
            onChange={(k) => setRange(k as RangeKey)}
            ariaLabel="Date range"
          />
        }
      >
        <div className="gg-statgrid gg-marketing-stats">
          <StatCard label="Magic leads" value={leads.data ? String(totals.buying) : "—"} icon="dollar" />
          <StatCard label="Partner leads" value={leads.data ? String(totals.partner) : "—"} icon="store" />
          <StatCard
            label="Came in on a tagged or referral link"
            value={totals.trackedPercent === null ? "—" : `${totals.trackedPercent}%`}
            icon="qr"
            caption="Of Magic and partner leads"
          />
        </div>
        {leads.loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : leads.error ? (
          <ErrorState message="Could not load lead sources." onRetry={leads.reload} />
        ) : summary.length === 0 ? (
          <EmptyState
            icon="qr"
            title="No leads in this period"
            message="Share a tagged link or put out a flyer. The leads it brings in show up here."
          />
        ) : (
          <DataTable columns={columns} rows={summary} rowKey={(row) => row.source} caption="Leads by source" />
        )}
        <p className="gg-card-meta gg-marketing-note">
          Link tracking started October 11, 2026. Older leads only show what the seller picked under
          &ldquo;How did you hear about us?&rdquo;. “Said:” rows are that answer, for leads that didn&rsquo;t
          come in on a link.
        </p>
      </SectionCard>

      {printing && (
        <FlyerPrintView
          job={{ layout: printing, copy: flyerCopy, url: link, address, extraLine: extraLine.trim() || null }}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  );
}
