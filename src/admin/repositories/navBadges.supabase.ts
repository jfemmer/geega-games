// Counts for the admin's number badges (sidebar, phone menu button, app icon)
// and the "you've seen Users" marker that clears the Users badge. Both go
// through staff-only database functions; see the admin_nav_badges migration.

import { isSupabaseConfigured, supabase } from "../../supabase";
import { orderRepository } from "./index";
import { notifyAdminDataChanged } from "./apiClient";
import { EMPTY_NAV_BADGES, parseNavBadges, type NavBadgeCounts } from "../utils/navBadges";

export const navBadgesRepository = {
  async counts(): Promise<NavBadgeCounts> {
    if (!isSupabaseConfigured) {
      // Local demo data: only orders have counts there.
      const orders = await orderRepository.counts();
      return { ...EMPTY_NAV_BADGES, needs_packing: orders.needs_packing ?? 0 };
    }
    const { data, error } = await supabase.rpc("admin_nav_badges");
    if (error) throw new Error(error.message);
    return parseNavBadges(data);
  },

  /**
   * Records that this staff member just opened Users, which clears their Users
   * badge on every device. Returns when they last looked before this (a week
   * ago the first time), so the page can mark who's new since then.
   */
  async markUsersSeen(): Promise<string | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.rpc("admin_mark_section_seen", { p_section: "users" });
    if (error) throw new Error(error.message);
    notifyAdminDataChanged();
    return typeof data === "string" ? data : null;
  },
};
