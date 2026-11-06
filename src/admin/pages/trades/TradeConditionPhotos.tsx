import { useRef } from "react";
import { Button } from "../../components/ui/Button";
import { tradeCenterRepository } from "../../repositories/tradeCenter.supabase";
import { CONDITION_PHOTO_STATUSES, TRADE_LIMITS, type StaffTrade, type StaffTradeOfferCard } from "../../../store/lib/tradeCenter";
import type { TradePanelProps } from "./types";

// Condition photos of one of the customer's cards, at inspection: what staff
// saw (whitening, a crease, the wrong printing), for the final offer. The
// customer sees them beside the card once the offer is out. Photos are
// downsized in the browser and go straight to private storage; links to them
// are short-lived. Added and removed while inspecting, until the customer
// answers the offer.

export function TradeConditionPhotos({
  trade,
  card,
  busy,
  run,
}: {
  trade: StaffTrade;
  card: StaffTradeOfferCard;
  busy: TradePanelProps["busy"];
  run: TradePanelProps["run"];
}) {
  const input = useRef<HTMLInputElement>(null);
  const editable = CONDITION_PHOTO_STATUSES.includes(trade.status);
  const room = TRADE_LIMITS.maxConditionPhotos - card.photos.length;
  const key = `photos-${card.id}`;

  async function add(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, Math.max(room, 0));
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;
    await run(
      key,
      () => tradeCenterRepository.uploadConditionPhotos(trade.id, card.id, picked),
      picked.length === 1 ? "Photo added." : `${picked.length} photos added.`,
    );
  }

  if (!editable && card.photos.length === 0) return null;
  return (
    <div className="gg-trd-photos">
      <span className="gg-trd-photos__label">Condition photos{card.photos.length > 0 ? ` (${card.photos.length})` : ""}</span>
      {card.photos.length > 0 && (
        <ul className="gg-trd-photos__list">
          {card.photos.map((p, n) => (
            <li key={p.path}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Open photo ${n + 1} of ${card.cardName}`}>
                <img src={p.url} alt="" loading="lazy" />
              </a>
              {editable && (
                <button
                  type="button"
                  className="gg-trd-photos__remove"
                  aria-label={`Remove photo ${n + 1} of ${card.cardName}`}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`photo-remove-${p.path}`, () => tradeCenterRepository.deleteConditionPhoto(trade.id, p.path), "Photo removed.")
                  }
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && room > 0 && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            hidden
            aria-label={`Photos of ${card.cardName}`}
            onChange={(e) => void add(e.target.files)}
          />
          <Button size="sm" variant="secondary" icon="camera" onClick={() => input.current?.click()} loading={busy === key} disabled={busy !== null}>
            Add photos
          </Button>
          <span className="gg-card-meta">The customer sees these with your final offer. Up to {TRADE_LIMITS.maxConditionPhotos}.</span>
        </>
      )}
    </div>
  );
}
