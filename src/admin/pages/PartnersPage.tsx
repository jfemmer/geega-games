import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard, StatCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { Modal } from "../components/ui/Modal";
import { SearchInput, SelectField, TextArea, TextField } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/States";
import { QrCode } from "../components/partners/QrCode";
import { downloadQrPng, downloadQrSvg } from "../utils/qrCode";
import { FlyerPrintView } from "../components/partners/FlyerPrintView";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { formatCents, formatDate, formatDateTime } from "../utils/format";
import {
  partnerReferralsRepository,
  partnersRepository,
  referralRewardsRepository,
  type PartnerFieldsInput,
} from "../repositories/partners.supabase";
import type { Partner, PartnerAgreement, PartnerMessage, PartnerReferral, ReferralReward } from "../types";
import {
  DEFAULT_REFERRER_FEE_PERCENT,
  DEFAULT_STORE_FEE_PERCENT,
  FEE_STATUSES,
  PARTNER_CATEGORIES,
  PARTNER_MESSAGE_BODY_MAX,
  PARTNER_MESSAGE_SUBJECT_MAX,
  PARTNER_PROFESSIONS,
  PARTNER_REFERRAL_OUTCOMES,
  PARTNER_STATUSES,
  SELL_HUB_PATH,
  formatPercent,
  partnerCategoryLabel,
  partnerProfessionsByGroup,
  type PartnerKind,
  type PartnerStatus,
} from "../../store/lib/partnerTypes";
import { optionLabel } from "../../store/lib/referralTypes";
import { describeLeadSource } from "../../store/lib/attribution";
import { US_REGIONS, usStateName } from "../../store/lib/usAddress";
import { countersignProblems, describePartnerEntity } from "../../store/lib/partnerAgreement";
import { LEGAL_NAME, OWNER_NAME } from "../../seo/site";
import { marketingPage, printedAddress, referralPartnerLink } from "../utils/marketing";

// Partners: partner stores (buy the leads, pay a finder's fee when they buy)
// and referral partners (send sellers, earn a referral fee). Applications
// from /for-stores and /referral-partners land here as "New application";
// the owner approves (which emails the partner agreement to sign), declines,
// pauses or edits them, and sees what each store owes. A store goes live when
// it signs; a referral partner signs first and goes live (welcome, personal
// link) when the owner countersigns. Leads and referral fees need an
// agreement in effect. Every change goes through owner-only API endpoints.

type TabKey = "applied" | "stores" | "referrers" | "declined";

const TABS: { key: TabKey; label: string }[] = [
  { key: "applied", label: "Applications" },
  { key: "stores", label: "Partner stores" },
  { key: "referrers", label: "Referral partners" },
  { key: "declined", label: "Declined" },
];

const STATUS_TONE: Record<PartnerStatus, "gold" | "success" | "neutral" | "danger"> = {
  applied: "gold",
  active: "success",
  paused: "neutral",
  declined: "danger",
};

function inTab(p: Partner, tab: TabKey): boolean {
  if (tab === "applied") return p.status === "applied";
  if (tab === "declined") return p.status === "declined";
  if (tab === "stores") return p.kind === "store" && (p.status === "active" || p.status === "paused");
  return p.kind === "referrer" && (p.status === "active" || p.status === "paused");
}

function partnerLocation(p: Partner): string {
  return [p.city, p.state].filter(Boolean).join(", ");
}

function whatTheyDo(p: Partner): string {
  if (p.kind === "store") return p.categories.map(partnerCategoryLabel).join(", ") || "—";
  return optionLabel(PARTNER_PROFESSIONS, p.profession) ?? "Referral partner";
}

interface StoreStats {
  sent: number;
  sold: number;
  owedCents: number;
  paidCents: number;
}

function statsByPartner(referrals: PartnerReferral[]): Map<string, StoreStats> {
  const out = new Map<string, StoreStats>();
  for (const r of referrals) {
    const s = out.get(r.partnerId) ?? { sent: 0, sold: 0, owedCents: 0, paidCents: 0 };
    s.sent += 1;
    if (r.outcome === "sold") s.sold += 1;
    if (r.feeStatus === "owed") s.owedCents += r.feeCents ?? 0;
    if (r.feeStatus === "paid") s.paidCents += r.feeCents ?? 0;
    out.set(r.partnerId, s);
  }
  return out;
}

