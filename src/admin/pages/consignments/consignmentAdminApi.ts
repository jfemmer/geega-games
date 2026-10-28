import { adminFetch } from "../../repositories/apiClient";
import type { ConsignmentChannel } from "../../../store/lib/consignmentMath";

// Typed calls to /api/admin/consignments for the Consignments pages.

const API = "/api/admin/consignments";

export type ConsignmentStatus = "draft" | "awaiting_signature" | "signed" | "inventory_received" | "active" | "terminated" | "closed";

export const CONSIGNMENT_STATUS_LABELS: Record<ConsignmentStatus, string> = {
  draft: "Draft",
  awaiting_signature: "Awaiting customer signature",
  signed: "Signed",
  inventory_received: "Inventory received",
  active: "Active",
  terminated: "Terminated",
  closed: "Closed",
};

export interface ConsignmentListRow {
  id: string;
  consignmentNumber: number;
  label: string;
  status: ConsignmentStatus;
  createdAt: string;
  signedAt: string | null;
  consignor: { id: string; legalName: string; email: string; stateCode: string | null; hasAccount: boolean };
  agreement: { id: string; status: "pending" | "signed"; invitedAt: string; expiresAt: string; lastEmailedAt: string | null } | null;
}

export interface ConsignorRecord {
  id: string;
  user_id: string | null;
  legal_name: string;
  email: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  admin_notes: string | null;
  created_at: string;
}

export interface AgreementRecord {
  id: string;
  status: "pending" | "signed" | "void";
  rendered_sha256: string;
  invited_email: string;
  invited_at: string;
  invite_expires_at: string;
  invited_by: string | null;
  last_emailed_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
}

export interface SignatureRecord {
  id: string;
  agreement_id: string;
  legal_name: string;
  typed_signature: string;
  signer_email: string;
  signed_at: string;
  ip: string | null;
  user_agent: string | null;
  channels: Record<ConsignmentChannel, boolean>;
  additional_insurance: boolean;
  agreement_sha256: string;
  record_sha256: string;
  pdf_sha256: string | null;
  emailed_at: string | null;
  hasPdf: boolean;
}

export interface ConsignmentDetail {
  consignment: {
    id: string;
    label: string;
    consignment_number: number;
    status: ConsignmentStatus;
    signed_at: string | null;
    term_started_at: string | null;
    initial_term_days: number;
    admin_notes: string | null;
    created_at: string;
    created_by: string | null;
  };
  consignor: ConsignorRecord;
  agreements: AgreementRecord[];
  signatures: SignatureRecord[];
  elections: { channels: Partial<Record<ConsignmentChannel, boolean>>; additionalInsurance: boolean | null } | null;
}

export interface AgreementVersion {
  id: string;
  version_number: number;
  title: string;
  body_md: string;
  body_sha256: string;
  change_summary: string | null;
  status: "draft" | "published" | "retired";
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  problems: { kind: "blank" | "unknown_field"; text: string }[];
}

export interface NewConsignmentInput {
  consignor: {
    legalName: string;
    email: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateCode?: string;
    postalCode?: string;
  };
  adminNotes?: string;
}

const post = <T,>(body: Record<string, unknown>) => adminFetch<T>(API, { method: "POST", body });

export const consignmentAdminApi = {
  list: () => adminFetch<{ consignments: ConsignmentListRow[] }>(`${API}?view=list`).then((r) => r.consignments),
  detail: (id: string) => adminFetch<ConsignmentDetail>(`${API}?view=detail&id=${encodeURIComponent(id)}`),
  versions: () => adminFetch<{ versions: AgreementVersion[] }>(`${API}?view=versions`).then((r) => r.versions),
  pdfUrl: (signatureId: string) => adminFetch<{ url: string }>(`${API}?view=pdf&signature=${encodeURIComponent(signatureId)}`).then((r) => r.url),
  create: (input: NewConsignmentInput) =>
    post<{ consignment: { id: string; label: string } }>({ action: "createConsignment", ...input }).then((r) => r.consignment),
  invite: (consignmentId: string) =>
    post<{ invitation: { agreementId: string; emailed: boolean; signUrl: string } }>({ action: "sendInvitation", consignmentId }).then((r) => r.invitation),
  voidAgreement: (agreementId: string, reason: string) => post<{ ok: true }>({ action: "voidAgreement", agreementId, reason }),
  resendSignedCopy: (signatureId: string) => post<{ copy: { emailed: boolean } }>({ action: "resendSignedCopy", signatureId }).then((r) => r.copy),
  saveDraft: (input: { id?: string; title: string; bodyMd: string; changeSummary?: string }) =>
    post<{ versions: AgreementVersion[] }>({ action: "saveDraft", ...input }).then((r) => r.versions),
  deleteDraft: (id: string) => post<{ versions: AgreementVersion[] }>({ action: "deleteDraft", id }).then((r) => r.versions),
  publish: (id: string) => post<{ versions: AgreementVersion[] }>({ action: "publishVersion", id, confirm: true }).then((r) => r.versions),
};
