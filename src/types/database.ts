export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          legacy_mongo_id: string | null
          line1: string
          line2: string | null
          phone: string | null
          postal_code: string
          recipient: string | null
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          legacy_mongo_id?: string | null
          line1: string
          line2?: string | null
          phone?: string | null
          postal_code: string
          recipient?: string | null
          state: string
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          legacy_mongo_id?: string | null
          line1?: string
          line2?: string | null
          phone?: string | null
          postal_code?: string
          recipient?: string | null
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          audience: Database["public"]["Enums"]["campaign_audience"]
          body: string
          bounce_count: number
          button_text: string | null
          button_url: string | null
          click_count: number | null
          created_at: string
          created_by: string | null
          delivered_count: number
          id: string
          name: string
          open_count: number | null
          preview_text: string
          recipient_count: number
          scheduled_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          subject: string
          updated_at: string
        }
        Insert: {
          audience?: Database["public"]["Enums"]["campaign_audience"]
          body?: string
          bounce_count?: number
          button_text?: string | null
          button_url?: string | null
          click_count?: number | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          id?: string
          name: string
          open_count?: number | null
          preview_text?: string
          recipient_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject: string
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["campaign_audience"]
          body?: string
          bounce_count?: number
          button_text?: string | null
          button_url?: string | null
          click_count?: number | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          id?: string
          name?: string
          open_count?: number | null
          preview_text?: string
          recipient_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      card_printings: {
        Row: {
          artist: string | null
          available_finishes: string[]
          border_color: string | null
          card_name: string
          card_type: string | null
          collector_number: string
          created_at: string
          faces: Json | null
          frame: string | null
          frame_effects: string[]
          full_art: boolean
          images: Json | null
          language: string | null
          layout: string | null
          oracle_id: string | null
          price_usd_cents: number | null
          price_usd_etched_cents: number | null
          price_usd_foil_cents: number | null
          prices_updated_at: string | null
          promo: boolean
          promo_types: string[]
          rarity: string | null
          released_at: string | null
          scryfall_id: string
          set_code: string
          set_name: string | null
          textless: boolean
          treatments: string[]
          updated_at: string
        }
        Insert: {
          artist?: string | null
          available_finishes?: string[]
          border_color?: string | null
          card_name: string
          card_type?: string | null
          collector_number: string
          created_at?: string
          faces?: Json | null
          frame?: string | null
          frame_effects?: string[]
          full_art?: boolean
          images?: Json | null
          language?: string | null
          layout?: string | null
          oracle_id?: string | null
          price_usd_cents?: number | null
          price_usd_etched_cents?: number | null
          price_usd_foil_cents?: number | null
          prices_updated_at?: string | null
          promo?: boolean
          promo_types?: string[]
          rarity?: string | null
          released_at?: string | null
          scryfall_id: string
          set_code: string
          set_name?: string | null
          textless?: boolean
          treatments?: string[]
          updated_at?: string
        }
        Update: {
          artist?: string | null
          available_finishes?: string[]
          border_color?: string | null
          card_name?: string
          card_type?: string | null
          collector_number?: string
          created_at?: string
          faces?: Json | null
          frame?: string | null
          frame_effects?: string[]
          full_art?: boolean
          images?: Json | null
          language?: string | null
          layout?: string | null
          oracle_id?: string | null
          price_usd_cents?: number | null
          price_usd_etched_cents?: number | null
          price_usd_foil_cents?: number | null
          prices_updated_at?: string | null
          promo?: boolean
          promo_types?: string[]
          rarity?: string | null
          released_at?: string | null
          scryfall_id?: string
          set_code?: string
          set_name?: string | null
          textless?: boolean
          treatments?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      card_scans: {
        Row: {
          back_image_path: string | null
          condition_findings: Json | null
          confirmed_condition:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents: number | null
          created_at: string
          front_image_path: string | null
          id: string
          inventory_item_id: string | null
          notes: string | null
          price_cents: number | null
          quantity: number
          recognition_confidence: number | null
          recognition_data: Json | null
          recognition_status: Database["public"]["Enums"]["recognition_status"]
          review_status: Database["public"]["Enums"]["card_scan_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          scan_session_id: string
          selected_finish: Database["public"]["Enums"]["card_finish"] | null
          selected_scryfall_id: string | null
          sequence_number: number
          storage_location: string | null
          suggested_condition:
            | Database["public"]["Enums"]["card_condition"]
            | null
          suggested_condition_confidence: number | null
          updated_at: string
        }
        Insert: {
          back_image_path?: string | null
          condition_findings?: Json | null
          confirmed_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents?: number | null
          created_at?: string
          front_image_path?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          price_cents?: number | null
          quantity?: number
          recognition_confidence?: number | null
          recognition_data?: Json | null
          recognition_status?: Database["public"]["Enums"]["recognition_status"]
          review_status?: Database["public"]["Enums"]["card_scan_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_session_id: string
          selected_finish?: Database["public"]["Enums"]["card_finish"] | null
          selected_scryfall_id?: string | null
          sequence_number: number
          storage_location?: string | null
          suggested_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          suggested_condition_confidence?: number | null
          updated_at?: string
        }
        Update: {
          back_image_path?: string | null
          condition_findings?: Json | null
          confirmed_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents?: number | null
          created_at?: string
          front_image_path?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          price_cents?: number | null
          quantity?: number
          recognition_confidence?: number | null
          recognition_data?: Json | null
          recognition_status?: Database["public"]["Enums"]["recognition_status"]
          review_status?: Database["public"]["Enums"]["card_scan_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_session_id?: string
          selected_finish?: Database["public"]["Enums"]["card_finish"] | null
          selected_scryfall_id?: string | null
          sequence_number?: number
          storage_location?: string | null
          suggested_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          suggested_condition_confidence?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_scans_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_scans_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_scans_scan_session_id_fkey"
            columns: ["scan_session_id"]
            isOneToOne: false
            referencedRelation: "scan_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_scans_selected_scryfall_id_fkey"
            columns: ["selected_scryfall_id"]
            isOneToOne: false
            referencedRelation: "card_printings"
            referencedColumns: ["scryfall_id"]
          },
        ]
      }
      cards: {
        Row: {
          condition: string
          created_at: string
          foil: boolean
          id: number
          image_url: string | null
          name: string
          price_usd: number
          quantity: number
          set: string | null
          type: string | null
        }
        Insert: {
          condition?: string
          created_at?: string
          foil?: boolean
          id?: never
          image_url?: string | null
          name: string
          price_usd?: number
          quantity?: number
          set?: string | null
          type?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          foil?: boolean
          id?: never
          image_url?: string | null
          name?: string
          price_usd?: number
          quantity?: number
          set?: string | null
          type?: string | null
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          inventory_item_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          inventory_item_id: string
          quantity: number
          updated_at?: string
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          source: Database["public"]["Enums"]["customer_source"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          source?: Database["public"]["Enums"]["customer_source"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          source?: Database["public"]["Enums"]["customer_source"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      email_deliveries: {
        Row: {
          bounced_at: string | null
          complained_at: string | null
          created_at: string
          delivered_at: string | null
          email_type: string
          error_detail: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          order_id: string | null
          resend_email_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subscriber_id: string | null
          suppressed_at: string | null
          to_email: string
          updated_at: string
        }
        Insert: {
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          email_type: string
          error_detail?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          order_id?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subscriber_id?: string | null
          suppressed_at?: string | null
          to_email: string
          updated_at?: string
        }
        Update: {
          bounced_at?: string | null
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          email_type?: string
          error_detail?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subscriber_id?: string | null
          suppressed_at?: string | null
          to_email?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "newsletter_subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents: number | null
          created_at: string
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          price_cents: number | null
          quantity: number
          rarity: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          set_code: string
          set_name: string | null
          sku: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_location: string | null
          type_line: string | null
          updated_at: string
          variant_type: string
        }
        Insert: {
          card_name: string
          collector_number: string
          colors?: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents?: number | null
          created_at?: string
          creature_types?: string[]
          finish?: Database["public"]["Enums"]["card_finish"]
          foil?: boolean | null
          id?: string
          image_url?: string | null
          language?: string
          legacy_mongo_id?: string | null
          notes?: string | null
          oracle_id?: string | null
          price_cents?: number | null
          quantity?: number
          rarity?: string | null
          scryfall_id?: string | null
          scryfall_price_cents?: number | null
          set_code: string
          set_name?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_location?: string | null
          type_line?: string | null
          updated_at?: string
          variant_type?: string
        }
        Update: {
          card_name?: string
          collector_number?: string
          colors?: string[]
          condition?: Database["public"]["Enums"]["card_condition"]
          cost_cents?: number | null
          created_at?: string
          creature_types?: string[]
          finish?: Database["public"]["Enums"]["card_finish"]
          foil?: boolean | null
          id?: string
          image_url?: string | null
          language?: string
          legacy_mongo_id?: string | null
          notes?: string | null
          oracle_id?: string | null
          price_cents?: number | null
          quantity?: number
          rarity?: string | null
          scryfall_id?: string | null
          scryfall_price_cents?: number | null
          set_code?: string
          set_name?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_location?: string | null
          type_line?: string | null
          updated_at?: string
          variant_type?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          actor: string | null
          card_name: string
          created_at: string
          delta: number
          id: string
          inventory_item_id: string
          note: string | null
          previous_quantity: number
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          related_order_number: string | null
          resulting_quantity: number
        }
        Insert: {
          actor?: string | null
          card_name: string
          created_at?: string
          delta: number
          id?: string
          inventory_item_id: string
          note?: string | null
          previous_quantity: number
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          related_order_number?: string | null
          resulting_quantity: number
        }
        Update: {
          actor?: string | null
          card_name?: string
          created_at?: string
          delta?: number
          id?: string
          inventory_item_id?: string
          note?: string | null
          previous_quantity?: number
          reason?: Database["public"]["Enums"]["inventory_movement_reason"]
          related_order_number?: string | null
          resulting_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_price_floors: {
        Row: {
          min_price_cents: number
          rarity: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          min_price_cents?: number
          rarity: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          min_price_cents?: number
          rarity?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_reservations: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          inventory_item_id: string
          note: string | null
          pickup_request_id: string | null
          quantity: number
          released_at: string | null
          released_by: string | null
          reserved_at: string
          reserved_by: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          inventory_item_id: string
          note?: string | null
          pickup_request_id?: string | null
          quantity: number
          released_at?: string | null
          released_by?: string | null
          reserved_at?: string
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          inventory_item_id?: string
          note?: string | null
          pickup_request_id?: string | null
          quantity?: number
          released_at?: string | null
          released_by?: string | null
          reserved_at?: string
          reserved_by?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_pickup_request_id_fkey"
            columns: ["pickup_request_id"]
            isOneToOne: false
            referencedRelation: "pickup_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          confirmation_expires_at: string | null
          confirmation_sent_at: string | null
          confirmation_token_hash: string | null
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          last_bounce_reason: string | null
          source: string
          status: Database["public"]["Enums"]["subscriber_status"]
          unsubscribe_token_hash: string | null
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          confirmation_expires_at?: string | null
          confirmation_sent_at?: string | null
          confirmation_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          last_bounce_reason?: string | null
          source?: string
          status?: Database["public"]["Enums"]["subscriber_status"]
          unsubscribe_token_hash?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          confirmation_expires_at?: string | null
          confirmation_sent_at?: string | null
          confirmation_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          last_bounce_reason?: string | null
          source?: string
          status?: Database["public"]["Enums"]["subscriber_status"]
          unsubscribe_token_hash?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          card_name: string
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string | null
          inventory_item_id: string | null
          line_total_cents: number
          order_id: string
          packed: boolean
          quantity: number
          scryfall_id: string | null
          set_code: string | null
          set_name: string | null
          unit_price_cents: number
          variant_type: string
        }
        Insert: {
          card_name: string
          collector_number?: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          inventory_item_id?: string | null
          line_total_cents: number
          order_id: string
          packed?: boolean
          quantity: number
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          unit_price_cents: number
          variant_type?: string
        }
        Update: {
          card_name?: string
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"]
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          inventory_item_id?: string | null
          line_total_cents?: number
          order_id?: string
          packed?: boolean
          quantity?: number
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          unit_price_cents?: number
          variant_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_due_cents: number
          cancelled_at: string | null
          channel: Database["public"]["Enums"]["order_channel"]
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          discount_cents: number
          email: string | null
          id: string
          internal_notes: string | null
          legacy_mongo_id: string | null
          packed_at: string | null
          paid_at: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          ready_at: string | null
          ship_city: string | null
          ship_country: string | null
          ship_line1: string | null
          ship_line2: string | null
          ship_postal_code: string | null
          ship_recipient: string | null
          ship_state: string | null
          shipped_at: string | null
          shipping_cents: number
          shipping_method: Database["public"]["Enums"]["shipping_method"] | null
          status: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents: number
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_due_cents: number
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          discount_cents?: number
          email?: string | null
          id?: string
          internal_notes?: string | null
          legacy_mongo_id?: string | null
          packed_at?: string | null
          paid_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          ready_at?: string | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal_code?: string | null
          ship_recipient?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          shipping_method?:
            | Database["public"]["Enums"]["shipping_method"]
            | null
          status?: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents?: number
          subtotal_cents: number
          tax_cents?: number
          total_cents: number
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_due_cents?: number
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          discount_cents?: number
          email?: string | null
          id?: string
          internal_notes?: string | null
          legacy_mongo_id?: string | null
          packed_at?: string | null
          paid_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          ready_at?: string | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal_code?: string | null
          ship_recipient?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          shipping_method?:
            | Database["public"]["Enums"]["shipping_method"]
            | null
          status?: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents?: number
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          order_id: string | null
          payload: Json | null
          processed_at: string
          provider: Database["public"]["Enums"]["payment_provider"]
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          processed_at?: string
          provider: Database["public"]["Enums"]["payment_provider"]
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          order_id?: string | null
          payload?: Json | null
          processed_at?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_request_items: {
        Row: {
          card_name: string
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string | null
          inventory_item_id: string | null
          pickup_request_id: string
          pulled: boolean
          quantity: number
          set_code: string | null
          set_name: string | null
          unit_price_cents: number
        }
        Insert: {
          card_name: string
          collector_number?: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          inventory_item_id?: string | null
          pickup_request_id: string
          pulled?: boolean
          quantity: number
          set_code?: string | null
          set_name?: string | null
          unit_price_cents: number
        }
        Update: {
          card_name?: string
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"]
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          inventory_item_id?: string | null
          pickup_request_id?: string
          pulled?: boolean
          quantity?: number
          set_code?: string | null
          set_name?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pickup_request_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_request_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_request_items_pickup_request_id_fkey"
            columns: ["pickup_request_id"]
            isOneToOne: false
            referencedRelation: "pickup_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          customer_name: string
          id: string
          notes: string | null
          order_id: string | null
          phone: string | null
          ready_at: string | null
          status: Database["public"]["Enums"]["pickup_request_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name: string
          id?: string
          notes?: string | null
          order_id?: string | null
          phone?: string | null
          ready_at?: string | null
          status?: Database["public"]["Enums"]["pickup_request_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name?: string
          id?: string
          notes?: string | null
          order_id?: string | null
          phone?: string | null
          ready_at?: string | null
          status?: Database["public"]["Enums"]["pickup_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_settings: {
        Row: {
          id: number
          sales_tax_bps: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          sales_tax_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          sales_tax_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          announcement_notifications: Json
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          legacy_mongo_id: string | null
          phone: string | null
          sell_submission_notifications: Json
          shipping_notifications: Json
          updated_at: string
          username: string | null
        }
        Insert: {
          announcement_notifications?: Json
          created_at?: string
          first_name?: string | null
          id: string
          last_name?: string | null
          legacy_mongo_id?: string | null
          phone?: string | null
          sell_submission_notifications?: Json
          shipping_notifications?: Json
          updated_at?: string
          username?: string | null
        }
        Update: {
          announcement_notifications?: Json
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          legacy_mongo_id?: string | null
          phone?: string | null
          sell_submission_notifications?: Json
          shipping_notifications?: Json
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      scan_sessions: {
        Row: {
          added_cards: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_cards: number
          id: string
          label: string
          matched_cards: number
          note: string | null
          ready_cards: number
          rejected_cards: number
          reviewed_cards: number
          scan_mode: Database["public"]["Enums"]["scan_recognition_mode"]
          scanner_name: string | null
          source_type: Database["public"]["Enums"]["scan_source_type"]
          status: Database["public"]["Enums"]["scan_session_status"]
          total_cards: number
          total_files: number
          updated_at: string
        }
        Insert: {
          added_cards?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_cards?: number
          id?: string
          label: string
          matched_cards?: number
          note?: string | null
          ready_cards?: number
          rejected_cards?: number
          reviewed_cards?: number
          scan_mode?: Database["public"]["Enums"]["scan_recognition_mode"]
          scanner_name?: string | null
          source_type?: Database["public"]["Enums"]["scan_source_type"]
          status?: Database["public"]["Enums"]["scan_session_status"]
          total_cards?: number
          total_files?: number
          updated_at?: string
        }
        Update: {
          added_cards?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_cards?: number
          id?: string
          label?: string
          matched_cards?: number
          note?: string | null
          ready_cards?: number
          rejected_cards?: number
          reviewed_cards?: number
          scan_mode?: Database["public"]["Enums"]["scan_recognition_mode"]
          scanner_name?: string | null
          source_type?: Database["public"]["Enums"]["scan_source_type"]
          status?: Database["public"]["Enums"]["scan_session_status"]
          total_cards?: number
          total_files?: number
          updated_at?: string
        }
        Relationships: []
      }
      scanner_jobs: {
        Row: {
          attempts: number
          chosen_collector: string | null
          chosen_set: string | null
          chosen_set_name: string | null
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          copyright_year: number | null
          created_at: string
          detected_set_code: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          finished_at: string | null
          guessed_name: string | null
          id: string
          last_error: string | null
          legacy_mongo_id: string | null
          locked_at: string | null
          name_confidence: number | null
          ocr_text_bottom: string | null
          ocr_text_name: string | null
          original_name: string | null
          set_code: string | null
          set_symbol_best_dist: number | null
          set_symbol_score: number | null
          status: Database["public"]["Enums"]["scan_job_status"]
          storage_key: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          chosen_collector?: string | null
          chosen_set?: string | null
          chosen_set_name?: string | null
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"]
          copyright_year?: number | null
          created_at?: string
          detected_set_code?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          finished_at?: string | null
          guessed_name?: string | null
          id?: string
          last_error?: string | null
          legacy_mongo_id?: string | null
          locked_at?: string | null
          name_confidence?: number | null
          ocr_text_bottom?: string | null
          ocr_text_name?: string | null
          original_name?: string | null
          set_code?: string | null
          set_symbol_best_dist?: number | null
          set_symbol_score?: number | null
          status?: Database["public"]["Enums"]["scan_job_status"]
          storage_key?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          chosen_collector?: string | null
          chosen_set?: string | null
          chosen_set_name?: string | null
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"]
          copyright_year?: number | null
          created_at?: string
          detected_set_code?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          finished_at?: string | null
          guessed_name?: string | null
          id?: string
          last_error?: string | null
          legacy_mongo_id?: string | null
          locked_at?: string | null
          name_confidence?: number | null
          ocr_text_bottom?: string | null
          ocr_text_name?: string | null
          original_name?: string | null
          set_code?: string | null
          set_symbol_best_dist?: number | null
          set_symbol_score?: number | null
          status?: Database["public"]["Enums"]["scan_job_status"]
          storage_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scanner_results: {
        Row: {
          auto_ingested: boolean
          candidates: Json
          card_name: string | null
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"] | null
          created_at: string
          crop_storage_keys: Json
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_storage_key: string | null
          job_id: string | null
          ocr: Json
          overall_score: number | null
          scryfall_id: string | null
          set_code: string | null
        }
        Insert: {
          auto_ingested?: boolean
          candidates?: Json
          card_name?: string | null
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          created_at?: string
          crop_storage_keys?: Json
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_storage_key?: string | null
          job_id?: string | null
          ocr?: Json
          overall_score?: number | null
          scryfall_id?: string | null
          set_code?: string | null
        }
        Update: {
          auto_ingested?: boolean
          candidates?: Json
          card_name?: string | null
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          created_at?: string
          crop_storage_keys?: Json
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_storage_key?: string | null
          job_id?: string | null
          ocr?: Json
          overall_score?: number | null
          scryfall_id?: string | null
          set_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scanner_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "scanner_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scanner_review_queue: {
        Row: {
          candidates: Json
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"] | null
          confidence: number | null
          corrected_scryfall_id: string | null
          created_at: string
          created_inventory_item_id: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          guessed_name: string | null
          id: string
          image_storage_key: string | null
          predicted_set: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          result_id: string | null
          review_hash: string | null
          status: Database["public"]["Enums"]["scan_review_status"]
          symbol_match: string | null
          updated_at: string
        }
        Insert: {
          candidates?: Json
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          confidence?: number | null
          corrected_scryfall_id?: string | null
          created_at?: string
          created_inventory_item_id?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          guessed_name?: string | null
          id?: string
          image_storage_key?: string | null
          predicted_set?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result_id?: string | null
          review_hash?: string | null
          status?: Database["public"]["Enums"]["scan_review_status"]
          symbol_match?: string | null
          updated_at?: string
        }
        Update: {
          candidates?: Json
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          confidence?: number | null
          corrected_scryfall_id?: string | null
          created_at?: string
          created_inventory_item_id?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          guessed_name?: string | null
          id?: string
          image_storage_key?: string | null
          predicted_set?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          result_id?: string | null
          review_hash?: string | null
          status?: Database["public"]["Enums"]["scan_review_status"]
          symbol_match?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scanner_review_queue_created_inventory_item_id_fkey"
            columns: ["created_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scanner_review_queue_created_inventory_item_id_fkey"
            columns: ["created_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scanner_review_queue_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "scanner_results"
            referencedColumns: ["id"]
          },
        ]
      }
      scryfall_bulk_cards: {
        Row: {
          border_color: string | null
          bulk_updated_at: string
          card_name: string
          collector_number: string
          finishes: string[]
          frame: string | null
          frame_effects: string[]
          full_art: boolean
          lang: string
          layout: string | null
          oracle_id: string | null
          printed_name: string | null
          promo: boolean
          promo_types: string[]
          rarity: string | null
          raw: Json
          released_at: string | null
          scryfall_id: string
          set_code: string
          set_name: string
          textless: boolean
          variation: boolean
        }
        Insert: {
          border_color?: string | null
          bulk_updated_at?: string
          card_name: string
          collector_number: string
          finishes?: string[]
          frame?: string | null
          frame_effects?: string[]
          full_art?: boolean
          lang?: string
          layout?: string | null
          oracle_id?: string | null
          printed_name?: string | null
          promo?: boolean
          promo_types?: string[]
          rarity?: string | null
          raw: Json
          released_at?: string | null
          scryfall_id: string
          set_code: string
          set_name: string
          textless?: boolean
          variation?: boolean
        }
        Update: {
          border_color?: string | null
          bulk_updated_at?: string
          card_name?: string
          collector_number?: string
          finishes?: string[]
          frame?: string | null
          frame_effects?: string[]
          full_art?: boolean
          lang?: string
          layout?: string | null
          oracle_id?: string | null
          printed_name?: string | null
          promo?: boolean
          promo_types?: string[]
          rarity?: string | null
          raw?: Json
          released_at?: string | null
          scryfall_id?: string
          set_code?: string
          set_name?: string
          textless?: boolean
          variation?: boolean
        }
        Relationships: []
      }
      scryfall_image_hash_cache: {
        Row: {
          created_at: string
          hash: string
          region: string
          scryfall_id: string
        }
        Insert: {
          created_at?: string
          hash: string
          region: string
          scryfall_id: string
        }
        Update: {
          created_at?: string
          hash?: string
          region?: string
          scryfall_id?: string
        }
        Relationships: []
      }
      scryfall_set_symbol_cache: {
        Row: {
          created_at: string
          hash: string
          icon_svg_uri: string
          set_code: string
        }
        Insert: {
          created_at?: string
          hash: string
          icon_svg_uri: string
          set_code: string
        }
        Update: {
          created_at?: string
          hash?: string
          icon_svg_uri?: string
          set_code?: string
        }
        Relationships: []
      }
      sell_submission_cards: {
        Row: {
          card_name: string
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"] | null
          created_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string | null
          match_status: Database["public"]["Enums"]["sell_card_match_status"]
          quantity: number
          raw_input: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          seller_notes: string | null
          set_code: string | null
          set_name: string | null
          submission_id: string
        }
        Insert: {
          card_name: string
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          match_status?: Database["public"]["Enums"]["sell_card_match_status"]
          quantity?: number
          raw_input?: string | null
          scryfall_id?: string | null
          scryfall_price_cents?: number | null
          seller_notes?: string | null
          set_code?: string | null
          set_name?: string | null
          submission_id: string
        }
        Update: {
          card_name?: string
          collector_number?: string | null
          condition?: Database["public"]["Enums"]["card_condition"] | null
          created_at?: string
          finish?: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          match_status?: Database["public"]["Enums"]["sell_card_match_status"]
          quantity?: number
          raw_input?: string | null
          scryfall_id?: string | null
          scryfall_price_cents?: number | null
          seller_notes?: string | null
          set_code?: string | null
          set_name?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_items_trade_in_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "sell_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_submission_photos: {
        Row: {
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          submission_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sell_submission_photos_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "sell_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_submissions: {
        Row: {
          city: string | null
          closed_at: string | null
          collection_eras: string[]
          collection_size:
            | Database["public"]["Enums"]["sell_collection_size"]
            | null
          collection_types: string[]
          contacted_at: string | null
          created_at: string
          email: string
          estimated_value_cents: number | null
          favorited: boolean
          first_name: string
          id: string
          internal_notes: string | null
          last_name: string
          legacy_mongo_id: string | null
          notes: string | null
          offer_value_cents: number | null
          phone: string | null
          photo_count: number
          preferred_contact_method: Database["public"]["Enums"]["sell_preferred_contact_method"]
          priority: Database["public"]["Enums"]["sell_priority"]
          purchase_amount_cents: number | null
          reference_number: string
          referral_source: string | null
          source: string | null
          state: string | null
          status: Database["public"]["Enums"]["sell_submission_status"]
          timeline: Database["public"]["Enums"]["sell_timeline"] | null
          total_cards: number
          transaction_preference: Database["public"]["Enums"]["sell_transaction_preference"]
          updated_at: string
          user_id: string | null
          valuable_cards_notes: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          closed_at?: string | null
          collection_eras?: string[]
          collection_size?:
            | Database["public"]["Enums"]["sell_collection_size"]
            | null
          collection_types?: string[]
          contacted_at?: string | null
          created_at?: string
          email: string
          estimated_value_cents?: number | null
          favorited?: boolean
          first_name: string
          id?: string
          internal_notes?: string | null
          last_name: string
          legacy_mongo_id?: string | null
          notes?: string | null
          offer_value_cents?: number | null
          phone?: string | null
          photo_count?: number
          preferred_contact_method?: Database["public"]["Enums"]["sell_preferred_contact_method"]
          priority?: Database["public"]["Enums"]["sell_priority"]
          purchase_amount_cents?: number | null
          reference_number: string
          referral_source?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["sell_submission_status"]
          timeline?: Database["public"]["Enums"]["sell_timeline"] | null
          total_cards?: number
          transaction_preference?: Database["public"]["Enums"]["sell_transaction_preference"]
          updated_at?: string
          user_id?: string | null
          valuable_cards_notes?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          closed_at?: string | null
          collection_eras?: string[]
          collection_size?:
            | Database["public"]["Enums"]["sell_collection_size"]
            | null
          collection_types?: string[]
          contacted_at?: string | null
          created_at?: string
          email?: string
          estimated_value_cents?: number | null
          favorited?: boolean
          first_name?: string
          id?: string
          internal_notes?: string | null
          last_name?: string
          legacy_mongo_id?: string | null
          notes?: string | null
          offer_value_cents?: number | null
          phone?: string | null
          photo_count?: number
          preferred_contact_method?: Database["public"]["Enums"]["sell_preferred_contact_method"]
          priority?: Database["public"]["Enums"]["sell_priority"]
          purchase_amount_cents?: number | null
          reference_number?: string
          referral_source?: string | null
          source?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["sell_submission_status"]
          timeline?: Database["public"]["Enums"]["sell_timeline"] | null
          total_cards?: number
          transaction_preference?: Database["public"]["Enums"]["sell_transaction_preference"]
          updated_at?: string
          user_id?: string | null
          valuable_cards_notes?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      store_credit_transactions: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          type: Database["public"]["Enums"]["store_credit_type"]
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type: Database["public"]["Enums"]["store_credit_type"]
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          type?: Database["public"]["Enums"]["store_credit_type"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      inventory_public: {
        Row: {
          card_name: string | null
          collector_number: string | null
          colors: string[] | null
          condition: Database["public"]["Enums"]["card_condition"] | null
          creature_types: string[] | null
          finish: Database["public"]["Enums"]["card_finish"] | null
          foil: boolean | null
          id: string | null
          image_url: string | null
          language: string | null
          oracle_id: string | null
          price_cents: number | null
          quantity: number | null
          rarity: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          set_code: string | null
          set_name: string | null
          type_line: string | null
          variant_type: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_adjust_inventory_quantity: {
        Args: {
          p_actor?: string
          p_delta: number
          p_id: string
          p_note?: string
          p_reason: Database["public"]["Enums"]["inventory_movement_reason"]
        }
        Returns: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents: number | null
          created_at: string
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          price_cents: number | null
          quantity: number
          rarity: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          set_code: string
          set_name: string | null
          sku: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_location: string | null
          type_line: string | null
          updated_at: string
          variant_type: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_adjust_store_credit: {
        Args: { p_amount_cents: number; p_reason?: string; p_user_id: string }
        Returns: number
      }
      admin_analytics_overview: { Args: { p_range?: string }; Returns: Json }
      admin_analytics_trends: { Args: { p_range?: string }; Returns: Json }
      admin_create_reservation: {
        Args: {
          p_customer_id: string
          p_inventory_item_id: string
          p_note?: string
          p_quantity: number
          p_reserved_by?: string
        }
        Returns: {
          created_at: string
          customer_id: string | null
          id: string
          inventory_item_id: string
          note: string | null
          pickup_request_id: string | null
          quantity: number
          released_at: string | null
          released_by: string | null
          reserved_at: string
          reserved_by: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_customer_list: {
        Args: never
        Returns: {
          auth_user_id: string
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          last_order_at: string
          last_sign_in_at: string
          lifetime_spend_cents: number
          order_count: number
          source: Database["public"]["Enums"]["customer_source"]
          status: Database["public"]["Enums"]["account_status"]
          subscriber_status: Database["public"]["Enums"]["subscriber_status"]
        }[]
      }
      admin_inventory_set_codes: {
        Args: never
        Returns: {
          set_code: string
          set_name: string
        }[]
      }
      admin_list_reservations: {
        Args: never
        Returns: {
          card_name: string
          collector_number: string
          condition: Database["public"]["Enums"]["card_condition"]
          customer_email: string
          customer_first: string
          customer_id: string
          customer_last: string
          finish: Database["public"]["Enums"]["card_finish"]
          image_url: string
          inventory_item_id: string
          note: string
          on_hand: number
          quantity: number
          reservation_id: string
          reserved_at: string
          reserved_by: string
          set_code: string
          set_name: string
        }[]
      }
      admin_release_customer_reservations: {
        Args: {
          p_customer_id: string
          p_inventory_item_id?: string
          p_released_by?: string
        }
        Returns: number
      }
      admin_release_reservation: {
        Args: {
          p_quantity?: number
          p_released_by?: string
          p_reservation_id: string
        }
        Returns: {
          created_at: string
          customer_id: string | null
          id: string
          inventory_item_id: string
          note: string | null
          pickup_request_id: string | null
          quantity: number
          released_at: string | null
          released_by: string | null
          reserved_at: string
          reserved_by: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_search_inventory: {
        Args: {
          p_condition?: string
          p_finish?: string
          p_limit?: number
          p_low_stock_threshold?: number
          p_offset?: number
          p_query?: string
          p_set_code?: string
          p_sort?: string
          p_sort_dir?: string
          p_status?: string
          p_stock?: string
        }
        Returns: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents: number
          created_at: string
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean
          id: string
          image_url: string
          notes: string
          oracle_id: string
          price_cents: number
          quantity: number
          rarity: string
          scryfall_id: string
          scryfall_price_cents: number
          set_code: string
          set_name: string
          sku: string
          status: Database["public"]["Enums"]["inventory_status"]
          storage_location: string
          total_count: number
          type_line: string
          updated_at: string
          variant_type: string
        }[]
      }
      admin_set_inventory_status: {
        Args: {
          p_actor?: string
          p_id: string
          p_status: Database["public"]["Enums"]["inventory_status"]
        }
        Returns: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents: number | null
          created_at: string
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          price_cents: number | null
          quantity: number
          rarity: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          set_code: string
          set_name: string | null
          sku: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_location: string | null
          type_line: string | null
          updated_at: string
          variant_type: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_customer: {
        Args: {
          p_auth_user_id?: string
          p_email: string
          p_first_name?: string
          p_last_name?: string
          p_source?: Database["public"]["Enums"]["customer_source"]
        }
        Returns: {
          auth_user_id: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          source: Database["public"]["Enums"]["customer_source"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_upsert_inventory: {
        Args: {
          p_actor?: string
          p_card_name: string
          p_collector_number: string
          p_colors?: string[]
          p_condition: Database["public"]["Enums"]["card_condition"]
          p_cost_cents?: number
          p_creature_types?: string[]
          p_finish: Database["public"]["Enums"]["card_finish"]
          p_image_url: string
          p_language?: string
          p_notes?: string
          p_oracle_id: string
          p_price_cents: number
          p_quantity: number
          p_rarity: string
          p_reason?: Database["public"]["Enums"]["inventory_movement_reason"]
          p_scryfall_id: string
          p_scryfall_price_cents?: number
          p_set_code: string
          p_set_name: string
          p_sku?: string
          p_storage_location?: string
          p_type_line: string
          p_variant_type?: string
        }
        Returns: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          cost_cents: number | null
          created_at: string
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          price_cents: number | null
          quantity: number
          rarity: string | null
          scryfall_id: string | null
          scryfall_price_cents: number | null
          set_code: string
          set_name: string | null
          sku: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_location: string | null
          type_line: string | null
          updated_at: string
          variant_type: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      campaign_audience_count: {
        Args: { p_audience: Database["public"]["Enums"]["campaign_audience"] }
        Returns: number
      }
      cancel_unpaid_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      checkout_create_order: {
        Args: {
          p_ship_city?: string
          p_ship_country?: string
          p_ship_line1?: string
          p_ship_line2?: string
          p_ship_postal_code?: string
          p_ship_recipient?: string
          p_ship_state?: string
          p_shipping_method: Database["public"]["Enums"]["shipping_method"]
          p_store_credit_requested_cents?: number
        }
        Returns: {
          amount_due_cents: number
          order_id: string
          shipping_cents: number
          store_credit_used_cents: number
          subtotal_cents: number
          total_cents: number
        }[]
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_or_create_my_cart: { Args: never; Returns: string }
      inventory_facets: {
        Args: never
        Returns: {
          creature_types: string[]
          price_max_cents: number
          price_min_cents: number
          rarities: string[]
          sets: Json
        }[]
      }
      inventory_write_authorized: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      kiosk_create_pickup_request: {
        Args: { p_customer_name: string; p_items: Json; p_phone: string }
        Returns: string
      }
      mark_order_paid: {
        Args: {
          p_order_id: string
          p_provider: Database["public"]["Enums"]["payment_provider"]
          p_reference: string
        }
        Returns: undefined
      }
      my_sell_submissions: {
        Args: never
        Returns: {
          created_at: string
          id: string
          reference_number: string
          status: Database["public"]["Enums"]["sell_submission_status"]
        }[]
      }
      my_store_credit_balance: { Args: never; Returns: number }
      pos_cancel_pickup_request: {
        Args: { p_pickup_request_id: string; p_reason?: string }
        Returns: undefined
      }
      pos_complete_pickup_sale: {
        Args: { p_customer_id?: string; p_pickup_request_id: string }
        Returns: {
          amount_due_cents: number
          order_id: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
        }[]
      }
      pos_create_sale: {
        Args: { p_customer_id?: string; p_items: Json; p_notes?: string }
        Returns: {
          amount_due_cents: number
          order_id: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
        }[]
      }
      recompute_scan_session: {
        Args: { p_session_id: string }
        Returns: {
          added_cards: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_cards: number
          id: string
          label: string
          matched_cards: number
          note: string | null
          ready_cards: number
          rejected_cards: number
          reviewed_cards: number
          scan_mode: Database["public"]["Enums"]["scan_recognition_mode"]
          scanner_name: string | null
          source_type: Database["public"]["Enums"]["scan_source_type"]
          status: Database["public"]["Enums"]["scan_session_status"]
          total_cards: number
          total_files: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "scan_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserved_quantity: {
        Args: { p_inventory_item_id: string }
        Returns: number
      }
      scan_filter_counts: {
        Args: { p_session_id: string }
        Returns: {
          added: number
          all_count: number
          error: number
          matched: number
          missing_back: number
          needs_manual_match: number
          pending_match: number
          ready: number
          rejected: number
          unreviewed: number
        }[]
      }
      search_inventory: {
        Args: {
          p_colors?: string[]
          p_conditions?: Database["public"]["Enums"]["card_condition"][]
          p_creature_types?: string[]
          p_finishes?: Database["public"]["Enums"]["card_finish"][]
          p_in_stock_only?: boolean
          p_include_archived?: boolean
          p_limit?: number
          p_max_price_cents?: number
          p_min_price_cents?: number
          p_offset?: number
          p_query?: string
          p_rarities?: string[]
          p_sets?: string[]
          p_sort?: string
        }
        Returns: {
          card_name: string
          collector_number: string
          colors: string[]
          condition: Database["public"]["Enums"]["card_condition"]
          creature_types: string[]
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean
          id: string
          image_url: string
          oracle_id: string
          price_cents: number
          quantity: number
          rarity: string
          scryfall_id: string
          set_code: string
          set_name: string
          total_count: number
          type_line: string
          variant_type: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_or_service_role: { Args: never; Returns: boolean }
      store_credit_balance: { Args: { p_user_id: string }; Returns: number }
    }
    Enums: {
      account_status: "active" | "disabled"
      app_role: "customer" | "staff" | "admin"
      campaign_audience:
        | "active_subscribers"
        | "confirmed_recent"
        | "all_customers"
      campaign_status:
        | "draft"
        | "queued"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
      card_condition: "NM" | "LP" | "MP" | "HP" | "DMG"
      card_finish:
        | "nonfoil"
        | "foil"
        | "etched"
        | "glossy"
        | "ripple"
        | "surge"
        | "rainbow"
        | "galaxy"
        | "textured"
        | "mana"
        | "gilded"
        | "halo"
      card_scan_review_status:
        | "unreviewed"
        | "pending_match"
        | "matched"
        | "needs_manual_match"
        | "ready"
        | "added"
        | "rejected"
        | "error"
      customer_source:
        | "manual"
        | "newsletter"
        | "account_signup"
        | "checkout"
        | "import"
      email_delivery_status:
        | "queued"
        | "sent"
        | "delivered"
        | "bounced"
        | "complained"
        | "delivery_delayed"
        | "suppressed"
        | "failed"
        | "canceled"
      inventory_movement_reason:
        | "manual_add"
        | "manual_remove"
        | "correction"
        | "scan_add"
        | "batch_scan_add"
        | "order_reserved"
        | "order_shipped"
        | "order_cancelled"
        | "import"
        | "archive"
        | "restore"
      inventory_status: "active" | "reserved" | "archived"
      order_channel: "online" | "pos"
      order_status:
        | "pending_payment"
        | "paid"
        | "packing"
        | "ready_to_ship"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_provider: "stripe" | "paypal" | "store_credit" | "manual"
      payment_status: "unpaid" | "processing" | "paid" | "refunded" | "failed"
      pickup_request_status: "waiting" | "ready" | "completed" | "cancelled"
      recognition_status:
        | "none"
        | "queued"
        | "processing"
        | "recognized"
        | "low_confidence"
        | "failed"
      reservation_status: "active" | "released" | "fulfilled"
      scan_job_status: "queued" | "processing" | "done" | "failed"
      scan_recognition_mode: "card_matching" | "condition" | "both"
      scan_review_status: "pending" | "approved" | "corrected" | "rejected"
      scan_session_status:
        | "uploading"
        | "processing"
        | "pending_review"
        | "reviewing"
        | "completed"
        | "partially_failed"
        | "failed"
      scan_source_type:
        | "scanner_export"
        | "file_upload"
        | "folder_drop"
        | "scanner_bridge"
      sell_card_match_status: "matched" | "ambiguous" | "unmatched"
      sell_collection_size:
        | "under_100"
        | "100_to_500"
        | "500_to_1000"
        | "1000_to_5000"
        | "5000_to_10000"
        | "10000_plus"
        | "not_sure"
      sell_preferred_contact_method: "email" | "phone" | "text"
      sell_priority: "normal" | "high_interest"
      sell_submission_status:
        | "new"
        | "reviewing"
        | "needs_more_photos"
        | "needs_in_person_review"
        | "contacted"
        | "offer_made"
        | "accepted"
        | "declined"
        | "completed"
        | "closed"
      sell_timeline: "asap" | "within_week" | "within_month" | "no_rush"
      sell_transaction_preference: "local" | "ship" | "either" | "not_sure"
      shipping_method: "tracked" | "pwe"
      store_credit_type:
        | "opening_balance"
        | "admin_adjustment"
        | "order_spend"
        | "order_refund"
        | "trade_in_payout"
      subscriber_status:
        | "pending"
        | "active"
        | "unsubscribed"
        | "bounced"
        | "complained"
        | "suppressed"
      trade_in_status:
        | "new"
        | "received"
        | "evaluating"
        | "offer_made"
        | "accepted"
        | "paid_out"
        | "rejected"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "disabled"],
      app_role: ["customer", "staff", "admin"],
      campaign_audience: [
        "active_subscribers",
        "confirmed_recent",
        "all_customers",
      ],
      campaign_status: [
        "draft",
        "queued",
        "sending",
        "sent",
        "failed",
        "cancelled",
      ],
      card_condition: ["NM", "LP", "MP", "HP", "DMG"],
      card_finish: [
        "nonfoil",
        "foil",
        "etched",
        "glossy",
        "ripple",
        "surge",
        "rainbow",
        "galaxy",
        "textured",
        "mana",
        "gilded",
        "halo",
      ],
      card_scan_review_status: [
        "unreviewed",
        "pending_match",
        "matched",
        "needs_manual_match",
        "ready",
        "added",
        "rejected",
        "error",
      ],
      customer_source: [
        "manual",
        "newsletter",
        "account_signup",
        "checkout",
        "import",
      ],
      email_delivery_status: [
        "queued",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "delivery_delayed",
        "suppressed",
        "failed",
        "canceled",
      ],
      inventory_movement_reason: [
        "manual_add",
        "manual_remove",
        "correction",
        "scan_add",
        "batch_scan_add",
        "order_reserved",
        "order_shipped",
        "order_cancelled",
        "import",
        "archive",
        "restore",
      ],
      inventory_status: ["active", "reserved", "archived"],
      order_channel: ["online", "pos"],
      order_status: [
        "pending_payment",
        "paid",
        "packing",
        "ready_to_ship",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_provider: ["stripe", "paypal", "store_credit", "manual"],
      payment_status: ["unpaid", "processing", "paid", "refunded", "failed"],
      pickup_request_status: ["waiting", "ready", "completed", "cancelled"],
      recognition_status: [
        "none",
        "queued",
        "processing",
        "recognized",
        "low_confidence",
        "failed",
      ],
      reservation_status: ["active", "released", "fulfilled"],
      scan_job_status: ["queued", "processing", "done", "failed"],
      scan_recognition_mode: ["card_matching", "condition", "both"],
      scan_review_status: ["pending", "approved", "corrected", "rejected"],
      scan_session_status: [
        "uploading",
        "processing",
        "pending_review",
        "reviewing",
        "completed",
        "partially_failed",
        "failed",
      ],
      scan_source_type: [
        "scanner_export",
        "file_upload",
        "folder_drop",
        "scanner_bridge",
      ],
      sell_card_match_status: ["matched", "ambiguous", "unmatched"],
      sell_collection_size: [
        "under_100",
        "100_to_500",
        "500_to_1000",
        "1000_to_5000",
        "5000_to_10000",
        "10000_plus",
        "not_sure",
      ],
      sell_preferred_contact_method: ["email", "phone", "text"],
      sell_priority: ["normal", "high_interest"],
      sell_submission_status: [
        "new",
        "reviewing",
        "needs_more_photos",
        "needs_in_person_review",
        "contacted",
        "offer_made",
        "accepted",
        "declined",
        "completed",
        "closed",
      ],
      sell_timeline: ["asap", "within_week", "within_month", "no_rush"],
      sell_transaction_preference: ["local", "ship", "either", "not_sure"],
      shipping_method: ["tracked", "pwe"],
      store_credit_type: [
        "opening_balance",
        "admin_adjustment",
        "order_spend",
        "order_refund",
        "trade_in_payout",
      ],
      subscriber_status: [
        "pending",
        "active",
        "unsubscribed",
        "bounced",
        "complained",
        "suppressed",
      ],
      trade_in_status: [
        "new",
        "received",
        "evaluating",
        "offer_made",
        "accepted",
        "paid_out",
        "rejected",
        "cancelled",
      ],
    },
  },
} as const