export function PartnersPage({ query }: { query: URLSearchParams }) {
  const partners = useAsync(() => partnersRepository.list(), []);
  const referrals = useAsync(() => partnerReferralsRepository.all(), []);
  const agreements = useAsync(() => partnersRepository.agreements(), []);
  const [tab, setTab] = useState<TabKey>("applied");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => query.get("partner"));
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => partners.data ?? [], [partners.data]);
  const stats = useMemo(() => statsByPartner(referrals.data ?? []), [referrals.data]);
  const agreementsByPartner = useMemo(() => {
    const map = new Map<string, PartnerAgreement[]>();
    for (const a of agreements.data ?? []) map.set(a.partnerId, [...(map.get(a.partnerId) ?? []), a]);
    return map;
  }, [agreements.data]);

  // Open on the tab that holds a deep-linked partner, or on Applications only when there are some.
  useEffect(() => {
    if (!partners.data) return;
    const deep = selectedId ? partners.data.find((p) => p.id === selectedId) : null;
    if (deep) {
      const holding = TABS.find((t) => inTab(deep, t.key));
      if (holding) setTab(holding.key);
    } else if (!partners.data.some((p) => p.status === "applied")) {
      setTab("stores");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners.data === null]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { applied: 0, stores: 0, referrers: 0, declined: 0 };
    for (const p of rows) for (const t of TABS) if (inTab(p, t.key)) c[t.key] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (p) =>
        inTab(p, tab) &&
        (!term ||
          [p.businessName, p.contactName, p.email, p.city ?? "", p.state ?? ""].some((v) =>
            v.toLowerCase().includes(term),
          )),
    );
  }, [rows, tab, search]);

  const totals = useMemo(() => {
    const all = referrals.data ?? [];
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = all.filter((r) => new Date(r.sentAt).getTime() >= monthAgo);
    const decided = all.filter((r) => r.outcome !== "pending");
    return {
      owedCents: all.filter((r) => r.feeStatus === "owed").reduce((n, r) => n + (r.feeCents ?? 0), 0),
      paidCents: all.filter((r) => r.feeStatus === "paid").reduce((n, r) => n + (r.feeCents ?? 0), 0),
      sentLast30: recent.length,
      soldRate: decided.length ? Math.round((decided.filter((r) => r.outcome === "sold").length / decided.length) * 100) : null,
    };
  }, [referrals.data]);

  const selected = selectedId ? (rows.find((p) => p.id === selectedId) ?? null) : null;

  const columns: Column<Partner>[] = [
    {
      key: "name",
      header: "Partner",
      render: (p) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {p.status === "applied" && <span className="gg-newdot" aria-hidden="true" />}
            {p.businessName}
          </span>
          <span className="gg-ordercell__cust">{p.contactName}</span>
        </div>
      ),
    },
    { key: "what", header: tab === "referrers" ? "Works as" : "Buys", render: whatTheyDo },
    { key: "where", header: "Location", secondary: true, render: (p) => partnerLocation(p) || "—" },
    { key: "fee", header: "Fee", align: "right", secondary: true, render: (p) => formatPercent(p.feePercent) },
    ...(tab === "stores"
      ? [
          {
            key: "leads",
            header: "Leads / sold",
            align: "right" as const,
            secondary: true,
            render: (p: Partner) => {
              const s = stats.get(p.id);
              return s ? `${s.sent} / ${s.sold}` : "0 / 0";
            },
          },
          {
            key: "owed",
            header: "Fees owed",
            align: "right" as const,
            render: (p: Partner) => {
              const owed = stats.get(p.id)?.owedCents ?? 0;
              return owed ? <strong>{formatCents(owed)}</strong> : "—";
            },
          },
        ]
      : []),
    {
      key: "status",
      header: "Status",
      render: (p) => {
        const state = agreementState(agreementsByPartner.get(p.id) ?? []);
        const badge =
          !agreements.data || p.status === "declined"
            ? null
            : state.awaiting
              ? { tone: "warning" as const, label: "Countersign needed" }
              : state.signed
                ? null
                : state.pending
                  ? { tone: "info" as const, label: state.expired ? "Agreement expired" : "Agreement sent" }
                  : { tone: "warning" as const, label: "Not signed" };
        return (
          <span className="gg-partner-status">
            <Badge tone={STATUS_TONE[p.status]}>{optionLabel(PARTNER_STATUSES, p.status)}</Badge>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </span>
        );
      },
    },
    { key: "date", header: "Since", secondary: true, render: (p) => formatDate(p.approvedAt ?? p.createdAt) },
  ];

  function reloadAll() {
    partners.reload();
    referrals.reload();
    agreements.reload();
  }

  return (
    <div className="gg-page">
      <PageHeader
        title="Partners"
        description="Partner stores buy the leads you send them and pay a finder's fee when they buy. Referral partners send sellers your way and earn a referral fee."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add a partner
          </Button>
        }
      />

      <div className="gg-statgrid">
        <StatCard label="Finder's fees owed" value={formatCents(totals.owedCents)} icon="dollar" accent={totals.owedCents ? "gold" : "default"} />
        <StatCard label="Fees paid (all time)" value={formatCents(totals.paidCents)} icon="checkCircle" />
        <StatCard label="Leads sent, last 30 days" value={String(totals.sentLast30)} icon="mail" />
        <StatCard
          label="Leads that sold"
          value={totals.soldRate === null ? "—" : `${totals.soldRate}%`}
          icon="trends"
          caption="Of leads with an outcome"
        />
      </div>

      <SectionCard title="Partners">
        <div className="gg-toolbar">
          <SearchInput
            label="Search partners"
            placeholder="Business, contact, email or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs
          ariaLabel="Filter partners"
          active={tab}
          onChange={(k) => setTab(k as TabKey)}
          items={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
        />
        {partners.loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : partners.error ? (
          <ErrorState message="Could not load partners." onRetry={partners.reload} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="store"
            title={tab === "applied" ? "No applications waiting" : "Nobody here yet"}
            message={
              tab === "applied"
                ? "Stores apply at /for-stores and referral partners at /referral-partners. Share those pages, or add a partner you already work with."
                : "Approve an application, or use “Add a partner” for someone you already work with."
            }
          />
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(p) => p.id} onRowClick={(p) => setSelectedId(p.id)} caption="Partners" />
        )}
      </SectionCard>

      {selected && (
        <PartnerDrawer
          partner={selected}
          referrals={(referrals.data ?? []).filter((r) => r.partnerId === selected.id)}
          agreements={agreements.data ? (agreementsByPartner.get(selected.id) ?? []) : null}
          onClose={() => setSelectedId(null)}
          onChanged={reloadAll}
          onDeleted={() => {
            setSelectedId(null);
            reloadAll();
          }}
        />
      )}

      {adding && (
        <AddPartnerModal
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setSelectedId(id);
            reloadAll();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable fields, shared by "Add a partner" and the drawer
// ---------------------------------------------------------------------------

interface FormState {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  categories: string[];
  coverage: string;
  buysByMail: boolean;
  profession: string;
  feePercent: string;
  internalNotes: string;
}

function formFromPartner(p: Partner): FormState {
  return {
    businessName: p.businessName,
    contactName: p.contactName,
    email: p.email,
    phone: p.phone ?? "",
    website: p.website ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    categories: p.categories,
    coverage: p.coverage ?? "",
    buysByMail: p.buysByMail,
    profession: p.profession ?? "",
    feePercent: String(p.feePercent),
    internalNotes: p.internalNotes ?? "",
  };
}

function fieldsFromForm(f: FormState, kind: PartnerKind): PartnerFieldsInput {
  return {
    businessName: f.businessName,
    contactName: f.contactName,
    email: f.email,
    phone: f.phone || null,
    website: f.website || null,
    city: f.city || null,
    state: f.state || null,
    ...(kind === "store"
      ? { categories: f.categories, coverage: f.coverage || null, buysByMail: f.buysByMail }
      : { profession: f.profession || null }),
    feePercent: Number(f.feePercent),
    internalNotes: f.internalNotes || null,
  };
}

function PartnerFields({
  kind,
  form,
  onChange,
  disabled,
}: {
  kind: PartnerKind;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="gg-partner-fields">
      <div className="gg-form-grid">
        <TextField label="Business name" value={form.businessName} disabled={disabled} onChange={(e) => onChange({ businessName: e.target.value })} required />
        <TextField label="Contact name" value={form.contactName} disabled={disabled} onChange={(e) => onChange({ contactName: e.target.value })} required />
        <TextField label="Email" type="email" value={form.email} disabled={disabled} onChange={(e) => onChange({ email: e.target.value })} required />
        <TextField label="Phone" type="tel" value={form.phone} disabled={disabled} onChange={(e) => onChange({ phone: e.target.value })} />
        <TextField label="City" value={form.city} disabled={disabled} onChange={(e) => onChange({ city: e.target.value })} />
        <SelectField label="State" value={form.state} disabled={disabled} onChange={(e) => onChange({ state: e.target.value })}>
          <option value="">—</option>
          {US_REGIONS.filter((r) => r.group === "state").map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Website" value={form.website} disabled={disabled} onChange={(e) => onChange({ website: e.target.value })} />
        <TextField
          label={kind === "store" ? "Finder's fee (% of what they pay)" : "Referral fee (% of the sale)"}
          inputMode="decimal"
          value={form.feePercent}
          disabled={disabled}
          onChange={(e) => onChange({ feePercent: e.target.value })}
        />
      </div>
      {kind === "store" ? (
        <>
          <fieldset className="gg-partner-cats" disabled={disabled}>
            <legend>Buys</legend>
            {PARTNER_CATEGORIES.map((c) => (
              <label key={c.value} className="gg-check-inline">
                <input
                  type="checkbox"
                  checked={form.categories.includes(c.value)}
                  onChange={() =>
                    onChange({
                      categories: form.categories.includes(c.value)
                        ? form.categories.filter((x) => x !== c.value)
                        : [...form.categories, c.value],
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </fieldset>
          <TextArea label="Where they meet sellers" rows={2} value={form.coverage} disabled={disabled} onChange={(e) => onChange({ coverage: e.target.value })} />
          <label className="gg-check-inline">
            <input type="checkbox" checked={form.buysByMail} disabled={disabled} onChange={(e) => onChange({ buysByMail: e.target.checked })} />
            Buys by mail from anywhere in the US
          </label>
        </>
      ) : (
        <SelectField label="Works as" value={form.profession} disabled={disabled} onChange={(e) => onChange({ profession: e.target.value })}>
          <option value="">—</option>
          {partnerProfessionsByGroup().map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.options.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      )}
      <TextArea label="Internal notes (only staff see these)" rows={3} value={form.internalNotes} disabled={disabled} onChange={(e) => onChange({ internalNotes: e.target.value })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add a partner
// ---------------------------------------------------------------------------

function AddPartnerModal({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<PartnerKind>("store");
  const [form, setForm] = useState<FormState>({
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    city: "",
    state: "MO",
    categories: [],
    coverage: "",
    buysByMail: false,
    profession: "",
    feePercent: String(DEFAULT_STORE_FEE_PERCENT),
    internalNotes: "",
  });
  const [sendWelcome, setSendWelcome] = useState(true);
  const [saving, setSaving] = useState(false);

  function changeKind(next: PartnerKind) {
    setKind(next);
    setForm((f) => ({ ...f, feePercent: String(next === "store" ? DEFAULT_STORE_FEE_PERCENT : DEFAULT_REFERRER_FEE_PERCENT) }));
  }

  async function save() {
    setSaving(true);
    try {
      const { id } = await partnersRepository.create(kind, fieldsFromForm(form, kind), sendWelcome);
      toast.success(`${form.businessName} added${sendWelcome ? " and emailed" : ""}.`);
      onAdded(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the partner.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a partner"
      size="lg"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Add partner
          </Button>
        </div>
      }
    >
      <div className="gg-partner-form">
        <p className="gg-card-meta">
          For a store or referral partner you&rsquo;ve already agreed terms with. They start out active.
        </p>
        <SelectField label="Kind" value={kind} onChange={(e) => changeKind(e.target.value as PartnerKind)}>
          <option value="store">Partner store — buys leads, pays a finder&rsquo;s fee</option>
          <option value="referrer">Referral partner — sends sellers, earns a referral fee</option>
        </SelectField>
        <PartnerFields kind={kind} form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} disabled={saving} />
        <label className="gg-check-inline">
          <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} />
          Email them the welcome{kind === "referrer" ? " with their referral link" : " and partner standards"}
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// One partner
// ---------------------------------------------------------------------------

function PartnerDrawer({
  partner,
  referrals,
  agreements,
  onClose,
  onChanged,
  onDeleted,
}: {
  partner: Partner;
  referrals: PartnerReferral[];
  /** null while loading. */
  agreements: PartnerAgreement[] | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => formFromPartner(partner));
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [printingFlyer, setPrintingFlyer] = useState(false);

  useEffect(() => {
    setForm(formFromPartner(partner));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner.id]);

  useEffect(() => {
    if (partner.kind !== "referrer") return;
    referralRewardsRepository.forPartner(partner.id).then(setRewards).catch(() => setRewards([]));
  }, [partner.id, partner.kind]);

  async function act(action: "approve" | "decline" | "pause" | "activate") {
    setActing(action);
    try {
      const result = await partnersRepository.act(partner.id, action);
      if (result.agreement) {
        if (result.agreement.emailed) {
          toast.success(`Approved. ${partner.businessName} has been emailed the agreement; they go live when they sign it.`);
        } else {
          toast.error("Approved, but the agreement email didn't send. Use “Copy signing link” to send it yourself.");
        }
      } else {
        const verb = { approve: "Approved", decline: "Declined", pause: "Paused", activate: "Reactivated" }[action];
        toast.success(
          `${verb} ${partner.businessName}.${result.welcome === "sent" ? " Welcome email sent." : result.welcome === "failed" ? " The welcome email didn't send — email them yourself." : ""}`,
        );
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the partner.");
    } finally {
      setActing(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await partnersRepository.update(partner.id, fieldsFromForm(form, partner.kind));
      toast.success("Saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const agreementInfo = agreementState(agreements ?? []);
  const hasSigned = agreementInfo.signed !== null;
  const openAgreement = agreementInfo.pending !== null || agreementInfo.awaiting !== null;
  const link = partner.referralCode ? referralPartnerLink(partner.referralCode) : null;
  const source = describeLeadSource(partner.source);
  const owed = referrals.filter((r) => r.feeStatus === "owed");
  const owedTotal = owed.reduce((n, r) => n + (r.feeCents ?? 0), 0);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error("Couldn't copy. Press and hold to copy it instead.");
    }
  }

  function statement(): string {
    const lines = [
      `Finder's fees owed to Geega Games — ${partner.businessName}`,
      `As of ${formatDate(new Date().toISOString())}`,
      "",
      ...owed.map(
        (r) =>
          `${r.leadReference} · bought ${formatDate(r.outcomeAt)} for ${formatCents(r.saleAmountCents ?? 0)} · ${formatPercent(r.feePercent)} fee: ${formatCents(r.feeCents ?? 0)}`,
      ),
      "",
      `Total owed: ${formatCents(owedTotal)}`,
    ];
    return lines.join("\n");
  }

  return (
    <Modal open onClose={onClose} title={partner.businessName} variant="drawer" size="lg">
      <div className="gg-leaddetail">
        <section className="gg-leaddetail__section">
          <h3>
            {partner.kind === "store" ? "Partner store" : "Referral partner"}{" "}
            <Badge tone={STATUS_TONE[partner.status]}>{optionLabel(PARTNER_STATUSES, partner.status)}</Badge>
          </h3>
          <p>
            <strong>{partner.contactName}</strong>
            {partnerLocation(partner) ? ` · ${partnerLocation(partner)}` : ""}
          </p>
          <div className="gg-leaddetail__contactlinks">
            <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`mailto:${partner.email}`}>
              <Icon name="mail" size={14} /> {partner.email}
            </a>
            {partner.phone && (
              <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`tel:${partner.phone}`}>
                Call {partner.phone}
              </a>
            )}
            {partner.website && (
              <a className="gg-btn gg-btn-ghost gg-btn-sm" href={partner.website} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={14} /> Website
              </a>
            )}
          </div>
          <p className="gg-card-meta">
            {partner.kind === "store" ? `Buys: ${whatTheyDo(partner)}` : `Works as: ${whatTheyDo(partner)}`}
            {partner.kind === "store" && partner.buysByMail ? " · buys by mail" : ""}
          </p>
          {partner.coverage && <p className="gg-card-meta">Meets sellers: {partner.coverage}</p>}
          {partner.notes && (
            <p style={{ whiteSpace: "pre-wrap" }}>
              <strong>They said:</strong> {partner.notes}
            </p>
          )}
          <p className="gg-card-meta">
            Applied {formatDateTime(partner.createdAt)} · agreed to the standards{" "}
            {formatDate(partner.agreedToStandardsAt)}
            {partner.approvedAt ? ` · approved ${formatDate(partner.approvedAt)}` : ""}
          </p>
          {source.length > 0 && <p className="gg-card-meta">Found us: {source.join(" · ")}</p>}

          <div className="gg-drawer-actions__buttons gg-partner-actions">
            {partner.status !== "active" && partner.status !== "paused" && !(partner.status === "applied" && openAgreement) && (
              <Button variant="primary" size="sm" loading={acting === "approve"} disabled={agreements === null} onClick={() => void act("approve")}>
                {hasSigned ? (partner.status === "applied" ? "Approve & send welcome" : "Approve") : "Approve & send agreement"}
              </Button>
            )}
            {partner.status === "applied" && (
              <Button variant="ghost" size="sm" loading={acting === "decline"} onClick={() => void act("decline")}>
                Decline
              </Button>
            )}
            {partner.status === "active" && (
              <Button variant="secondary" size="sm" icon="pause" loading={acting === "pause"} onClick={() => void act("pause")}>
                Pause
              </Button>
            )}
            {partner.status === "paused" && (
              <Button variant="primary" size="sm" loading={acting === "activate"} onClick={() => void act("activate")}>
                Reactivate
              </Button>
            )}
          </div>
        </section>

        <PartnerAgreementSection key={partner.id} partner={partner} agreements={agreements} onChanged={onChanged} />

        <PartnerMessagesSection partner={partner} />

        {partner.kind === "referrer" && (
          <section className="gg-leaddetail__section">
            <h3>Their referral link</h3>
            {link ? (
              <div className="gg-partner-link">
                <QrCode value={link} size={150} label={`QR code for ${partner.businessName}'s referral link`} />
                <div>
                  <p className="gg-partner-link__url">{link}</p>
                  <div className="gg-drawer-actions__buttons">
                    <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy(link, "Link")}>
                      Copy link
                    </Button>
                    <Button size="sm" variant="ghost" icon="download" onClick={() => void downloadQrPng(link, `geega-referral-${partner.referralCode}`)}>
                      QR (PNG)
                    </Button>
                    <Button size="sm" variant="ghost" icon="download" onClick={() => downloadQrSvg(link, `geega-referral-${partner.referralCode}`)}>
                      QR (SVG)
                    </Button>
                    <Button size="sm" variant="ghost" icon="printer" onClick={() => setPrintingFlyer(true)}>
                      Print flyer
                    </Button>
                  </div>
                  <p className="gg-card-meta">
                    Sellers who use it are credited to {partner.businessName} for 30 days. The flyer carries
                    this QR code and link, for them to put out at an estate sale or in their office.
                  </p>
                </div>
              </div>
            ) : (
              <p className="gg-card-meta">They get a personal link once they sign their agreement.</p>
            )}
            {rewards.length > 0 && (
              <ul className="gg-referral-history">
                {rewards.map((r) => (
                  <li key={r.id} className="gg-referral-history__item">
                    <div className="gg-referral-history__head">
                      <strong>
                        {r.leadReference} · {formatCents(r.amountCents)}
                      </strong>
                      <Badge tone={r.status === "paid" ? "success" : "gold"}>{r.status === "paid" ? "Paid" : "Owed"}</Badge>
                    </div>
                    <span className="gg-card-meta">Earned {formatDate(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {partner.kind === "store" && (
          <section className="gg-leaddetail__section">
            <h3>Leads sent ({referrals.length})</h3>
            {referrals.length === 0 ? (
              <p className="gg-card-meta">None yet. Send leads from Partner Leads or Buying Leads.</p>
            ) : (
              <ul className="gg-referral-history">
                {referrals.map((r) => (
                  <li key={r.id} className="gg-referral-history__item">
                    <div className="gg-referral-history__head">
                      <strong>{r.leadReference}</strong>
                      <span className="gg-card-meta">Sent {formatDate(r.sentAt)}</span>
                    </div>
                    <span>
                      {optionLabel(PARTNER_REFERRAL_OUTCOMES, r.outcome)}
                      {r.outcome === "sold" &&
                        ` · ${formatCents(r.saleAmountCents ?? 0)} · fee ${formatCents(r.feeCents ?? 0)} (${optionLabel(FEE_STATUSES, r.feeStatus)})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {owed.length > 0 && (
              <div className="gg-referral-fee">
                <span>
                  Owed now: <strong>{formatCents(owedTotal)}</strong> ({owed.length} sale{owed.length === 1 ? "" : "s"})
                </span>
                <Button size="sm" variant="secondary" icon="copy" onClick={() => void copy(statement(), "Statement")}>
                  Copy statement
                </Button>
              </div>
            )}
          </section>
        )}

        <section className="gg-leaddetail__section gg-leaddetail__internal">
          <h3>Details</h3>
          <PartnerFields kind={partner.kind} form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} disabled={saving} />
          <Button variant="primary" size="sm" loading={saving} onClick={save}>
            Save details
          </Button>
        </section>

        <section className="gg-leaddetail__section gg-leaddetail__danger">
          <h3>Delete partner</h3>
          {referrals.length > 0 || rewards.length > 0 ? (
            <p className="gg-card-meta">
              {referrals.length > 0 ? "Leads were sent to this partner" : "This partner has earned referral fees"}, so
              it&rsquo;s kept for the fee records. Pause it instead.
            </p>
          ) : (
            <>
              <p className="gg-card-meta">Removes this partner (and their referral link) for good.</p>
              <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Delete partner
              </Button>
            </>
          )}
        </section>
      </div>

      {printingFlyer && link && partner.referralCode && (
        <FlyerPrintView
          job={{
            layout: "flyer",
            copy: marketingPage("hub").copy,
            url: link,
            address: printedAddress(SELL_HUB_PATH, partner.referralCode),
          }}
          onClose={() => setPrintingFlyer(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${partner.businessName}?`}
        message="This can't be undone. Their referral link will stop working."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          try {
            await partnersRepository.remove(partner.id);
            toast.success(`${partner.businessName} deleted.`);
            onDeleted();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't delete.");
          } finally {
            setConfirmDelete(false);
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Message them — email an applicant or partner from here, with a history
// ---------------------------------------------------------------------------

/** A starting point for asking an applicant to explain themselves. Staff edit it before sending. */
function applicantQuestionsTemplate(partner: Pick<Partner, "kind" | "contactName">): { subject: string; message: string } {
  if (partner.kind === "store") {
    return {
      subject: "A few questions about your partner store application",
      message: [
        "Thanks for applying to be a Geega Games partner store. Before we set you up, could you tell us a little more?",
        "- Do you have a storefront, or do you buy online / at shows? Where are you based?",
        "- What do you buy most, and roughly how much do you spend on collections in a month?",
        "- How quickly can you usually reach a seller and make an offer?",
        "- Is there a website or social page where we can see your business?",
        "Thanks!",
      ].join("\n\n"),
    };
  }
  return {
    subject: "A few questions about your referral partner application",
    message: [
      "Thanks for applying to be a Geega Games referral partner. Before we set you up, could you tell us a little more?",
      "- What does your business do day to day, and where are you based?",
      "- How do you come across people who want to sell trading cards, games or collections?",
      "- How would you share our link with them (in person, on your website, social media, something else)?",
      "- Roughly how many people do you think you'd send our way in a month?",
      "- Is there a website or social page where we can learn more about you?",
      "Thanks!",
    ].join("\n\n"),
  };
}

function PartnerMessagesSection({ partner }: { partner: Partner }) {
  const toast = useToast();
  const [history, setHistory] = useState<PartnerMessage[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  function loadHistory() {
    setHistoryError(false);
    partnersRepository
      .messages(partner.id)
      .then(setHistory)
      .catch(() => {
        setHistory([]);
        setHistoryError(true);
      });
  }

  useEffect(() => {
    setHistory(null);
    setComposing(false);
    setSubject("");
    setMessage("");
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner.id]);

  function start(withTemplate: boolean) {
    if (withTemplate) {
      const t = applicantQuestionsTemplate(partner);
      setSubject(t.subject);
      setMessage(t.message);
    } else if (!subject) {
      setSubject(`About your Geega Games ${partner.kind === "store" ? "partner store" : "referral partner"} application`);
    }
    setComposing(true);
  }

  async function send() {
    if (!subject.trim()) return toast.error("Please add a subject.");
    if (!message.trim()) return toast.error("Please write a message.");
    setSending(true);
    try {
      const result = await partnersRepository.sendMessage(partner.id, subject, message);
      if (result.email === "sent") {
        toast.success(`Sent to ${partner.email}. Their reply will come to your support inbox.`);
      } else {
        toast.error(`Saved, but the email didn't send. Email ${partner.email} yourself.`);
      }
      setComposing(false);
      setSubject("");
      setMessage("");
      loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="gg-leaddetail__section">
      <h3>Message them</h3>
      {!composing ? (
        <>
          <p className="gg-card-meta">
            Email {partner.contactName} at {partner.email} from Geega Games. Their reply goes to your support inbox.
          </p>
          <div className="gg-drawer-actions__buttons">
            {partner.status === "applied" && (
              <Button size="sm" variant="primary" icon="message" onClick={() => start(true)}>
                Ask about their application
              </Button>
            )}
            <Button size="sm" variant={partner.status === "applied" ? "secondary" : "primary"} icon="mail" onClick={() => start(false)}>
              Write a message
            </Button>
          </div>
        </>
      ) : (
        <div className="gg-partner-form">
          <TextField
            label="Subject"
            value={subject}
            maxLength={PARTNER_MESSAGE_SUBJECT_MAX}
            disabled={sending}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
          <TextArea
            label={`Message to ${partner.contactName}`}
            hint={`Starts with "Hi ${partner.contactName}," and ends with your name. ${message.length.toLocaleString("en-US")} / ${PARTNER_MESSAGE_BODY_MAX.toLocaleString("en-US")}`}
            rows={9}
            value={message}
            maxLength={PARTNER_MESSAGE_BODY_MAX}
            disabled={sending}
            onChange={(e) => setMessage(e.target.value)}
            required
          />
          <div className="gg-drawer-actions__buttons">
            <Button size="sm" variant="primary" icon="mail" loading={sending} onClick={() => void send()}>
              Send email
            </Button>
            <Button size="sm" variant="ghost" disabled={sending} onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {historyError && (
        <p className="gg-card-meta">
          Couldn&rsquo;t load past messages.{" "}
          <Button size="sm" variant="ghost" onClick={loadHistory}>
            Try again
          </Button>
        </p>
      )}
      {history && history.length > 0 && (
        <ul className="gg-referral-history" aria-label="Messages sent">
          {history.map((m) => (
            <li key={m.id} className="gg-referral-history__item">
              <div className="gg-referral-history__head">
                <strong>{m.subject}</strong>
                {m.emailStatus === "failed" ? <Badge tone="danger">Didn&rsquo;t send</Badge> : <Badge tone="success">Sent</Badge>}
              </div>
              <span className="gg-card-meta">
                {formatDateTime(m.createdAt)}
                {m.sentByEmail ? ` · by ${m.sentByEmail}` : ""} · to {m.toEmail}
              </span>
              <details className="gg-partner-message">
                <summary>Show message</summary>
                <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{m.body}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The partner agreement — sent on approval, signed online, PDF kept
// ---------------------------------------------------------------------------

interface AgreementState {
  /** In effect: the newest fully executed one. */
  signed: PartnerAgreement | null;
  /** Signed by the partner, waiting for our countersignature. */
  awaiting: PartnerAgreement | null;
  /** Sent, not signed yet. */
  pending: PartnerAgreement | null;
  /** The pending link has expired. */
  expired: boolean;
}

const effectiveAt = (a: PartnerAgreement) => a.countersignedAt ?? a.signedAt ?? "";

/** Where a partner's agreement stands: the one in effect, and any newer one in progress. */
function agreementState(list: PartnerAgreement[]): AgreementState {
  const signed = list.filter((a) => a.status === "signed").sort((a, b) => effectiveAt(b).localeCompare(effectiveAt(a)))[0] ?? null;
  const awaiting = list.find((a) => a.status === "awaiting_countersign") ?? null;
  const pending = list.find((a) => a.status === "pending") ?? null;
  return { signed, awaiting, pending, expired: pending ? new Date(pending.expiresAt).getTime() <= Date.now() : false };
}

function entityLine(a: PartnerAgreement): string | null {
  if (!a.entityName) return null;
  return describePartnerEntity({
    name: a.entityName,
    type: a.entityType ?? "",
    stateName: a.entityState ? (usStateName(a.entityState) ?? a.entityState) : null,
  });
}

function PartnerAgreementSection({
  partner,
  agreements,
  onChanged,
}: {
  partner: Partner;
  agreements: PartnerAgreement[] | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"send" | "pdf" | null>(null);
  const [signUrl, setSignUrl] = useState<string | null>(null);

  if (agreements === null) {
    return (
      <section className="gg-leaddetail__section" aria-busy="true">
        <h3>Partner agreement</h3>
        <p className="gg-card-meta">Loading…</p>
      </section>
    );
  }

  const state = agreementState(agreements);
  const what = partner.kind === "store" ? "Partner Store Agreement" : "Referral Partner Agreement";
  const applicant = partner.status === "applied";
  const gate =
    partner.kind === "store"
      ? applicant
        ? "They go live when they sign. No leads can be sent to them until then."
        : "No leads can be sent to them until they sign."
      : applicant
        ? "They sign first, and it takes effect when you countersign. Then their referral link turns on and referral fees can be paid."
        : "No referral fee can be paid to them until an agreement is in effect (signed by them, then countersigned by you).";

  async function send() {
    setBusy("send");
    try {
      const { agreement } = await partnersRepository.sendAgreement(partner.id);
      setSignUrl(agreement.signUrl);
      if (agreement.emailed) toast.success(`${what} emailed to ${partner.email}.`);
      else toast.error("The agreement was created, but the email didn't send. Copy the signing link below and send it yourself.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the agreement.");
    } finally {
      setBusy(null);
    }
  }

  async function download(agreementId: string) {
    setBusy("pdf");
    try {
      const url = await partnersRepository.agreementPdfUrl(partner.id, agreementId);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the signed copy.");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(signUrl);
      toast.success("Signing link copied. It's private to them, so send it only to their email.");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it instead.");
    }
  }

  const canSend = partner.status !== "declined";
  const { signed, awaiting, pending } = state;
  const feeChanged = signed && Math.abs(signed.feePercent - partner.feePercent) > 0.001;
  const headBadge = awaiting ? (
    <Badge tone="warning">Countersign needed</Badge>
  ) : signed ? (
    <Badge tone="success">{signed.requiresCountersign ? "In effect" : "Signed"}</Badge>
  ) : pending ? (
    <Badge tone={state.expired ? "warning" : "info"}>{state.expired ? "Link expired" : "Waiting for signature"}</Badge>
  ) : (
    <Badge tone="warning">Not signed</Badge>
  );

  return (
    <section className="gg-leaddetail__section">
      <h3>Partner agreement {headBadge}</h3>

      {awaiting && <CountersignPanel partner={partner} agreement={awaiting} replacing={signed} onChanged={onChanged} />}

      {signed && (
        <>
          <p className={awaiting ? "gg-card-meta" : undefined}>
            {awaiting ? "In effect until you countersign the new one: " : ""}
            <strong>{signed.signerName}</strong>
            {signed.signerTitle ? ` (${signed.signerTitle})` : ""} signed the {signed.title} (version {signed.versionNumber})
            {entityLine(signed) ? ` for ${entityLine(signed)}` : ""} on {formatDateTime(signed.signedAt)}
            {signed.countersignedAt
              ? `; ${signed.countersignerName ?? "Geega Games"} countersigned on ${formatDateTime(signed.countersignedAt)}, when it took effect`
              : ""}
            , at a {formatPercent(signed.feePercent)} fee.
          </p>
          <div className="gg-drawer-actions__buttons">
            <Button size="sm" variant="secondary" icon="download" loading={busy === "pdf"} onClick={() => void download(signed.id)}>
              Signed copy (PDF)
            </Button>
          </div>
          {feeChanged && (
            <p className="gg-partner-agreement__warn" role="note">
              Their fee here is {formatPercent(partner.feePercent)}, but they signed for {formatPercent(signed.feePercent)}. The signed{" "}
              {formatPercent(signed.feePercent)} is what applies until a new agreement is in effect.
            </p>
          )}
        </>
      )}

      {pending && (
        <p className={signed ? "gg-card-meta" : undefined}>
          {signed ? "A newer agreement was " : "Sent "}
          {signed ? `sent ${formatDate(pending.createdAt)}` : formatDateTime(pending.lastEmailedAt ?? pending.createdAt)} to {pending.invitedEmail}
          {pending.sentByEmail ? ` by ${pending.sentByEmail}` : ""} at a {formatPercent(pending.feePercent)} fee (version {pending.versionNumber}).{" "}
          {state.expired ? "The link has expired; send a new one." : `The link works until ${formatDate(pending.expiresAt)}.`}
        </p>
      )}

      {!signed && !awaiting && (
        <p className="gg-card-meta">
          {pending
            ? gate
            : applicant
              ? `Approving emails them the ${what} to sign. ${gate}`
              : `${partner.businessName} hasn't been sent the ${what} yet. ${gate}`}
        </p>
      )}

      {/* An applicant's first agreement goes out with "Approve & send agreement" above. */}
      {canSend && !(applicant && !pending && !signed && !awaiting) && (
        <div className="gg-drawer-actions__buttons">
          <Button
            size="sm"
            variant={signed || pending || awaiting ? "ghost" : "primary"}
            icon="mail"
            loading={busy === "send"}
            onClick={() => void send()}
          >
            {awaiting ? "Send a new agreement instead" : pending ? "Resend agreement" : signed ? "Send a new agreement" : "Send agreement"}
          </Button>
          {signUrl && (
            <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyLink()}>
              Copy signing link
            </Button>
          )}
        </div>
      )}
      {canSend && (pending || signed || awaiting) && (
        <p className="gg-card-meta">
          {awaiting
            ? "Only if their details are wrong: a new agreement cancels the one they signed, and they sign again."
            : signed
              ? "Send a new agreement after changing their fee, or to move them to the newest version. The one in effect stays in force until the new one is."
              : "Resending makes a new link at their current fee; the old link stops working."}
        </p>
      )}
    </section>
  );
}

/** Geega Games countersigns: the agreement takes effect, and an applicant goes live. */
function CountersignPanel({
  partner,
  agreement,
  replacing,
  onChanged,
}: {
  partner: Partner;
  agreement: PartnerAgreement;
  replacing: PartnerAgreement | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(OWNER_NAME);
  const [title, setTitle] = useState("Owner");
  const [typedSignature, setTypedSignature] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = countersignProblems({ name, title, typedSignature, authorized });
  const entity = entityLine(agreement);

  async function countersign() {
    setShowProblems(true);
    if (problems.length) return;
    setBusy(true);
    try {
      const r = await partnersRepository.countersign(partner.id, agreement.id, { name, title, typedSignature, authorized });
      toast.success(
        `Countersigned. The ${agreement.title} is in effect${r.activated ? ` and ${partner.businessName} is now active` : ""}.${
          r.pdfEmailed ? " The signed PDF was emailed to both of you." : " The signed PDF email didn't send; download it below and send it yourself."
        }`,
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't countersign.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gg-partner-countersign">
      <p>
        <strong>{agreement.signerName}</strong>
        {agreement.signerTitle ? ` (${agreement.signerTitle})` : ""} signed the {agreement.title} (version {agreement.versionNumber}) on{" "}
        {formatDateTime(agreement.signedAt)}, at a {formatPercent(agreement.feePercent)} fee. It takes effect when you countersign
        {replacing ? ", replacing the one in effect now" : ""}.
      </p>
      <dl className="gg-partner-countersign__facts">
        <dt>Signing for</dt>
        <dd>{entity ?? partner.businessName}</dd>
        <dt>Business address</dt>
        <dd>{agreement.businessAddress ?? "Not given"}</dd>
        <dt>Signing link sent to</dt>
        <dd>{agreement.invitedEmail}</dd>
      </dl>
      <p className="gg-card-meta">Check the legal entity and address are real and match who applied before you countersign.</p>
      <div className="gg-partner-countersign__form">
        <TextField label="Your full legal name" value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        <TextField label="Your title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Signature: type your full legal name again"
          value={typedSignature}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setTypedSignature(e.target.value)}
        />
        <label className="gg-check-inline">
          <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
          I&rsquo;m authorized to sign for {LEGAL_NAME}, and I&rsquo;ve checked the partner&rsquo;s details above.
        </label>
      </div>
      {showProblems && problems.length > 0 && (
        <ul className="gg-partner-agreement__warn" role="alert">
          {problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="primary" icon="check" loading={busy} onClick={() => void countersign()}>
          Countersign for Geega Games
        </Button>
      </div>
    </div>
  );
}
