// LIVE UserRepository — real customers (Supabase) + real staff (Auth Admin API).
//
// Customers: read through the staff-gated admin_customer_list RPC (browser
//   client + publishable key; the SECURITY DEFINER RPC enforces is_staff()).
//   Enriched with real newsletter status, order count, lifetime spend, and last
//   sign-in. Manual add + status changes go through /api/admin/customers/*.
// Staff: read/managed through /api/admin/staff/* which uses the Auth Admin API
//   server-side (never the browser). Roles live in trusted app_metadata.
//
// No mock people are ever loaded here.

import { supabase } from "../../supabase";
import type {
  Customer,
  CustomerQuery,
  StaffMember,
  StaffRole,
} from "../types";
import type { UserRepository } from "./types";
import { adminFetch } from "./apiClient";
import type { Database } from "../../types/database";

type CustomerListRow =
  Database["public"]["Functions"]["admin_customer_list"]["Returns"][number];

export function mapCustomerRow(row: CustomerListRow): Customer {
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at ?? null,
    orderCount: Number(row.order_count ?? 0),
    lifetimeSpendCents: Number(row.lifetime_spend_cents ?? 0),
    lastOrderAt: row.last_order_at ?? null,
    accountStatus: row.status,
    subscriberStatus: row.subscriber_status ?? null,
  };
}

function matchesQuery(c: Customer, query: CustomerQuery): boolean {
  const q = (query.search ?? "").trim().toLowerCase();
  const matchesSearch =
    !q ||
    c.email.toLowerCase().includes(q) ||
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(q);
  const matchesStatus =
    !query.accountStatus ||
    query.accountStatus === "all" ||
    c.accountStatus === query.accountStatus;
  const isSubscribed = c.subscriberStatus === "active";
  const matchesSub =
    !query.subscriber ||
    query.subscriber === "all" ||
    (query.subscriber === "subscribed" && isSubscribed) ||
    (query.subscriber === "not_subscribed" && !isSubscribed);
  return matchesSearch && matchesStatus && matchesSub;
}

export const supabaseUserRepository: UserRepository = {
  async listCustomers(query: CustomerQuery): Promise<Customer[]> {
    const { data, error } = await supabase.rpc("admin_customer_list");
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as CustomerListRow[]).map(mapCustomerRow);
    return rows.filter((c) => matchesQuery(c, query));
  },

  async getCustomer(id: string): Promise<Customer | null> {
    const { data, error } = await supabase.rpc("admin_customer_list");
    if (error) throw new Error(error.message);
    const row = ((data ?? []) as CustomerListRow[]).find((r) => r.id === id);
    return row ? mapCustomerRow(row) : null;
  },

  async addCustomer({ email, firstName, lastName }): Promise<{
    customer: Customer;
    created: boolean;
  }> {
    const res = await adminFetch<{
      created: boolean;
      customer: {
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        status: Customer["accountStatus"];
        created_at: string;
      };
    }>("/api/admin?resource=customers&action=create", {
      method: "POST",
      body: { email, firstName, lastName },
    });
    const c = res.customer;
    const customer: Customer = {
      id: c.id,
      firstName: c.first_name ?? "",
      lastName: c.last_name ?? "",
      email: c.email,
      createdAt: c.created_at,
      lastSignInAt: null,
      orderCount: 0,
      lifetimeSpendCents: 0,
      lastOrderAt: null,
      accountStatus: c.status,
      subscriberStatus: null,
    };
    return { customer, created: res.created };
  },

  async setCustomerStatus(
    id: string,
    status: Customer["accountStatus"],
  ): Promise<Customer> {
    await adminFetch<{ customer: unknown }>(
      `/api/admin?resource=customers&action=status&id=${encodeURIComponent(id)}`,
      {
        method: "POST",
        body: { status },
      },
    );
    // Re-read the enriched row so order/newsletter/sign-in data stay accurate.
    const fresh = await this.getCustomer(id);
    if (fresh) return fresh;
    // Fallback: minimal object if the row can't be re-read.
    return {
      id,
      firstName: "",
      lastName: "",
      email: "",
      createdAt: new Date().toISOString(),
      lastSignInAt: null,
      orderCount: 0,
      lifetimeSpendCents: 0,
      lastOrderAt: null,
      accountStatus: status,
      subscriberStatus: null,
    };
  },

  async listStaff(): Promise<StaffMember[]> {
    const res = await adminFetch<{ rows: StaffMember[] }>(
      "/api/admin?resource=staff&action=list",
      {
        method: "GET",
      },
    );
    return res.rows ?? [];
  },

  async inviteStaff(
    email: string,
    firstName: string,
    lastName: string,
    role: StaffRole,
  ): Promise<StaffMember> {
    const res = await adminFetch<{ staff: StaffMember }>(
      "/api/admin?resource=staff&action=invite",
      {
        method: "POST",
        body: { email, firstName, lastName, role },
      },
    );
    return res.staff;
  },

  async setStaffRole(id: string, role: StaffRole): Promise<StaffMember> {
    const res = await adminFetch<{ staff: StaffMember }>(
      `/api/admin?resource=staff&action=update&id=${encodeURIComponent(id)}`,
      { method: "PATCH", body: { role } },
    );
    return res.staff;
  },

  async setStaffStatus(
    id: string,
    status: StaffMember["status"],
  ): Promise<StaffMember> {
    const res = await adminFetch<{ staff: StaffMember }>(
      `/api/admin?resource=staff&action=update&id=${encodeURIComponent(id)}`,
      { method: "PATCH", body: { status } },
    );
    return res.staff;
  },
};