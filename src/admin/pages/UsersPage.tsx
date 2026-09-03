import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { SearchInput, SelectField, TextField } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { userRepository } from "../repositories";
import { CURRENT_ADMIN } from "../data/session.mock";
import {
  formatCents,
  formatDate,
  timeAgo,
  fullName,
} from "../utils/format";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_TONE,
  SUBSCRIBER_STATUS_LABELS,
  SUBSCRIBER_STATUS_TONE,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_TONE,
} from "../utils/labels";
import type {
  AccountStatus,
  Customer,
  CustomerQuery,
  StaffMember,
  StaffRole,
} from "../types";

type View = "customers" | "staff";

const ROLES: StaffRole[] = ["owner", "administrator", "fulfillment", "inventory"];

export function UsersPage({ query }: { query: URLSearchParams }) {
  const [view, setView] = useState<View>("customers");

  return (
    <div className="gg-page">
      <PageHeader
        title="Users"
        description="Customers who shop with you and the staff who run the store."
      />
      <div className="gg-subtabs">
        <Tabs
          items={[
            { key: "customers", label: "Customers" },
            { key: "staff", label: "Staff" },
          ]}
          active={view}
          onChange={(k) => setView(k as View)}
          ariaLabel="User type"
        />
      </div>
      {view === "customers" ? <CustomersView query={query} /> : <StaffView />}
    </div>
  );
}

/* ----------------------------- Customers ----------------------------- */

function CustomersView({ query }: { query: URLSearchParams }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [accountStatus, setAccountStatus] = useState<AccountStatus | "all">("all");
  const [subscriber, setSubscriber] = useState<
    "all" | "subscribed" | "not_subscribed"
  >("all");
  const [detail, setDetail] = useState<Customer | null>(null);
  const [statusTarget, setStatusTarget] = useState<Customer | null>(null);

  const q: CustomerQuery = useMemo(
    () => ({
      search: search.trim() || undefined,
      accountStatus,
      subscriber,
    }),
    [search, accountStatus, subscriber],
  );

  const customers = useAsync(() => userRepository.listCustomers(q), [q]);

  useEffect(() => {
    const id = query.get("customer");
    if (id) {
      userRepository.getCustomer(id).then((c) => {
        if (c) setDetail(c);
      });
    }
  }, [query]);

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      render: (c) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {fullName(c.firstName, c.lastName)}
          </span>
          <span className="gg-ordercell__cust">{c.email}</span>
        </div>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      render: (c) => c.orderCount,
    },
    {
      key: "spend",
      header: "Lifetime",
      align: "right",
      render: (c) => formatCents(c.lifetimeSpendCents),
    },
    {
      key: "sub",
      header: "Newsletter",
      secondary: true,
      render: (c) =>
        c.subscriberStatus ? (
          <Badge tone={SUBSCRIBER_STATUS_TONE[c.subscriberStatus]}>
            {SUBSCRIBER_STATUS_LABELS[c.subscriberStatus]}
          </Badge>
        ) : (
          <span className="gg-muted">—</span>
        ),
    },
    {
      key: "status",
      header: "Account",
      render: (c) => (
        <Badge tone={ACCOUNT_STATUS_TONE[c.accountStatus]}>
          {ACCOUNT_STATUS_LABELS[c.accountStatus]}
        </Badge>
      ),
    },
    {
      key: "last",
      header: "Last order",
      align: "right",
      secondary: true,
      render: (c) => (c.lastOrderAt ? timeAgo(c.lastOrderAt) : "—"),
    },
  ];

  return (
    <SectionCard title="">
      <div className="gg-filters">
        <SearchInput
          label="Search customers"
          placeholder="Name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="gg-filters__selects">
          <SelectField
            label="Account"
            value={accountStatus}
            onChange={(e) =>
              setAccountStatus(e.target.value as AccountStatus | "all")
            }
          >
            <option value="all">All accounts</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </SelectField>
          <SelectField
            label="Newsletter"
            value={subscriber}
            onChange={(e) => setSubscriber(e.target.value as typeof subscriber)}
          >
            <option value="all">Any subscription</option>
            <option value="subscribed">Subscribed</option>
            <option value="not_subscribed">Not subscribed</option>
          </SelectField>
        </div>
      </div>

      {customers.loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : customers.error ? (
        <ErrorState message="Could not load customers." onRetry={customers.reload} />
      ) : (customers.data ?? []).length === 0 ? (
        <EmptyState icon="users" title="No customers found" message="Try another search." />
      ) : (
        <DataTable
          columns={columns}
          rows={customers.data ?? []}
          rowKey={(c) => c.id}
          onRowClick={(c) => setDetail(c)}
          caption="Customers"
        />
      )}

      <CustomerDetail
        customer={detail}
        onClose={() => setDetail(null)}
        onToggleStatus={(c) => setStatusTarget(c)}
      />

      <ConfirmDialog
        open={!!statusTarget}
        title={
          statusTarget?.accountStatus === "active"
            ? "Disable this account?"
            : "Re-enable this account?"
        }
        message={
          statusTarget
            ? statusTarget.accountStatus === "active"
              ? `${fullName(statusTarget.firstName, statusTarget.lastName)} won't be able to sign in or place orders until re-enabled.`
              : `${fullName(statusTarget.firstName, statusTarget.lastName)} will be able to sign in and place orders again.`
            : ""
        }
        confirmLabel={
          statusTarget?.accountStatus === "active" ? "Disable" : "Re-enable"
        }
        tone={statusTarget?.accountStatus === "active" ? "danger" : "primary"}
        onConfirm={async () => {
          if (!statusTarget) return;
          const next =
            statusTarget.accountStatus === "active" ? "disabled" : "active";
          const updated = await userRepository.setCustomerStatus(
            statusTarget.id,
            next,
          );
          toast.success(
            `${fullName(updated.firstName, updated.lastName)} ${
              next === "disabled" ? "disabled" : "re-enabled"
            }.`,
          );
          setDetail(updated);
          setStatusTarget(null);
          customers.reload();
        }}
        onCancel={() => setStatusTarget(null)}
      />
    </SectionCard>
  );
}

