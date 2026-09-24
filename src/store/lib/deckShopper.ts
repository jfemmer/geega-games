// Lets other parts of the storefront (e.g. the home page's deck showcase)
// open the header's "Shop my deck" popover, so there's one deck-shopping
// UI rather than a second copy of it.

export const OPEN_DECK_SHOP_EVENT = "gg:open-deck-shop";

export function openDeckShopper(): void {
  window.dispatchEvent(new Event(OPEN_DECK_SHOP_EVENT));
}
