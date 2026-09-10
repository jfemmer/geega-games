import { useState } from "react";
import type { CardFinish, CardPrinting } from "../../types";
import { Badge } from "../ui/Badge";
import {
  FINISH_LABELS,
  RARITY_LABELS,
  RARITY_TONE,
  TREATMENT_LABELS,
  TREATMENT_TONE,
} from "../../utils/labels";
import { formatCents } from "../../utils/format";
import { extractPriceForFinish } from "../../services/scryfall";
import type { ScryfallCard } from "../../services/scryfall.types";

/** Small row of treatment badges (showcase/borderless/etc.) for a printing. */
export function PrintingTreatmentBadges({
  printing,
  max,
}: {
  printing: CardPrinting;
  max?: number;
}) {
  const list = max ? printing.treatments.slice(0, max) : printing.treatments;
  if (list.length === 0) return null;
  return (
    <span className="gg-treatments">
      {list.map((t) => (
        <Badge key={t} tone={TREATMENT_TONE[t]}>
          {TREATMENT_LABELS[t]}
        </Badge>
      ))}
    </span>
  );
}

/** Compact list of the finishes a printing is available in. */
export function FinishPills({ finishes }: { finishes: CardFinish[] }) {
  return (
    <span className="gg-finishpills">
      {finishes.map((f) => (
        <span key={f} className="gg-finishpill" data-finish={f}>
          {FINISH_LABELS[f]}
        </span>
      ))}
    </span>
  );
}

/**
 * The reference price for a specific finish, read from the printing's normalized
 * prices (foil→usdFoil, etched→usdEtched, else usd). Falls back to plain usd.
 */
export function priceForFinish(
  printing: CardPrinting,
  finish: CardFinish,
): number | null {
  // Reuse the shared extractor by faking the minimal price shape.
  const fake = {
    prices: {
      usd: printing.prices.usd != null ? (printing.prices.usd / 100).toString() : null,
      usd_foil:
        printing.prices.usdFoil != null
          ? (printing.prices.usdFoil / 100).toString()
          : null,
      usd_etched:
        printing.prices.usdEtched != null
          ? (printing.prices.usdEtched / 100).toString()
          : null,
    },
  } as unknown as ScryfallCard;
  return extractPriceForFinish(fake, finish);
}

/**
 * Large "confirm exactly this card" preview used after selecting a printing, in
 * both the manual add flow and scan review. Supports switching between faces of
 * multi-faced cards and reflects the reference price for the chosen finish.
 */
export function SelectedPrintingPreview({
  printing,
  finish,
}: {
  printing: CardPrinting;
  finish?: CardFinish | null;
}) {
  const [faceIndex, setFaceIndex] = useState(0);
  const faces = printing.faces.length > 0 ? printing.faces : [];
  const activeFace = faces[Math.min(faceIndex, Math.max(0, faces.length - 1))];
  const img =
    activeFace?.images.large ??
    activeFace?.images.normal ??
    printing.images.large ??
    printing.images.normal ??
    printing.imageUrl;
  const multiFace =
    faces.length > 1 &&
    faces[0]?.images.normal !== faces[1]?.images.normal;

  const refPrice =
    finish != null ? priceForFinish(printing, finish) : printing.prices.usd;

  return (
    <div className="gg-selprint">
      <div className="gg-selprint__imgcol">
        <img src={img} alt={printing.cardName} className="gg-selprint__img" />
        {multiFace && (
          <div className="gg-selprint__faces">
            {faces.map((_f, i) => (
              <button
                key={i}
                type="button"
                className={
                  i === faceIndex
                    ? "gg-selprint__face gg-selprint__face--active"
                    : "gg-selprint__face"
                }
                onClick={() => setFaceIndex(i)}
              >
                {i === 0 ? "Front" : i === 1 ? "Back" : `Face ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="gg-selprint__meta">
        <div className="gg-selprint__name">{activeFace?.name ?? printing.cardName}</div>
        <div className="gg-muted">
          {printing.setName} ({printing.setCode}) · #{printing.collectorNumber}
        </div>
        <div className="gg-selprint__tags">
          <Badge tone={RARITY_TONE[printing.rarity]}>
            {RARITY_LABELS[printing.rarity]}
          </Badge>
          <PrintingTreatmentBadges printing={printing} />
        </div>
        {printing.artist && (
          <div className="gg-muted gg-selprint__artist">
            Illustrated by {printing.artist}
          </div>
        )}
        <div className="gg-selprint__finishes">
          <span className="gg-selprint__finlabel">Finishes</span>
          <FinishPills finishes={printing.availableFinishes} />
        </div>
        {refPrice != null && (
          <div className="gg-selprint__price">
            Scryfall reference{finish ? ` (${FINISH_LABELS[finish]})` : ""}:{" "}
            <strong>{formatCents(refPrice)}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