function CustomerDetail({
  customer,
  onClose,
  onToggleStatus,
}: {
  customer: Customer | null;
  onClose: () => void;
  onToggleStatus: (c: Customer) => void;
}) {
  if (!customer) return null;
  return (
    <Modal
      open={!!customer}
      onClose={onClose}
      title={fullName(customer.firstName, customer.lastName)}
      variant="drawer"
      size="md"
      headerExtra={
        <Badge tone={ACCOUNT_STATUS_TONE[customer.accountStatus]}>
          {ACCOUNT_STATUS_LABELS[customer.accountStatus]}
        </Badge>
      }
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button
            variant={customer.accountStatus === "active" ? "danger" : "primary"}
            onClick={() => onToggleStatus(customer)}
          >
            {customer.accountStatus === "active"
              ? "Disable account"
              : "Re-enable account"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="gg-detail">
        <dl className="gg-detail__facts gg-detail__facts--stack">
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${customer.email}`} className="gg-link">
                {customer.email}
              </a>
            </dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(customer.createdAt)}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>{customer.lastSignInAt ? timeAgo(customer.lastSignInAt) : "—"}</dd>
          </div>
          <div>
            <dt>Orders</dt>
            <dd>{customer.orderCount}</dd>
          </div>
          <div>
            <dt>Lifetime spend</dt>
            <dd>{formatCents(customer.lifetimeSpendCents)}</dd>
          </div>
          <div>
            <dt>Newsletter</dt>
            <dd>
              {customer.subscriberStatus
                ? SUBSCRIBER_STATUS_LABELS[customer.subscriberStatus]
                : "Not subscribed"}
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}

/* ------------------------------- Staff ------------------------------- */

function StaffView() {
  const toast = useToast();
  const staff = useAsync(() => userRepository.listStaff(), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detail, setDetail] = useState<StaffMember | null>(null);

  const owners = (staff.data ?? []).filter(
    (s) => s.role === "owner" && s.status === "active",
  ).length;

  const columns: Column<StaffMember>[] = [
    {
      key: "name",
      header: "Staff member",
      render: (s) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {fullName(s.firstName, s.lastName)}
          </span>
          <span className="gg-ordercell__cust">{s.email}</span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (s) => (
        <Badge tone={STAFF_ROLE_TONE[s.role]}>{STAFF_ROLE_LABELS[s.role]}</Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <Badge tone={ACCOUNT_STATUS_TONE[s.status]}>
          {ACCOUNT_STATUS_LABELS[s.status]}
        </Badge>
      ),
    },
    {
      key: "active",
      header: "Last active",
      align: "right",
      secondary: true,
      render: (s) => (s.lastActiveAt ? timeAgo(s.lastActiveAt) : "—"),
    },
  ];

  return (
    <SectionCard
      title=""
      action={
        <Button variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>
          Invite staff
        </Button>
      }
    >
      {staff.loading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : staff.error ? (
        <ErrorState message="Could not load staff." onRetry={staff.reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={staff.data ?? []}
          rowKey={(s) => s.id}
          onRowClick={(s) => setDetail(s)}
          caption="Staff"
        />
      )}

      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={() => staff.reload()}
      />

      <StaffDetail
        member={detail}
        ownerCount={owners}
        onClose={() => setDetail(null)}
        onChanged={(updated) => {
          setDetail(updated);
          staff.reload();
        }}
        onError={(msg) => toast.error(msg)}
        onSuccess={(msg) => toast.success(msg)}
      />
    </SectionCard>
  );
}

function InviteStaffModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [role, setRole] = useState<StaffRole>("fulfillment");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setFirst("");
      setLast("");
      setRole("fulfillment");
    }
  }, [open]);

  async function submit() {
    if (!email.trim() || !first.trim() || !last.trim()) {
      toast.error("Fill in name and email.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await userRepository.inviteStaff(
        email.trim(),
        first.trim(),
        last.trim(),
        role,
      );
      toast.success(
        `Invitation prepared for ${email.trim()} (not actually emailed in the mock).`,
      );
      onInvited();
      onClose();
    } catch {
      toast.error("Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite staff"
      size="sm"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Send invite
          </Button>
        </div>
      }
    >
      <div className="gg-form-grid">
        <TextField
          label="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
        />
        <TextField
          label="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
        />
      </div>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <SelectField
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value as StaffRole)}
        hint="Owners can manage staff and billing. Others are scoped to their work."
      >
        {ROLES.filter((r) => r !== "owner").map((r) => (
          <option key={r} value={r}>
            {STAFF_ROLE_LABELS[r]}
          </option>
        ))}
      </SelectField>
    </Modal>
  );
}

function StaffDetail({
  member,
  ownerCount,
  onClose,
  onChanged,
  onError,
  onSuccess,
}: {
  member: StaffMember | null;
  ownerCount: number;
  onClose: () => void;
  onChanged: (m: StaffMember) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const [role, setRole] = useState<StaffRole>("fulfillment");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (member) setRole(member.role);
  }, [member]);

  if (!member) return null;

  const isSelf = member.id === CURRENT_ADMIN.id;
  const isLastOwner =
    member.role === "owner" && member.status === "active" && ownerCount <= 1;

  async function saveRole() {
    if (!member) return;
    if (isSelf && member.role === "owner" && role !== "owner") {
      onError("You can't remove your own owner role — ask another owner.");
      return;
    }
    if (isLastOwner && role !== "owner") {
      onError("The store must always have at least one active owner.");
      return;
    }
    setBusy(true);
    try {
      const updated = await userRepository.setStaffRole(member.id, role);
      onSuccess(`${fullName(updated.firstName, updated.lastName)} is now ${STAFF_ROLE_LABELS[updated.role]}.`);
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!member) return;
    const next = member.status === "active" ? "disabled" : "active";
    if (next === "disabled" && isSelf) {
      onError("You can't disable your own account.");
      return;
    }
    if (next === "disabled" && isLastOwner) {
      onError("The store must always have at least one active owner.");
      return;
    }
    setBusy(true);
    try {
      const updated = await userRepository.setStaffStatus(member.id, next);
      onSuccess(
        `${fullName(updated.firstName, updated.lastName)} ${
          next === "disabled" ? "disabled" : "re-enabled"
        }.`,
      );
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      title={fullName(member.firstName, member.lastName)}
      variant="drawer"
      size="md"
      headerExtra={
        <Badge tone={ACCOUNT_STATUS_TONE[member.status]}>
          {ACCOUNT_STATUS_LABELS[member.status]}
        </Badge>
      }
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button
            variant={member.status === "active" ? "danger" : "primary"}
            onClick={toggleStatus}
            loading={busy}
            disabled={isSelf || isLastOwner}
          >
            {member.status === "active" ? "Disable" : "Re-enable"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="gg-detail">
        <dl className="gg-detail__facts gg-detail__facts--stack">
          <div>
            <dt>Email</dt>
            <dd>{member.email}</dd>
          </div>
          <div>
            <dt>Last active</dt>
            <dd>{member.lastActiveAt ? timeAgo(member.lastActiveAt) : "—"}</dd>
          </div>
        </dl>

        <div className="gg-detail__section">
          <h3 className="gg-detail__h3">Role</h3>
          <div className="gg-rolerow">
            <SelectField
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              disabled={isSelf && member.role === "owner"}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </SelectField>
            <Button
              variant="secondary"
              onClick={saveRole}
              loading={busy}
              disabled={role === member.role}
            >
              Save role
            </Button>
          </div>
          {isSelf && (
            <p className="gg-muted">
              You can't change your own owner role or disable yourself — a
              safeguard so the store always has an owner.
            </p>
          )}
          {isLastOwner && !isSelf && (
            <p className="gg-muted">
              This is the last active owner and can't be demoted or disabled.
            </p>
          )}
        </div>

        {member.recentActivity.length > 0 && (
          <div className="gg-detail__section">
            <h3 className="gg-detail__h3">Recent activity</h3>
            <ul className="gg-activity-list">
              {member.recentActivity.map((a) => (
                <li key={a.id} className="gg-activity">
                  <span className="gg-activity__dot" aria-hidden="true" />
                  <span className="gg-activity__text">{a.action}</span>
                  <span className="gg-activity__time">{timeAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
