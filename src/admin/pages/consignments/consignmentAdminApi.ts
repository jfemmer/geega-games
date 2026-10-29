import { adminFetch } from "../../repositories/apiClient";
import type { ConsignmentChannel } from "../../../store/lib/consignmentMath";
import type { CardCondition, CardFinish, ReceiveLineInput, ResolvedLine } from "../../../store/lib/consignmentReceiving";

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
  batches: ReceivingBatch[];
  lots: LotRecord[];
  lotEvents: LotEvent[];
  sales: SaleRecord[];
  payouts: PayoutRecord[];
  lotQuantities: LotQuantities[];
  listings: { id: string; consignment_lot_id: string; quantity: number; price_cents: number | null; status: string }[];
}

export interface LotQuantities {
  lot_id: string;
  accepted: number;
  on_sale: number;
  pending: number;
  sold: number;
  unlisted: number;
}

export type SaleChannel = ConsignmentChannel;
export type SaleStatus = "open" | "settled" | "paid" | "cancelled";

export interface SaleRecord {
  id: string;
  lot_id: string;
  channel: SaleChannel;
  order_id: string | null;
  external_order_ref: string | null;
  quantity: number;
  unit_price_cents: number;
  gross_cents: number;
  sold_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  payable_at: string | null;
  status: SaleStatus;
  marketplace_fee_cents: number | null;
  processing_fee_cents: number | null;
  postage_cents: number | null;
  insurance_cents: number | null;
  other_expense_cents: number | null;
  other_expense_note: string | null;
  net_sale_cents: number | null;
  commission_rate_bps: number | null;
  commission_cents: number | null;
  payout_cents: number | null;
  settled_at: string | null;
  settled_by: string | null;
  payout_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  restocked: boolean;
  flag: string | null;
  notes: string | null;
}

export interface PayoutRecord {
  id: string;
  amount_cents: number;
  sale_count: number;
  method: string;
  reference: string | null;
  paid_at: string;
  note: string | null;
  created_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface SettlementExpenses {
  marketplaceFeeCents: number;
  processingFeeCents: number;
  postageCents: number;
  insuranceCents: number;
  otherExpenseCents: number;
}

export interface SettlementProposal {
  saleId: string;
  expenses: SettlementExpenses;
  basis: string[];
  warnings: string[];
  preview: { grossCents: number; expensesCents: number; netSaleCents: number; commissionRateBps: number; commissionCents: number; payoutCents: number };
}

export interface ExternalSaleInput {
  lotId: string;
  channel: "tcgplayer" | "ebay";
  quantity: number;
  unitPriceCents: number;
  soldAt: string;
  externalRef: string;
  marketplaceFeeCents: number;
  processingFeeCents: number;
  postageCents: number;
  notes?: string;
}

export type LotStatus = "submitted" | "received" | "under_inspection" | "accepted" | "rejected" | "listed" | "reserved_for_sale" | "sold" | "returned";

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  submitted: "Submitted",
  received: "Received",
  under_inspection: "Being inspected",
  accepted: "Accepted",
  rejected: "Rejected",
  listed: "Listed",
  reserved_for_sale: "Reserved for a sale",
  sold: "Sold",
  returned: "Returned",
};

export interface ReceivingBatch {
  id: string;
  batch_number: number;
  received_at: string;
  method: "mail" | "in_person";
  carrier: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_by: string | null;
}

export interface LotRecord {
  id: string;
  batch_id: string | null;
  scryfall_id: string | null;
  card_name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string | null;
  image_url: string | null;
  language: string;
  finish: CardFinish;
  declared_condition: CardCondition | null;
  condition: CardCondition | null;
  quantity_submitted: number | null;
  quantity_accepted: number;
  quantity_rejected: number;
  market_price_cents: number | null;
  list_price_cents: number | null;
  min_price_cents: number | null;
  rejection_reason: string | null;
  internal_notes: string | null;
  status: LotStatus;
  inspected_at: string | null;
  inspected_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

export interface LotEvent {
  id: string;
  lot_id: string;
  event: "received" | "inspection_started" | "accepted" | "rejected" | "reopened";
  from_status: string | null;
  to_status: string;
  details: Record<string, unknown>;
  actor: string | null;
  created_at: string;
}

export interface ReceivePreview {
  lines: ResolvedLine[];
  ok: boolean;
  copies: number;
}

export interface ReceiveShipment {
  method: "mail" | "in_person";
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
}

export type InspectStep =
  | { step: "start" }
  | { step: "reopen" }
  | { step: "reject"; reason: string }
  | {
      step: "accept";
      quantityAccepted: number;
      condition: CardCondition;
      finish: CardFinish;
      listPriceCents: number;
      minPriceCents: number | null;
      reason?: string;
      allowBelowMinimum?: boolean;
    };

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
  previewReceive: (lines: ReceiveLineInput[]) => post<ReceivePreview>({ action: "previewReceive", lines }),
  receiveCards: (consignmentId: string, lines: ReceiveLineInput[], shipment: ReceiveShipment) =>
    post<{ batchId: string; lines: number }>({ action: "receiveCards", consignmentId, lines, ...shipment }),
  inspectLot: (lotId: string, step: InspectStep) => post<{ status: LotStatus }>({ action: "inspectLot", lotId, ...step }),
  listLot: (lotId: string, quantity: number, priceCents: number | null) => post<{ inventoryId: string }>({ action: "listLot", lotId, quantity, priceCents }),
  unlistLot: (lotId: string, quantity: number) => post<{ status: LotStatus }>({ action: "unlistLot", lotId, quantity }),
  setLotPrice: (lotId: string, priceCents: number) => post<{ ok: true }>({ action: "setLotPrice", lotId, priceCents }),
  recordExternalSale: (input: ExternalSaleInput) => post<{ saleId: string }>({ action: "recordExternalSale", ...input }),
  markSaleDelivered: (saleId: string, deliveredAt: string) => post<{ payableAt: string }>({ action: "markSaleDelivered", saleId, deliveredAt }),
  settlement: (saleId: string) => adminFetch<SettlementProposal>(`${API}?view=settlement&sale=${encodeURIComponent(saleId)}`),
  settleSale: (saleId: string, expenses: SettlementExpenses, otherExpenseNote: string, adjustmentNote: string) =>
    post<{ payoutCents: number }>({ action: "settleSale", saleId, expenses, otherExpenseNote, adjustmentNote }),
  unsettleSale: (saleId: string) => post<{ ok: true }>({ action: "unsettleSale", saleId }),
  cancelSale: (saleId: string, reason: string) => post<{ ok: true }>({ action: "cancelSale", saleId, reason }),
  recordPayout: (input: { consignmentId: string; saleIds: string[]; method: string; reference: string; paidAt: string; note: string }) =>
    post<{ payoutId: string }>({ action: "recordPayout", ...input }),
  voidPayout: (payoutId: string, reason: string) => post<{ ok: true }>({ action: "voidPayout", payoutId, reason }),
  publish: (id: string) => post<{ versions: AgreementVersion[] }>({ action: "publishVersion", id, confirm: true }).then((r) => r.versions),
};
