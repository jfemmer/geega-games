import { commanderImageUrl, entrantLabel, type TournamentCommander, type TournamentEntrant } from "../../utils/tournament";

/**
 * Small card images for each commander picked from the search, or the
 * player's initials when none was picked (a typed-only name has no image).
 */
export function CommanderCards({ entrant, size }: { entrant: TournamentEntrant; size: "sm" | "md" | "lg" }) {
  const cards = entrant.commanders.filter((c): c is TournamentCommander & { cardId: string } => Boolean(c?.cardId));
  if (cards.length === 0) {
    return (
      <span className={`gg-bcards gg-bcards--${size} gg-bcards--empty`} aria-hidden="true">
        {entrantLabel(entrant)
          .split(/\s*&\s*/)
          .map((n) => n.slice(0, 1).toUpperCase())
          .join("")}
      </span>
    );
  }
  return (
    <span className={`gg-bcards gg-bcards--${size}`}>
      {cards.map((c) => (
        <img
          key={c.cardId}
          src={commanderImageUrl(c.cardId, size === "lg" ? "normal" : "small")}
          alt={c.name}
          title={c.name}
          loading="lazy"
        />
      ))}
    </span>
  );
}
