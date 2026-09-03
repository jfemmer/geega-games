// MOCK session for the signed-in admin. In production this comes from Supabase
// Auth (the authenticated staff member), never hard-coded.

import type { StaffRole } from "../types";

export const CURRENT_ADMIN = {
  id: "stf_1",
  name: "Jordan Vega",
  email: "jordan@geega-games.com",
  initials: "JV",
  role: "owner" as StaffRole,
};
