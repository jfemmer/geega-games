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
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      admin_notification_state: {
        Row: {
          dismissed_at: string | null
          notification_key: string
          read_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          notification_key: string
          read_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          notification_key?: string
          read_at?: string | null
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
      card_recommendation_catalog: {
        Row: {
          card_name: string
          color_identity: string[]
          commander_legal: boolean
          edhrec_rank: number | null
          image_url: string | null
          oracle_id: string
          oracle_text: string | null
          primary_category: string
          scryfall_price_cents: number | null
          themes: string[]
          type_line: string | null
          updated_at: string
        }
        Insert: {
          card_name: string
          color_identity?: string[]
          commander_legal?: boolean
          edhrec_rank?: number | null
          image_url?: string | null
          oracle_id: string
          oracle_text?: string | null
          primary_category?: string
          scryfall_price_cents?: number | null
          themes?: string[]
          type_line?: string | null
          updated_at?: string
        }
        Update: {
          card_name?: string
          color_identity?: string[]
          commander_legal?: boolean
          edhrec_rank?: number | null
          image_url?: string | null
          oracle_id?: string
          oracle_text?: string | null
          primary_category?: string
          scryfall_price_cents?: number | null
          themes?: string[]
          type_line?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      card_scans: {
        Row: {
          back_image_path: string | null
          back_preview_path: string | null
          condition_findings: Json | null
          confirmed_condition:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents: number | null
          created_at: string
          front_image_path: string | null
          front_preview_path: string | null
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
          back_preview_path?: string | null
          condition_findings?: Json | null
          confirmed_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents?: number | null
          created_at?: string
          front_image_path?: string | null
          front_preview_path?: string | null
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
          back_preview_path?: string | null
          condition_findings?: Json | null
          confirmed_condition?:
            | Database["public"]["Enums"]["card_condition"]
            | null
          cost_cents?: number | null
          created_at?: string
          front_image_path?: string | null
          front_preview_path?: string | null
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
      card_stock_subscriptions: {
        Row: {
          card_name: string
          created_at: string
          email: string
          id: string
          notified_at: string | null
          oracle_id: string
        }
        Insert: {
          card_name: string
          created_at?: string
          email: string
          id?: string
          notified_at?: string | null
          oracle_id: string
        }
        Update: {
          card_name?: string
          created_at?: string
          email?: string
          id?: string
          notified_at?: string | null
          oracle_id?: string
        }
        Relationships: []
      }
      card_synergy_curated: {
        Row: {
          card_a_name: string
          card_a_oracle_id: string | null
          card_b_name: string
          card_b_oracle_id: string | null
          created_at: string
          id: string
          synergy_note: string
        }
        Insert: {
          card_a_name: string
          card_a_oracle_id?: string | null
          card_b_name: string
          card_b_oracle_id?: string | null
          created_at?: string
          id?: string
          synergy_note: string
        }
        Update: {
          card_a_name?: string
          card_a_oracle_id?: string | null
          card_b_name?: string
          card_b_oracle_id?: string | null
          created_at?: string
          id?: string
          synergy_note?: string
        }
        Relationships: []
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
      customer_deck_cards: {
        Row: {
          card_name: string
          created_at: string
          deck_id: string
          exact_printing_only: boolean
          id: string
          oracle_id: string | null
          owned: boolean
          quantity: number
          scryfall_id: string | null
          section: string
          updated_at: string
          user_id: string
        }
        Insert: {
          card_name: string
          created_at?: string
          deck_id: string
          exact_printing_only?: boolean
          id?: string
          oracle_id?: string | null
          owned?: boolean
          quantity?: number
          scryfall_id?: string | null
          section?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          card_name?: string
          created_at?: string
          deck_id?: string
          exact_printing_only?: boolean
          id?: string
          oracle_id?: string | null
          owned?: boolean
          quantity?: number
          scryfall_id?: string | null
          section?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "customer_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_decks: {
        Row: {
          budget_mode: string
          commander_name: string | null
          commander_oracle_id: string | null
          created_at: string
          format: string
          id: string
          max_card_price_cents: number | null
          name: string
          notify_email: boolean
          notify_in_app: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_mode?: string
          commander_name?: string | null
          commander_oracle_id?: string | null
          created_at?: string
          format?: string
          id?: string
          max_card_price_cents?: number | null
          name: string
          notify_email?: boolean
          notify_in_app?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_mode?: string
          commander_name?: string | null
          commander_oracle_id?: string | null
          created_at?: string
          format?: string
          id?: string
          max_card_price_cents?: number | null
          name?: string
          notify_email?: boolean
          notify_in_app?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_wishlist_items: {
        Row: {
          card_name: string
          created_at: string
          id: string
          oracle_id: string
          user_id: string
        }
        Insert: {
          card_name: string
          created_at?: string
          id?: string
          oracle_id: string
          user_id: string
        }
        Update: {
          card_name?: string
          created_at?: string
          id?: string
          oracle_id?: string
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
      deck_stock_notifications: {
        Row: {
          card_name: string
          created_at: string
          deck_names: string[]
          email_error: string | null
          email_sent_at: string | null
          id: string
          inventory_item_id: string | null
          oracle_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          card_name: string
          created_at?: string
          deck_names?: string[]
          email_error?: string | null
          email_sent_at?: string | null
          id?: string
          inventory_item_id?: string | null
          oracle_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          card_name?: string
          created_at?: string
          deck_names?: string[]
          email_error?: string | null
          email_sent_at?: string | null
          id?: string
          inventory_item_id?: string | null
          oracle_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_stock_notifications_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_stock_notifications_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_public"
            referencedColumns: ["id"]
          },
        ]
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
          deal_discount_percent: number | null
          deal_note: string | null
          deal_source: string | null
          deal_started_at: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          is_deal: boolean
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          original_price_cents: number | null
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
          storefront_listed_at: string
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
          deal_discount_percent?: number | null
          deal_note?: string | null
          deal_source?: string | null
          deal_started_at?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          foil?: never
          id?: string
          image_url?: string | null
          is_deal?: boolean
          language?: string
          legacy_mongo_id?: string | null
          notes?: string | null
          oracle_id?: string | null
          original_price_cents?: number | null
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
          storefront_listed_at?: string
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
          deal_discount_percent?: number | null
          deal_note?: string | null
          deal_source?: string | null
          deal_started_at?: string | null
          finish?: Database["public"]["Enums"]["card_finish"]
          foil?: never
          id?: string
          image_url?: string | null
          is_deal?: boolean
          language?: string
          legacy_mongo_id?: string | null
          notes?: string | null
          oracle_id?: string | null
          original_price_cents?: number | null
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
          storefront_listed_at?: string
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
          trade_request_id: string | null
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
          trade_request_id?: string | null
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
          trade_request_id?: string | null
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
      market_research_notes: {
        Row: {
          competitor_count: number | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          population: number | null
          region_label: string
          state: string | null
          updated_at: string
        }
        Insert: {
          competitor_count?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          population?: number | null
          region_label: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          competitor_count?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          population?: number | null
          region_label?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
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
      order_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          reason: string | null
          restocked: boolean
          stripe_refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          reason?: string | null
          restocked?: boolean
          stripe_refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          reason?: string | null
          restocked?: boolean
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      site_page_views: {
        Row: {
          city: string | null
          country: string | null
          device: string
          id: number
          path: string
          referrer_host: string | null
          region: string | null
          viewed_at: string
          visitor_hash: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          device: string
          id?: never
          path: string
          referrer_host?: string | null
          region?: string | null
          viewed_at?: string
          visitor_hash: string
        }
        Update: {
          city?: string | null
          country?: string | null
          device?: string
          id?: never
          path?: string
          referrer_host?: string | null
          region?: string | null
          viewed_at?: string
          visitor_hash?: string
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          id: boolean
          orders_paused: boolean
          orders_paused_message: string
          orders_paused_until: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          orders_paused?: boolean
          orders_paused_message?: string
          orders_paused_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          orders_paused?: boolean
          orders_paused_message?: string
          orders_paused_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          easypost_shipment_id: string | null
          easypost_tracker_id: string | null
          email: string | null
          id: string
          internal_notes: string | null
          label_url: string | null
          legacy_mongo_id: string | null
          package_weight_oz: number | null
          packed_at: string | null
          paid_at: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          postage_cost_cents: number | null
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
          shipping_service: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents: number
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          tracking_carrier: string | null
          tracking_checked_at: string | null
          tracking_number: string | null
          tracking_status: string | null
          trade_request_id: string | null
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
          easypost_shipment_id?: string | null
          easypost_tracker_id?: string | null
          email?: string | null
          id?: string
          internal_notes?: string | null
          label_url?: string | null
          legacy_mongo_id?: string | null
          package_weight_oz?: number | null
          packed_at?: string | null
          paid_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          postage_cost_cents?: number | null
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
          shipping_service?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents?: number
          subtotal_cents: number
          tax_cents?: number
          total_cents: number
          tracking_carrier?: string | null
          tracking_checked_at?: string | null
          tracking_number?: string | null
          tracking_status?: string | null
          trade_request_id?: string | null
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
          easypost_shipment_id?: string | null
          easypost_tracker_id?: string | null
          email?: string | null
          id?: string
          internal_notes?: string | null
          label_url?: string | null
          legacy_mongo_id?: string | null
          package_weight_oz?: number | null
          packed_at?: string | null
          paid_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          postage_cost_cents?: number | null
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
          shipping_service?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_credit_used_cents?: number
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          tracking_carrier?: string | null
          tracking_checked_at?: string | null
          tracking_number?: string | null
          tracking_status?: string | null
          trade_request_id?: string | null
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
      partner_referrals: {
        Row: {
          checkin_amount_cents: number | null
          checkin_responded_at: string | null
          checkin_response: string | null
          checkin_sent_at: string | null
          created_at: string
          fee_cents: number | null
          fee_paid_at: string | null
          fee_percent: number
          fee_status: string
          id: string
          lead_reference: string
          notes: string | null
          outcome: string
          outcome_at: string | null
          partner_id: string
          referral_lead_id: string | null
          sale_amount_cents: number | null
          sell_submission_id: string | null
          sent_at: string
          sent_by: string | null
          updated_at: string
        }
        Insert: {
          checkin_amount_cents?: number | null
          checkin_responded_at?: string | null
          checkin_response?: string | null
          checkin_sent_at?: string | null
          created_at?: string
          fee_cents?: number | null
          fee_paid_at?: string | null
          fee_percent: number
          fee_status?: string
          id?: string
          lead_reference: string
          notes?: string | null
          outcome?: string
          outcome_at?: string | null
          partner_id: string
          referral_lead_id?: string | null
          sale_amount_cents?: number | null
          sell_submission_id?: string | null
          sent_at?: string
          sent_by?: string | null
          updated_at?: string
        }
        Update: {
          checkin_amount_cents?: number | null
          checkin_responded_at?: string | null
          checkin_response?: string | null
          checkin_sent_at?: string | null
          created_at?: string
          fee_cents?: number | null
          fee_paid_at?: string | null
          fee_percent?: number
          fee_status?: string
          id?: string
          lead_reference?: string
          notes?: string | null
          outcome?: string
          outcome_at?: string | null
          partner_id?: string
          referral_lead_id?: string | null
          sale_amount_cents?: number | null
          sell_submission_id?: string | null
          sent_at?: string
          sent_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_referrals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referrals_referral_lead_id_fkey"
            columns: ["referral_lead_id"]
            isOneToOne: false
            referencedRelation: "referral_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referrals_sell_submission_id_fkey"
            columns: ["sell_submission_id"]
            isOneToOne: false
            referencedRelation: "sell_submissions"
            referencedColumns: ["id"]
          }
        ]
      }
      partners: {
        Row: {
          agreed_to_standards_at: string
          approved_at: string | null
          business_name: string
          buys_by_mail: boolean
          categories: string[]
          city: string | null
          contact_name: string
          coverage: string | null
          created_at: string
          email: string
          fee_percent: number
          id: string
          internal_notes: string | null
          kind: string
          landing_path: string | null
          notes: string | null
          phone: string | null
          profession: string | null
          referrer_host: string | null
          state: string | null
          status: string
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          website: string | null
        }
        Insert: {
          agreed_to_standards_at: string
          approved_at?: string | null
          business_name: string
          buys_by_mail?: boolean
          categories?: string[]
          city?: string | null
          contact_name: string
          coverage?: string | null
          created_at?: string
          email: string
          fee_percent?: number
          id?: string
          internal_notes?: string | null
          kind: string
          landing_path?: string | null
          notes?: string | null
          phone?: string | null
          profession?: string | null
          referrer_host?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          website?: string | null
        }
        Update: {
          agreed_to_standards_at?: string
          approved_at?: string | null
          business_name?: string
          buys_by_mail?: boolean
          categories?: string[]
          city?: string | null
          contact_name?: string
          coverage?: string | null
          created_at?: string
          email?: string
          fee_percent?: number
          id?: string
          internal_notes?: string | null
          kind?: string
          landing_path?: string | null
          notes?: string | null
          phone?: string | null
          profession?: string | null
          referrer_host?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          website?: string | null
        }
        Relationships: []
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
      photo_requests: {
        Row: {
          card_name: string
          card_path: string | null
          closed_at: string | null
          collector_number: string | null
          condition: string | null
          created_at: string
          email: string
          finish: string | null
          first_name: string
          id: string
          inventory_item_id: string | null
          note: string | null
          photo_paths: string[]
          reference_number: string
          send_count: number
          sent_at: string | null
          sent_by: string | null
          set_code: string | null
          set_name: string | null
          staff_message: string | null
          status: string
          updated_at: string
        }
        Insert: {
          card_name: string
          card_path?: string | null
          closed_at?: string | null
          collector_number?: string | null
          condition?: string | null
          created_at?: string
          email: string
          finish?: string | null
          first_name: string
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          photo_paths?: string[]
          reference_number?: string
          send_count?: number
          sent_at?: string | null
          sent_by?: string | null
          set_code?: string | null
          set_name?: string | null
          staff_message?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          card_name?: string
          card_path?: string | null
          closed_at?: string | null
          collector_number?: string | null
          condition?: string | null
          created_at?: string
          email?: string
          finish?: string | null
          first_name?: string
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          photo_paths?: string[]
          reference_number?: string
          send_count?: number
          sent_at?: string | null
          sent_by?: string | null
          set_code?: string | null
          set_name?: string | null
          staff_message?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_requests_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
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
          email: string | null
          id: string
          notes: string | null
          order_id: string | null
          phone: string | null
          pickup_number: number | null
          ready_at: string | null
          status: Database["public"]["Enums"]["pickup_request_status"]
          updated_at: string
          yard_sale_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name: string
          email?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          phone?: string | null
          pickup_number?: number | null
          ready_at?: string | null
          status?: Database["public"]["Enums"]["pickup_request_status"]
          updated_at?: string
          yard_sale_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name?: string
          email?: string | null
          id?: string
          notes?: string | null
          order_id?: string | null
          phone?: string | null
          pickup_number?: number | null
          ready_at?: string | null
          status?: Database["public"]["Enums"]["pickup_request_status"]
          updated_at?: string
          yard_sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_requests_yard_sale_id_fkey"
            columns: ["yard_sale_id"]
            isOneToOne: false
            referencedRelation: "yard_sales"
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
          wishlist_alerts: boolean
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
          wishlist_alerts?: boolean
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
          wishlist_alerts?: boolean
          username?: string | null
        }
        Relationships: []
      }
      referral_leads: {
        Row: {
          categories: string[]
          collection_size: string | null
          consent_to_share_at: string
          created_at: string
          description: string
          email: string
          first_name: string
          handoff: string
          id: string
          last_name: string | null
          location: string | null
          phone: string | null
          photo_paths: string[]
          preferred_contact_method: string
          reference_number: string
          source_path: string | null
          status: string
          landing_path: string | null
          ref_code: string | null
          referrer_host: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          referral_source: string | null
        }
        Insert: {
          categories: string[]
          collection_size?: string | null
          consent_to_share_at: string
          created_at?: string
          description: string
          email: string
          first_name: string
          handoff?: string
          id?: string
          last_name?: string | null
          location?: string | null
          phone?: string | null
          photo_paths?: string[]
          preferred_contact_method?: string
          reference_number?: string
          source_path?: string | null
          status?: string
          landing_path?: string | null
          ref_code?: string | null
          referrer_host?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          referral_source?: string | null
        }
        Update: {
          categories?: string[]
          collection_size?: string | null
          consent_to_share_at?: string
          created_at?: string
          description?: string
          email?: string
          first_name?: string
          handoff?: string
          id?: string
          last_name?: string | null
          location?: string | null
          phone?: string | null
          photo_paths?: string[]
          preferred_contact_method?: string
          reference_number?: string
          source_path?: string | null
          status?: string
          landing_path?: string | null
          ref_code?: string | null
          referrer_host?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          referral_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_leads_ref_code_fkey"
            columns: ["ref_code"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["code"]
          }
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          partner_id: string | null
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          partner_id?: string | null
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          partner_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          }
        ]
      }
      referral_rewards: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          kind: string
          lead_reference: string
          paid_at: string | null
          partner_id: string | null
          ref_code: string
          referral_lead_id: string | null
          sell_submission_id: string | null
          status: string
          store_credit_transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          lead_reference: string
          paid_at?: string | null
          partner_id?: string | null
          ref_code: string
          referral_lead_id?: string | null
          sell_submission_id?: string | null
          status?: string
          store_credit_transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          lead_reference?: string
          paid_at?: string | null
          partner_id?: string | null
          ref_code?: string
          referral_lead_id?: string | null
          sell_submission_id?: string | null
          status?: string
          store_credit_transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referral_lead_id_fkey"
            columns: ["referral_lead_id"]
            isOneToOne: true
            referencedRelation: "referral_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_sell_submission_id_fkey"
            columns: ["sell_submission_id"]
            isOneToOne: true
            referencedRelation: "sell_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_store_credit_transaction_id_fkey"
            columns: ["store_credit_transaction_id"]
            isOneToOne: false
            referencedRelation: "store_credit_transactions"
            referencedColumns: ["id"]
          }
        ]
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
          client_card_id: string | null
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
          client_card_id?: string | null
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
          client_card_id?: string | null
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
          client_card_id: string | null
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          side: string | null
          size_bytes: number
          storage_path: string
          submission_id: string
        }
        Insert: {
          client_card_id?: string | null
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          side?: string | null
          size_bytes: number
          storage_path: string
          submission_id: string
        }
        Update: {
          client_card_id?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          side?: string | null
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
          counter_offer_cents: number | null
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
          offer_responded_at: string | null
          offer_response:
            | Database["public"]["Enums"]["sell_offer_response"]
            | null
          offer_sent_at: string | null
          offer_value_cents: number | null
          payout_method: string | null
          store_credit_bonus_percent: number | null
          store_credit_cents: number | null
          store_credit_issued_at: string | null
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
          landing_path: string | null
          ref_code: string | null
          referrer_host: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          partner_consent_at: string | null
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
          counter_offer_cents?: number | null
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
          offer_responded_at?: string | null
          offer_response?:
            | Database["public"]["Enums"]["sell_offer_response"]
            | null
          offer_sent_at?: string | null
          offer_value_cents?: number | null
          payout_method?: string | null
          store_credit_bonus_percent?: number | null
          store_credit_cents?: number | null
          store_credit_issued_at?: string | null
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
          landing_path?: string | null
          ref_code?: string | null
          referrer_host?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          partner_consent_at?: string | null
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
          counter_offer_cents?: number | null
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
          offer_responded_at?: string | null
          offer_response?:
            | Database["public"]["Enums"]["sell_offer_response"]
            | null
          offer_sent_at?: string | null
          offer_value_cents?: number | null
          payout_method?: string | null
          store_credit_bonus_percent?: number | null
          store_credit_cents?: number | null
          store_credit_issued_at?: string | null
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
          landing_path?: string | null
          ref_code?: string | null
          referrer_host?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          partner_consent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sell_submissions_ref_code_fkey"
            columns: ["ref_code"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["code"]
          }
        ]
      }
      staff_push_log: {
        Row: {
          created_at: string
          event_key: string
          kind: string
        }
        Insert: {
          created_at?: string
          event_key: string
          kind: string
        }
        Update: {
          created_at?: string
          event_key?: string
          kind?: string
        }
        Relationships: []
      }
      staff_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          kinds: string[]
          last_sent_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          kinds?: string[]
          last_sent_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          kinds?: string[]
          last_sent_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sorting_payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          method: string
          note: string | null
          provider_reference: string | null
          quote_id: string | null
          recorded_by: string | null
          request_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          method: string
          note?: string | null
          provider_reference?: string | null
          quote_id?: string | null
          recorded_by?: string | null
          request_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          provider_reference?: string | null
          quote_id?: string | null
          recorded_by?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sorting_payments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "sorting_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "sorting_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_quotes: {
        Row: {
          accepted_at: string | null
          counted_cards: number | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          declined_at: string | null
          id: string
          note_to_customer: string | null
          other_charges: Json
          request_id: string
          return_packaging_cents: number
          return_shipping_cents: number
          sent_at: string | null
          sent_by: string | null
          sorting_service_cents: number
          status: string
          superseded_at: string | null
          total_cents: number
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          counted_cards?: number | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          id?: string
          note_to_customer?: string | null
          other_charges?: Json
          request_id: string
          return_packaging_cents?: number
          return_shipping_cents?: number
          sent_at?: string | null
          sent_by?: string | null
          sorting_service_cents?: number
          status?: string
          superseded_at?: string | null
          total_cents?: number
          updated_at?: string
          version: number
        }
        Update: {
          accepted_at?: string | null
          counted_cards?: number | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          id?: string
          note_to_customer?: string | null
          other_charges?: Json
          request_id?: string
          return_packaging_cents?: number
          return_shipping_cents?: number
          sent_at?: string | null
          sent_by?: string | null
          sorting_service_cents?: number
          status?: string
          superseded_at?: string | null
          total_cents?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sorting_quotes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "sorting_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_requests: {
        Row: {
          accepted_quote_id: string | null
          amount_paid_cents: number
          cancelled_at: string | null
          counted_cards: number | null
          created_at: string
          customer_notes: string | null
          delivery_method: string
          email: string
          estimated_cards: number
          estimated_sorting_cents: number
          first_name: string
          id: string
          internal_notes: string | null
          last_name: string
          option_id: string | null
          option_name: string
          phone: string | null
          rate_per_thousand_cents: number
          received_at: string | null
          reference_number: string
          return_address_id: string | null
          return_carrier: string | null
          return_city: string | null
          return_country: string | null
          return_line1: string | null
          return_line2: string | null
          return_postal_code: string | null
          return_recipient: string | null
          return_state: string | null
          return_tracking_number: string | null
          returned_at: string | null
          shipping_terms_accepted_at: string | null
          shipping_terms_text: string | null
          status: string
          status_changed_at: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_quote_id?: string | null
          amount_paid_cents?: number
          cancelled_at?: string | null
          counted_cards?: number | null
          created_at?: string
          customer_notes?: string | null
          delivery_method: string
          email: string
          estimated_cards: number
          estimated_sorting_cents: number
          first_name: string
          id?: string
          internal_notes?: string | null
          last_name: string
          option_id?: string | null
          option_name: string
          phone?: string | null
          rate_per_thousand_cents: number
          received_at?: string | null
          reference_number?: string
          return_address_id?: string | null
          return_carrier?: string | null
          return_city?: string | null
          return_country?: string | null
          return_line1?: string | null
          return_line2?: string | null
          return_postal_code?: string | null
          return_recipient?: string | null
          return_state?: string | null
          return_tracking_number?: string | null
          returned_at?: string | null
          shipping_terms_accepted_at?: string | null
          shipping_terms_text?: string | null
          status?: string
          status_changed_at?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_quote_id?: string | null
          amount_paid_cents?: number
          cancelled_at?: string | null
          counted_cards?: number | null
          created_at?: string
          customer_notes?: string | null
          delivery_method?: string
          email?: string
          estimated_cards?: number
          estimated_sorting_cents?: number
          first_name?: string
          id?: string
          internal_notes?: string | null
          last_name?: string
          option_id?: string | null
          option_name?: string
          phone?: string | null
          rate_per_thousand_cents?: number
          received_at?: string | null
          reference_number?: string
          return_address_id?: string | null
          return_carrier?: string | null
          return_city?: string | null
          return_country?: string | null
          return_line1?: string | null
          return_line2?: string | null
          return_postal_code?: string | null
          return_recipient?: string | null
          return_state?: string | null
          return_tracking_number?: string | null
          returned_at?: string | null
          shipping_terms_accepted_at?: string | null
          shipping_terms_text?: string | null
          status?: string
          status_changed_at?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sorting_requests_accepted_quote_fk"
            columns: ["accepted_quote_id", "id"]
            isOneToOne: false
            referencedRelation: "sorting_quotes"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "sorting_requests_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "sorting_service_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_requests_return_address_id_fkey"
            columns: ["return_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_service_options: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          rate_per_thousand_cents: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          rate_per_thousand_cents: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          rate_per_thousand_cents?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
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
      storewide_sales: {
        Row: {
          created_at: string
          created_by: string | null
          discount_percent: number
          enabled: boolean
          ends_at: string
          id: string
          name: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount_percent: number
          enabled?: boolean
          ends_at: string
          id?: string
          name?: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount_percent?: number
          enabled?: boolean
          ends_at?: string
          id?: string
          name?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      trade_events: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          actor_type: string
          created_at: string
          detail: Json
          event: string
          from_status: string | null
          id: string
          to_status: string | null
          trade_request_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          actor_type: string
          created_at?: string
          detail?: Json
          event: string
          from_status?: string | null
          id?: string
          to_status?: string | null
          trade_request_id: string
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          actor_type?: string
          created_at?: string
          detail?: Json
          event?: string
          from_status?: string | null
          id?: string
          to_status?: string | null
          trade_request_id?: string
        }
        Relationships: []
      }
      trade_messages: {
        Row: {
          author_id: string | null
          author_label: string | null
          author_type: string
          body: string
          created_at: string
          id: string
          trade_request_id: string
          visible_to_customer: boolean
        }
        Insert: {
          author_id?: string | null
          author_label?: string | null
          author_type: string
          body: string
          created_at?: string
          id?: string
          trade_request_id: string
          visible_to_customer?: boolean
        }
        Update: {
          author_id?: string | null
          author_label?: string | null
          author_type?: string
          body?: string
          created_at?: string
          id?: string
          trade_request_id?: string
          visible_to_customer?: boolean
        }
        Relationships: []
      }
      trade_offer_cards: {
        Row: {
          approved_quantity: number | null
          approved_unit_cents: number | null
          authenticity: string
          card_name: string
          collector_number: string | null
          condition_percent: number
          created_at: string
          customer_estimate_cents: number | null
          customer_note: string | null
          disposition: string
          eligibility: string
          estimated_unit_cents: number | null
          final_quantity: number | null
          final_unit_cents: number | null
          finish: Database["public"]["Enums"]["card_finish"]
          flags: string[]
          id: string
          image_url: string | null
          imported_inventory_item_id: string | null
          inspected_at: string | null
          inspection_internal_note: string | null
          inspection_note: string | null
          internal_note: string | null
          position: number
          quantity: number
          received_quantity: number | null
          reference_checked_at: string | null
          reference_price_cents: number | null
          reported_condition: Database["public"]["Enums"]["card_condition"]
          review_note: string | null
          review_status: string
          scryfall_id: string | null
          set_code: string | null
          set_name: string | null
          stock_on_hand: number | null
          trade_request_id: string
          updated_at: string
          verified_condition: Database["public"]["Enums"]["card_condition"] | null
        }
        Insert: {
          approved_quantity?: number | null
          approved_unit_cents?: number | null
          authenticity?: string
          card_name: string
          collector_number?: string | null
          condition_percent?: number
          created_at?: string
          customer_estimate_cents?: number | null
          customer_note?: string | null
          disposition?: string
          eligibility?: string
          estimated_unit_cents?: number | null
          final_quantity?: number | null
          final_unit_cents?: number | null
          finish?: Database["public"]["Enums"]["card_finish"]
          flags?: string[]
          id?: string
          image_url?: string | null
          imported_inventory_item_id?: string | null
          inspected_at?: string | null
          inspection_internal_note?: string | null
          inspection_note?: string | null
          internal_note?: string | null
          position?: number
          quantity: number
          received_quantity?: number | null
          reference_checked_at?: string | null
          reference_price_cents?: number | null
          reported_condition?: Database["public"]["Enums"]["card_condition"]
          review_note?: string | null
          review_status?: string
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          stock_on_hand?: number | null
          trade_request_id: string
          updated_at?: string
          verified_condition?: Database["public"]["Enums"]["card_condition"] | null
        }
        Update: {
          approved_quantity?: number | null
          approved_unit_cents?: number | null
          authenticity?: string
          card_name?: string
          collector_number?: string | null
          condition_percent?: number
          created_at?: string
          customer_estimate_cents?: number | null
          customer_note?: string | null
          disposition?: string
          eligibility?: string
          estimated_unit_cents?: number | null
          final_quantity?: number | null
          final_unit_cents?: number | null
          finish?: Database["public"]["Enums"]["card_finish"]
          flags?: string[]
          id?: string
          image_url?: string | null
          imported_inventory_item_id?: string | null
          inspected_at?: string | null
          inspection_internal_note?: string | null
          inspection_note?: string | null
          internal_note?: string | null
          position?: number
          quantity?: number
          received_quantity?: number | null
          reference_checked_at?: string | null
          reference_price_cents?: number | null
          reported_condition?: Database["public"]["Enums"]["card_condition"]
          review_note?: string | null
          review_status?: string
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          stock_on_hand?: number | null
          trade_request_id?: string
          updated_at?: string
          verified_condition?: Database["public"]["Enums"]["card_condition"] | null
        }
        Relationships: []
      }
      trade_request_items: {
        Row: {
          card_name: string
          collector_number: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string | null
          inventory_item_id: string | null
          quantity: number
          reservation_id: string | null
          scryfall_id: string | null
          set_code: string | null
          set_name: string | null
          status: string
          trade_request_id: string
          unit_price_cents: number
          variant_type: string | null
        }
        Insert: {
          card_name: string
          collector_number?: string | null
          condition: Database["public"]["Enums"]["card_condition"]
          created_at?: string
          finish: Database["public"]["Enums"]["card_finish"]
          id?: string
          image_url?: string | null
          inventory_item_id?: string | null
          quantity: number
          reservation_id?: string | null
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          status?: string
          trade_request_id: string
          unit_price_cents: number
          variant_type?: string | null
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
          quantity?: number
          reservation_id?: string | null
          scryfall_id?: string | null
          set_code?: string | null
          set_name?: string | null
          status?: string
          trade_request_id?: string
          unit_price_cents?: number
          variant_type?: string | null
        }
        Relationships: []
      }
      trade_requests: {
        Row: {
          accepted_at: string | null
          amount_due_cents: number | null
          approval_conditions: string | null
          approved_at: string | null
          approved_value_cents: number | null
          cash_paid_at: string | null
          cash_payout_cents: number | null
          close_reason: string | null
          closed_at: string | null
          completed_at: string | null
          condition_percents: Json
          created_at: string
          credit_issued_cents: number | null
          credit_rate_percent: number
          customer_email: string | null
          customer_name: string | null
          customer_note: string | null
          estimated_value_cents: number
          excess_cents: number | null
          excess_handling: string
          final_credit_cents: number | null
          final_offer_at: string | null
          final_value_cents: number | null
          hold_expires_at: string | null
          id: string
          inbound_carrier: string | null
          inbound_shipped_at: string | null
          inbound_tracking: string | null
          min_card_value_cents: number
          order_id: string | null
          paid_at: string | null
          payment_due_at: string | null
          payment_reference: string | null
          processing_fee_cents: number
          received_at: string | null
          return_carrier: string | null
          return_tracking: string | null
          returned_at: string | null
          ship_by: string | null
          ship_city: string | null
          ship_line1: string | null
          ship_line2: string | null
          ship_name: string | null
          ship_postal_code: string | null
          ship_state: string | null
          shipping_cents: number | null
          status: string
          submitted_at: string | null
          trade_number: number
          updated_at: string
          user_id: string
          wanted_total_cents: number
        }
        Insert: {
          accepted_at?: string | null
          amount_due_cents?: number | null
          approval_conditions?: string | null
          approved_at?: string | null
          approved_value_cents?: number | null
          cash_paid_at?: string | null
          cash_payout_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          completed_at?: string | null
          condition_percents: Json
          created_at?: string
          credit_issued_cents?: number | null
          credit_rate_percent: number
          customer_email?: string | null
          customer_name?: string | null
          customer_note?: string | null
          estimated_value_cents?: number
          excess_cents?: number | null
          excess_handling?: string
          final_credit_cents?: number | null
          final_offer_at?: string | null
          final_value_cents?: number | null
          hold_expires_at?: string | null
          id?: string
          inbound_carrier?: string | null
          inbound_shipped_at?: string | null
          inbound_tracking?: string | null
          min_card_value_cents: number
          order_id?: string | null
          paid_at?: string | null
          payment_due_at?: string | null
          payment_reference?: string | null
          processing_fee_cents?: number
          received_at?: string | null
          return_carrier?: string | null
          return_tracking?: string | null
          returned_at?: string | null
          ship_by?: string | null
          ship_city?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_name?: string | null
          ship_postal_code?: string | null
          ship_state?: string | null
          shipping_cents?: number | null
          status?: string
          submitted_at?: string | null
          trade_number?: never
          updated_at?: string
          user_id: string
          wanted_total_cents?: number
        }
        Update: {
          accepted_at?: string | null
          amount_due_cents?: number | null
          approval_conditions?: string | null
          approved_at?: string | null
          approved_value_cents?: number | null
          cash_paid_at?: string | null
          cash_payout_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          completed_at?: string | null
          condition_percents?: Json
          created_at?: string
          credit_issued_cents?: number | null
          credit_rate_percent?: number
          customer_email?: string | null
          customer_name?: string | null
          customer_note?: string | null
          estimated_value_cents?: number
          excess_cents?: number | null
          excess_handling?: string
          final_credit_cents?: number | null
          final_offer_at?: string | null
          final_value_cents?: number | null
          hold_expires_at?: string | null
          id?: string
          inbound_carrier?: string | null
          inbound_shipped_at?: string | null
          inbound_tracking?: string | null
          min_card_value_cents?: number
          order_id?: string | null
          paid_at?: string | null
          payment_due_at?: string | null
          payment_reference?: string | null
          processing_fee_cents?: number
          received_at?: string | null
          return_carrier?: string | null
          return_tracking?: string | null
          returned_at?: string | null
          ship_by?: string | null
          ship_city?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_name?: string | null
          ship_postal_code?: string | null
          ship_state?: string | null
          shipping_cents?: number | null
          status?: string
          submitted_at?: string | null
          trade_number?: never
          updated_at?: string
          user_id?: string
          wanted_total_cents?: number
        }
        Relationships: []
      }
      trade_settings: {
        Row: {
          cash_payout_enabled: boolean
          cash_rate_percent: number
          condition_dmg_percent: number
          condition_hp_percent: number
          condition_lp_percent: number
          condition_mp_percent: number
          condition_nm_percent: number
          credit_rate_percent: number
          enabled: boolean
          excluded_card_names: string[]
          excluded_set_codes: string[]
          id: boolean
          max_active_trades: number
          max_expired_trades_30d: number
          max_offered_lines: number
          max_trade_value_cents: number | null
          max_wanted_lines: number
          min_card_value_cents: number
          min_trade_value_cents: number
          notify_customer: boolean
          notify_staff: boolean
          overstock_threshold: number
          packing_instructions: string
          pause_message: string
          paused: boolean
          payment_due_days: number
          processing_fee_cents: number
          reservation_hours: number
          return_policy: string
          revision_hours: number
          ship_business_days: number
          ship_grace_hours: number
          ship_to_city: string | null
          ship_to_line1: string | null
          ship_to_line2: string | null
          ship_to_name: string | null
          ship_to_postal_code: string | null
          ship_to_state: string | null
          shipping_paid_by: string
          transit_alert_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cash_payout_enabled?: boolean
          cash_rate_percent?: number
          condition_dmg_percent?: number
          condition_hp_percent?: number
          condition_lp_percent?: number
          condition_mp_percent?: number
          condition_nm_percent?: number
          credit_rate_percent?: number
          enabled?: boolean
          excluded_card_names?: string[]
          excluded_set_codes?: string[]
          id?: boolean
          max_active_trades?: number
          max_expired_trades_30d?: number
          max_offered_lines?: number
          max_trade_value_cents?: number | null
          max_wanted_lines?: number
          min_card_value_cents?: number
          min_trade_value_cents?: number
          notify_customer?: boolean
          notify_staff?: boolean
          overstock_threshold?: number
          packing_instructions?: string
          pause_message?: string
          paused?: boolean
          payment_due_days?: number
          processing_fee_cents?: number
          reservation_hours?: number
          return_policy?: string
          revision_hours?: number
          ship_business_days?: number
          ship_grace_hours?: number
          ship_to_city?: string | null
          ship_to_line1?: string | null
          ship_to_line2?: string | null
          ship_to_name?: string | null
          ship_to_postal_code?: string | null
          ship_to_state?: string | null
          shipping_paid_by?: string
          transit_alert_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cash_payout_enabled?: boolean
          cash_rate_percent?: number
          condition_dmg_percent?: number
          condition_hp_percent?: number
          condition_lp_percent?: number
          condition_mp_percent?: number
          condition_nm_percent?: number
          credit_rate_percent?: number
          enabled?: boolean
          excluded_card_names?: string[]
          excluded_set_codes?: string[]
          id?: boolean
          max_active_trades?: number
          max_expired_trades_30d?: number
          max_offered_lines?: number
          max_trade_value_cents?: number | null
          max_wanted_lines?: number
          min_card_value_cents?: number
          min_trade_value_cents?: number
          notify_customer?: boolean
          notify_staff?: boolean
          overstock_threshold?: number
          packing_instructions?: string
          pause_message?: string
          paused?: boolean
          payment_due_days?: number
          processing_fee_cents?: number
          reservation_hours?: number
          return_policy?: string
          revision_hours?: number
          ship_business_days?: number
          ship_grace_hours?: number
          ship_to_city?: string | null
          ship_to_line1?: string | null
          ship_to_line2?: string | null
          ship_to_name?: string | null
          ship_to_postal_code?: string | null
          ship_to_state?: string | null
          shipping_paid_by?: string
          transit_alert_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          balance_cents: number
          confirmed_by: string | null
          confirmed_by_email: string | null
          created_at: string
          credit_cents: number
          credit_percent: number
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          emailed_at: string | null
          emailed_to: string | null
          id: string
          share_token: string
          texted_at: string | null
          texted_to: string | null
          their_cards: Json
          their_tcg_low_cents: number
          trade_number: number
          your_cards: Json
          your_cards_cents: number
        }
        Insert: {
          balance_cents: number
          confirmed_by?: string | null
          confirmed_by_email?: string | null
          created_at?: string
          credit_cents: number
          credit_percent: number
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          share_token: string
          texted_at?: string | null
          texted_to?: string | null
          their_cards?: Json
          their_tcg_low_cents: number
          trade_number?: never
          your_cards?: Json
          your_cards_cents: number
        }
        Update: {
          balance_cents?: number
          confirmed_by?: string | null
          confirmed_by_email?: string | null
          created_at?: string
          credit_cents?: number
          credit_percent?: number
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          emailed_at?: string | null
          emailed_to?: string | null
          id?: string
          share_token?: string
          texted_at?: string | null
          texted_to?: string | null
          their_cards?: Json
          their_tcg_low_cents?: number
          trade_number?: never
          your_cards?: Json
          your_cards_cents?: number
        }
        Relationships: []
      }
      yard_sales: {
        Row: {
          created_at: string
          created_by: string | null
          discount_percent: number
          ended_at: string | null
          ends_at: string
          id: string
          min_price_cents: number
          next_pickup_number: number
          started_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount_percent?: number
          ended_at?: string | null
          ends_at: string
          id?: string
          min_price_cents?: number
          next_pickup_number?: number
          started_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount_percent?: number
          ended_at?: string | null
          ends_at?: string
          id?: string
          min_price_cents?: number
          next_pickup_number?: number
          started_at?: string
          updated_at?: string
          updated_by?: string | null
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
          discount_percent: number | null
          finish: Database["public"]["Enums"]["card_finish"] | null
          foil: boolean | null
          id: string | null
          image_url: string | null
          language: string | null
          oracle_id: string | null
          original_price_cents: number | null
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
          deal_discount_percent: number | null
          deal_note: string | null
          deal_source: string | null
          deal_started_at: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          is_deal: boolean
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          original_price_cents: number | null
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
          storefront_listed_at: string
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
      admin_mark_section_seen: {
        Args: { p_section: string }
        Returns: string
      }
      admin_nav_badges: {
        Args: { p_user_id?: string }
        Returns: Json
      }
      admin_order_geography: {
        Args: never
        Returns: {
          first_order_at: string
          last_order_at: string
          order_count: number
          sample_postal_code: string
          ship_city: string
          ship_state: string
          total_revenue_cents: number
        }[]
      }
      admin_orders_matching_id_prefix: {
        Args: { p_prefix: string }
        Returns: string[]
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
          deal_discount_percent: number
          deal_note: string
          deal_source: string
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean
          id: string
          image_url: string
          is_deal: boolean
          notes: string
          oracle_id: string
          original_price_cents: number
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
          deal_discount_percent: number | null
          deal_note: string | null
          deal_source: string | null
          deal_started_at: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          is_deal: boolean
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          original_price_cents: number | null
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
          storefront_listed_at: string
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
      admin_sourcing_signals: {
        Args: never
        Returns: {
          card_name: string
          currently_in_stock: boolean
          in_stock_quantity: number
          oracle_id: string
          stock_alert_count: number
          total_demand: number
          wishlist_count: number
        }[]
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
          deal_discount_percent: number | null
          deal_note: string | null
          deal_source: string | null
          deal_started_at: string | null
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean | null
          id: string
          image_url: string | null
          is_deal: boolean
          language: string
          legacy_mongo_id: string | null
          notes: string | null
          oracle_id: string | null
          original_price_cents: number | null
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
          storefront_listed_at: string
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
      apply_aged_inventory_deals: { Args: never; Returns: number }
      campaign_audience_count: {
        Args: { p_audience: Database["public"]["Enums"]["campaign_audience"] }
        Returns: number
      }
      cancel_unpaid_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_site_traffic: {
        Args: { p_range?: string }
        Returns: Json
      }
      site_visitor_counts: {
        Args: { p_end: string; p_start: string }
        Returns: {
          page_views: number
          visitors: number
        }[]
      }
      store_ordering_status: {
        Args: never
        Returns: {
          message: string
          paused: boolean
          paused_until: string | null
        }[]
      }
      cart_item_availability: {
        Args: { p_ids: string[] }
        Returns: {
          card_name: string
          condition: Database["public"]["Enums"]["card_condition"]
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string
          price_cents: number
          quantity: number
          set_code: string
          set_name: string
          variant_type: string
        }[]
      }
      checkout_create_order: {
        Args: {
          p_guest_email?: string
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
      commander_organic_synergy: {
        Args: { p_commander_oracle_id: string; p_exclude_deck_id: string }
        Returns: {
          deck_count: number
          oracle_id: string
        }[]
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_staff_role: { Args: never; Returns: string }
      current_storewide_sale: {
        Args: never
        Returns: {
          discount_percent: number
          ends_at: string
          id: string
          name: string
          starts_at: string
        }[]
      }
      deck_card_images: {
        Args: { p_deck_id: string }
        Returns: {
          deck_card_id: string
          image_url: string
        }[]
      }
      deck_inventory_matches: {
        Args: { p_deck_id: string }
        Returns: {
          available_quantity: number
          card_name: string
          condition: Database["public"]["Enums"]["card_condition"]
          deck_card_id: string
          finish: Database["public"]["Enums"]["card_finish"]
          image_url: string
          inventory_item_id: string
          oracle_id: string
          owned: boolean
          price_cents: number
          requested_quantity: number
          set_code: string
          set_name: string
        }[]
      }
      deck_notification_summary: {
        Args: never
        Returns: {
          card_name: string
          created_at: string
          deck_names: string[]
          id: string
          inventory_item_id: string
          read_at: string
        }[]
      }
      deck_recommendations: {
        Args: { p_deck_id: string; p_limit?: number }
        Returns: {
          card_name: string
          category: string
          image_url: string
          in_stock: boolean
          inventory_item_id: string
          oracle_id: string
          reason: string
          score: number
          scryfall_price_cents: number
          store_price_cents: number
        }[]
      }
      get_card_detail: { Args: { p_slug: string }; Returns: Json }
      get_or_create_my_cart: { Args: never; Returns: string }
      guest_order_lookup: {
        Args: { p_email: string; p_order_number: string }
        Returns: Json
      }
      inventory_facets: {
        Args: never
        Returns: {
          card_types: string[]
          color_combos: string[]
          creature_types: string[]
          price_max_cents: number
          price_min_cents: number
          rarities: string[]
          sets: Json
        }[]
      }
      inventory_live_prices: {
        Args: { p_inventory_item_ids: string[] }
        Returns: {
          inventory_item_id: string
          price_cents: number
        }[]
      }
      inventory_write_authorized: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      kiosk_create_pickup_request: {
        Args: {
          p_customer_name: string
          p_email?: string
          p_items: Json
          p_phone: string
        }
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
      grant_referral_reward: {
        Args: {
          p_amount_cents: number
          p_created_by: string | null
          p_kind: string
          p_lead_reference: string
          p_partner_id: string | null
          p_ref_code: string
          p_referral_lead_id: string | null
          p_sell_submission_id: string | null
          p_user_id: string | null
        }
        Returns: string
      }
      my_referral_code: { Args: never; Returns: string }
      my_referral_summary: { Args: never; Returns: Json }
      my_store_credit_balance: { Args: never; Returns: number }
      my_wishlist: {
        Args: never
        Returns: {
          card_name: string
          created_at: string
          id: string
          image_url: string
          in_stock: boolean
          inventory_item_id: string
          min_price_cents: number
          oracle_id: string
        }[]
      }
      pickup_remove_item: {
        Args: { p_item_id: string; p_quantity?: number }
        Returns: Json
      }
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
      rebuild_card_recommendation_catalog: { Args: never; Returns: undefined }
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
      resolve_deck_card_names: {
        Args: { p_names: string[] }
        Returns: {
          card_name: string
          commander_legal: boolean
          image_url: string
          input_name: string
          oracle_id: string
          scryfall_id: string
          type_line: string
        }[]
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
      search_deals: {
        Args: {
          p_card_types?: string[]
          p_color_groups?: string[]
          p_conditions?: Database["public"]["Enums"]["card_condition"][]
          p_creature_types?: string[]
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
          condition: Database["public"]["Enums"]["card_condition"]
          deal_discount_percent: number
          deal_note: string
          deal_source: string
          deal_started_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string
          oracle_id: string
          original_price_cents: number
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
      search_deck_card_names: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          card_name: string
          image_url: string
          type_line: string
        }[]
      }
      search_inventory: {
        Args: {
          p_card_types?: string[]
          p_color_groups?: string[]
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
          deal_discount_percent: number
          deal_note: string
          deal_source: string
          deal_started_at: string
          finish: Database["public"]["Enums"]["card_finish"]
          foil: boolean
          id: string
          image_url: string
          is_deal: boolean
          oracle_id: string
          original_price_cents: number
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
      search_scryfall_bulk_by_name_trgm: {
        Args: { p_limit?: number; p_name: string; p_set_code?: string }
        Returns: {
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
        }[]
        SetofOptions: {
          from: "*"
          to: "scryfall_bulk_cards"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_sorting_requests: {
        Args: never
        Returns: {
          accepted_total_cents: number
          amount_paid_cents: number
          created_at: string
          delivery_method: string
          email: string
          estimated_cards: number
          id: string
          option_name: string
          quote_status: string
          quote_total_cents: number
          reference_number: string
          status: string
        }[]
      }
      sorting_accept_quote: {
        Args: { p_quote_id: string; p_request_id: string }
        Returns: Json
      }
      sorting_decline_quote: {
        Args: { p_quote_id: string; p_reason?: string; p_request_id: string }
        Returns: Json
      }
      sorting_record_payment: {
        Args: {
          p_actor?: string
          p_amount_cents: number
          p_method: string
          p_note?: string
          p_reference?: string
          p_request_id: string
        }
        Returns: Json
      }
      sorting_send_quote: {
        Args: { p_actor?: string; p_quote_id: string }
        Returns: {
          accepted_at: string | null
          counted_cards: number | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          declined_at: string | null
          id: string
          note_to_customer: string | null
          other_charges: Json
          request_id: string
          return_packaging_cents: number
          return_shipping_cents: number
          sent_at: string | null
          sent_by: string | null
          sorting_service_cents: number
          status: string
          superseded_at: string | null
          total_cents: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "sorting_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sell_submission_offer_lookup: {
        Args: { p_email: string; p_reference_number: string }
        Returns: Json
      }
      shop_card_name_suggestions: {
        Args: { p_query: string }
        Returns: {
          card_name: string
        }[]
      }
      shop_sets_with_counts: {
        Args: never
        Returns: {
          card_count: number
          min_price_cents: number
          set_code: string
          set_name: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify_card_name: { Args: { p_name: string }; Returns: string }
      staff_or_service_role: { Args: never; Returns: boolean }
      store_credit_balance: { Args: { p_user_id: string }; Returns: number }
      storefront_effective_discount_percent: {
        Args: {
          p_is_deal: boolean
          p_original_price_cents: number
          p_price_cents: number
        }
        Returns: number
      }
      storefront_effective_original_price: {
        Args: {
          p_is_deal: boolean
          p_original_price_cents: number
          p_price_cents: number
        }
        Returns: number
      }
      storefront_effective_price: {
        Args: {
          p_is_deal: boolean
          p_original_price_cents: number
          p_price_cents: number
        }
        Returns: number
      }
      trade_accept_final: {
        Args: {
          p_ship_city: string
          p_ship_line1: string
          p_ship_line2: string | null
          p_ship_name: string | null
          p_ship_postal_code: string
          p_ship_state: string
          p_trade_id: string
          p_user_id: string
        }
        Returns: {
          due_cents: number
          new_order_id: string | null
          new_status: string
        }[]
      }
      trade_approve: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_conditions: string | null
          p_ship_by: string
          p_trade_id: string
        }
        Returns: number
      }
      trade_close: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_actor_type: string
          p_from_statuses: string[]
          p_reason: string | null
          p_status: string
          p_trade_id: string
        }
        Returns: boolean
      }
      trade_expire_due: {
        Args: { p_limit?: number }
        Returns: {
          expired_from_status: string
          expired_trade_id: string
          expired_trade_number: number
        }[]
      }
      trade_import_card: {
        Args: {
          p_actor: string
          p_offer_card_id: string
          p_price_cents: number
          p_storage_location: string | null
        }
        Returns: string
      }
      trade_inspect_cards: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_cards: Json
          p_trade_id: string
        }
        Returns: undefined
      }
      trade_record_payment: {
        Args: {
          p_paid_cents: number
          p_reference: string
          p_trade_id: string
        }
        Returns: string
      }
      trade_request_revision: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_message: string
          p_trade_id: string
        }
        Returns: string
      }
      trade_review_cards: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_cards: Json
          p_trade_id: string
        }
        Returns: undefined
      }
      trade_save_offer: {
        Args: { p_cards: Json; p_trade_id: string; p_user_id: string }
        Returns: number
      }
      trade_send_final_offer: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_cash_for_excess: boolean
          p_trade_id: string
        }
        Returns: number
      }
      trade_set_wanted: {
        Args: {
          p_actor_id: string | null
          p_actor_label: string | null
          p_actor_type: string
          p_items: Json
          p_statuses: string[]
          p_trade_id: string
        }
        Returns: number
      }
      trade_start: {
        Args: {
          p_customer_email: string | null
          p_customer_name: string | null
          p_items: Json
          p_user_id: string
        }
        Returns: string
      }
      trade_submit: {
        Args: { p_note: string | null; p_trade_id: string; p_user_id: string }
        Returns: undefined
      }
      yard_sale_add_to_list: {
        Args: { p_items: Json; p_request_id: string }
        Returns: number
      }
      yard_sale_check_settings: {
        Args: {
          p_discount_percent: number
          p_ends_at: string
          p_min_price_cents: number
        }
        Returns: undefined
      }
      yard_sale_complete_list: {
        Args: { p_payment_method: string; p_request_id: string }
        Returns: {
          discount_cents: number
          order_id: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
        }[]
      }
      yard_sale_create_list: {
        Args: { p_customer_name: string; p_items: Json }
        Returns: {
          pickup_number: number
          request_id: string
        }[]
      }
      yard_sale_deck_matches: {
        Args: { p_names: string[] }
        Returns: {
          card_name: string
          collector_number: string
          condition: Database["public"]["Enums"]["card_condition"]
          deal_discount_percent: number
          deal_note: string
          deal_source: string
          finish: Database["public"]["Enums"]["card_finish"]
          id: string
          image_url: string
          input_name: string
          oracle_id: string
          original_price_cents: number
          price_cents: number
          quantity: number
          rarity: string
          scryfall_id: string
          set_code: string
          set_name: string
          type_line: string
          variant_type: string
        }[]
      }
      yard_sale_end: {
        Args: { p_actor?: string; p_sale_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          discount_percent: number
          ended_at: string | null
          ends_at: string
          id: string
          min_price_cents: number
          next_pickup_number: number
          started_at: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "yard_sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      yard_sale_hold_card: {
        Args: {
          p_inventory_item_id: string
          p_min_price_cents: number
          p_pickup_number: number
          p_quantity: number
          p_request_id: string
        }
        Returns: undefined
      }
      yard_sale_lines: {
        Args: { p_items: Json; p_max_lines: number }
        Returns: {
          inventory_item_id: string
          quantity: number
        }[]
      }
      yard_sale_price: {
        Args: { p_discount_percent: number; p_price_cents: number }
        Returns: number
      }
      yard_sale_start: {
        Args: {
          p_actor?: string
          p_discount_percent?: number
          p_ends_at: string
          p_min_price_cents?: number
        }
        Returns: {
          created_at: string
          created_by: string | null
          discount_percent: number
          ended_at: string | null
          ends_at: string
          id: string
          min_price_cents: number
          next_pickup_number: number
          started_at: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "yard_sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      yard_sale_status: {
        Args: never
        Returns: {
          active: boolean
          discount_percent: number
          ends_at: string
          min_price_cents: number
          sale_id: string
          sales_tax_bps: number
        }[]
      }
      yard_sale_update: {
        Args: {
          p_actor?: string
          p_discount_percent?: number
          p_ends_at?: string
          p_min_price_cents?: number
          p_sale_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          discount_percent: number
          ended_at: string | null
          ends_at: string
          id: string
          min_price_cents: number
          next_pickup_number: number
          started_at: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "yard_sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
        | "return_restock"
        | "trade_in"
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
      sell_offer_response: "accepted" | "declined" | "countered"
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
        | "referral_reward"
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
        "return_restock",
        "trade_in",
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
      sell_offer_response: ["accepted", "declined", "countered"],
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
        "referral_reward",
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
