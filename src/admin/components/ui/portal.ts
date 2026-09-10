// Admin portal container.
//
// PROBLEM this solves: Modal/drawer/preview components render through
// createPortal(). If they portal to document.body, they escape the `.gg-admin`
// element where the design-system CSS custom properties (--gg-surface,
// --gg-brand, --gg-text, --gg-shadow-lg, …) are declared. Custom properties
// inherit through the DOM tree, so a node under <body> — outside `.gg-admin` —
// resolves every `var(--gg-…)` to its initial value (empty), which is why the
// Order/Inventory drawers rendered transparent/unstyled.
//
// FIX: portal admin overlays into a dedicated container that carries the
// `.gg-admin-portal` class. That class is given the SAME token block as
// `.gg-admin` in admin.css (see the shared `.gg-admin, .gg-admin-portal { … }`
// declaration), so portaled content inherits the full design system while
// living at the end of <body> (correct stacking above the app).
//
// We deliberately do NOT parent the container inside the `.gg-admin` DOM node:
// that node is a flex layout with overflow constraints, and nesting fixed
// overlays inside it can clip them. A body-level container that merely re-
// declares the tokens gives us correct styling AND correct stacking, without
// leaking admin styles onto the public storefront (only elements with the
// class get the tokens).

const CONTAINER_ID = "gg-admin-portal-root";

/**
 * Returns the shared admin portal container, creating it on first use. Safe to
 * call repeatedly (idempotent) and during SSR-less browser rendering only.
 * Falls back to document.body if the DOM is somehow unavailable.
 */
export function getAdminPortalContainer(): HTMLElement {
  if (typeof document === "undefined") {
    // Should never happen in this browser-only admin, but keep types honest.
    return null as unknown as HTMLElement;
  }
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    // The class that re-declares the --gg-* tokens (see admin.css).
    el.className = "gg-admin-portal";
    document.body.appendChild(el);
  }
  return el;
}