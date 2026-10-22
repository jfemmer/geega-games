/**
 * A special printing ("Artist Proof") on a yard sale list line: the list
 * sheet, the sent list and Shop your deck. A small version of the gold
 * ribbon the card wears on the page (KioskProductCard), so it stands out
 * from the set and condition; nothing for a regular printing.
 */
export default function YardSaleVariantBadge({ variant }: { variant: string | null | undefined }) {
  const label = variant?.trim();
  if (!label) return null;
  return (
    <span className="gg-yard-variant">
      <span aria-hidden="true">★ </span>
      {label}
    </span>
  );
}
