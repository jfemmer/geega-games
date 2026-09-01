/**
 * database.ts — Types for the Supabase schema.
 *
 * This is a hand-authored, faithful mirror of supabase/migrations/*.sql for
 * Phase 2. Once you run the project locally, REGENERATE it from the live schema
 * for perfect fidelity:
 *
 *   npm run db:types        # supabase gen types typescript --local
 *
 * Keeping this file generated going forward avoids drift.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---- Enums ------------------------------------------------------------------
export type AppRole = 'customer' | 'staff' | 'admin';
export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
export type CardFinish = 'nonfoil' | 'foil' | 'etched' | 'glossy';
export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'packing'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';
export type PaymentProvider = 'stripe' | 'paypal' | 'store_credit' | 'manual';
export type PaymentStatus =
  | 'unpaid'
  | 'processing'
  | 'paid'
  | 'refunded'
  | 'failed';
export type ShippingMethod = 'tracked' | 'pwe';
export type TradeInStatus =
  | 'new'
  | 'received'
  | 'evaluating'
  | 'offer_made'
  | 'accepted'
  | 'paid_out'
  | 'rejected'
  | 'cancelled';
export type StoreCreditType =
  | 'opening_balance'
  | 'admin_adjustment'
  | 'order_spend'
  | 'order_refund'
  | 'trade_in_payout';
export type ScanJobStatus = 'queued' | 'processing' | 'done' | 'failed';
export type ScanReviewStatus = 'pending' | 'approved' | 'corrected' | 'rejected';

// ---- Row helpers ------------------------------------------------------------
interface Profiles {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  announcement_notifications: Json;
  shipping_notifications: Json;
  legacy_mongo_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Addresses {
  id: string;
  user_id: string;
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
  legacy_mongo_id: string | null;
  created_at: string;
  updated_at: string;
}

interface InventoryItems {
  id: string;
  scryfall_id: string | null;
  oracle_id: string | null;
  set_code: string;
  collector_number: string;
  language: string;
  card_name: string;
  set_name: string | null;
  rarity: string | null;
  type_line: string | null;
  colors: string[];
  creature_types: string[];
  image_url: string | null;
  condition: CardCondition;
  finish: CardFinish;
  foil: boolean;
  variant_type: string;
  quantity: number;
  price_cents: number | null;
  cost_cents: number | null;
  legacy_mongo_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Carts {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface CartItems {
  id: string;
  cart_id: string;
  inventory_item_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

interface Orders {
  id: string;
  user_id: string;
  email: string;
  ship_recipient: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal_code: string | null;
  ship_country: string | null;
  subtotal_cents: number;
  shipping_cents: number;
  discount_cents: number;
  store_credit_used_cents: number;
  total_cents: number;
  amount_due_cents: number;
  shipping_method: ShippingMethod;
  payment_provider: PaymentProvider | null;
  payment_reference: string | null;
  payment_status: PaymentStatus;
  paid_at: string | null;
  status: OrderStatus;
  packed_at: string | null;
  ready_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  legacy_mongo_id: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItems {
  id: string;
  order_id: string;
  inventory_item_id: string | null;
  scryfall_id: string | null;
  set_code: string | null;
  collector_number: string | null;
  card_name: string;
  set_name: string | null;
  condition: CardCondition;
  finish: CardFinish;
  variant_type: string;
  image_url: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  created_at: string;
}

interface StoreCreditTransactions {
  id: string;
  user_id: string;
  amount_cents: number;
  type: StoreCreditType;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
}

interface TradeIns {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: TradeInStatus;
  total_cards: number;
  estimated_value_cents: number | null;
  offer_value_cents: number | null;
  source: string | null;
  notes: string | null;
  internal_notes: string | null;
  legacy_mongo_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TradeInItems {
  id: string;
  trade_in_id: string;
  scryfall_id: string | null;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  condition: CardCondition | null;
  finish: CardFinish;
  quantity: number;
  image_url: string | null;
  created_at: string;
}

interface ScannerReviewQueue {
  id: string;
  result_id: string | null;
  status: ScanReviewStatus;
  reason: string | null;
  review_hash: string | null;
  guessed_name: string | null;
  predicted_set: string | null;
  collector_number: string | null;
  symbol_match: string | null;
  confidence: number | null;
  condition: CardCondition | null;
  finish: CardFinish;
  candidates: Json;
  image_storage_key: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  corrected_scryfall_id: string | null;
  created_inventory_item_id: string | null;
  created_at: string;
  updated_at: string;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profiles>;
      addresses: Table<Addresses>;
      inventory_items: Table<InventoryItems>;
      carts: Table<Carts>;
      cart_items: Table<CartItems>;
      orders: Table<Orders>;
      order_items: Table<OrderItems>;
      store_credit_transactions: Table<StoreCreditTransactions>;
      trade_ins: Table<TradeIns>;
      trade_in_items: Table<TradeInItems>;
      scanner_review_queue: Table<ScannerReviewQueue>;
    };
    Views: {
      inventory_public: {
        Row: Omit<InventoryItems, 'cost_cents' | 'legacy_mongo_id' | 'created_at' | 'updated_at'>;
        Relationships: [];
      };
    };
    Functions: {
      checkout_create_order: {
        Args: {
          p_shipping_method: ShippingMethod;
          p_store_credit_requested_cents?: number;
          p_ship_recipient?: string | null;
          p_ship_line1?: string | null;
          p_ship_line2?: string | null;
          p_ship_city?: string | null;
          p_ship_state?: string | null;
          p_ship_postal_code?: string | null;
          p_ship_country?: string | null;
        };
        Returns: {
          order_id: string;
          subtotal_cents: number;
          shipping_cents: number;
          total_cents: number;
          store_credit_used_cents: number;
          amount_due_cents: number;
        }[];
      };
      my_store_credit_balance: { Args: Record<string, never>; Returns: number };
      store_credit_balance: { Args: { p_user_id: string }; Returns: number };
      admin_adjust_store_credit: {
        Args: { p_user_id: string; p_amount_cents: number; p_reason?: string | null };
        Returns: number;
      };
      get_or_create_my_cart: { Args: Record<string, never>; Returns: string };
    };
    Enums: {
      app_role: AppRole;
      card_condition: CardCondition;
      card_finish: CardFinish;
      order_status: OrderStatus;
      payment_provider: PaymentProvider;
      payment_status: PaymentStatus;
      shipping_method: ShippingMethod;
      trade_in_status: TradeInStatus;
      store_credit_type: StoreCreditType;
    };
    CompositeTypes: Record<string, never>;
  };
}
