import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { QrCode } from "./QrCode";
import { YardSaleSign } from "./YardSaleSign";
import type { FlyerCopy } from "../../utils/marketing";
import type { YardSaleShowcaseCard } from "../../types";

// Printable flyer and table sign, from the Marketing page (and a referral
// partner's drawer on Partners). A full-window preview with Print / Close;
// printing is isolated to the page the same way shipping labels are
// (LabelPrintView): while this is open the body carries gg-printing-flyer,
// which admin.css uses to hide everything else when printing, and a <style>
// sets the paper to US Letter with a margin home printers can manage. Both are
// removed on close, so they never affect another print.
//
//   flyer  headline, QR code, selling points, small print and eight tear-off
//          strips with the address, for corkboards at game stores, libraries,
//          laundromats and estate sales.
//   sign   one big QR code and headline, for a card-show table or a counter
//          (fits a standard 8½ × 11 sign holder).
//   yard-sale  the yard sale table sign: a few of the most valuable cards at
//          the sale with their yard sale prices, and the QR code for
//          /yard-sale with how it works (YardSaleSign.tsx).
//
// Sizes are real inches so the page prints 1:1 at 100% scale.

export type FlyerLayout = "flyer" | "sign" | "yard-sale";

export interface FlyerJob {
  layout: FlyerLayout;
  copy: FlyerCopy;
  /** What the QR code opens: the tagged link. */
  url: string;
  /** The address printed for typing in: under the QR code and on the strips. */
  address: string;
  /** An optional line the owner typed, e.g. "Find us at table 12 today". */
  extraLine?: string | null;
  /** For the yard sale sign: its featured cards and the discount, as of printedAt (ISO). */
  yardSale?: { showcase: YardSaleShowcaseCard[]; discountPercent: number; printedAt: string };
}

const PRINTING_BODY_CLASS = "gg-printing-flyer";
const PX_PER_IN = 96;
/** US Letter, less the 0.4in margin on each side (and a hair, so it never spills onto a second page). */
const SHEET_WIDTH_IN = 7.7;
export const TEAR_OFF_STRIPS = 8;

const HINTS: Record<FlyerLayout, string> = {
  flyer:
    "Prints on US Letter paper. In the print dialog keep the scale at 100% (Default) and turn off headers and footers. Scan the QR code with your phone before printing a stack, then cut between the tear-off strips.",
  sign:
    "Prints on US Letter paper and fits a standard 8½ × 11 sign holder. Keep the scale at 100% (Default) and turn off headers and footers. Scan the QR code with your phone before you set it out.",
  "yard-sale":
    "Prints on US Letter paper and fits a standard 8½ × 11 sign holder. Print in color so the cards show, keep the scale at 100% (Default) and turn off headers and footers. Scan the QR code with your phone before you set it out.",
};

const TITLES: Record<FlyerLayout, string> = { flyer: "Flyer", sign: "Table sign", "yard-sale": "Yard sale sign" };

/** Longest Print waits for the yard sale sign's card pictures before allowing it anyway. */
const CARD_PICTURES_WAIT_MS = 10_000;

export function FlyerPrintView({ job, onClose }: { job: FlyerJob; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const title = TITLES[job.layout];
  // The yard sale sign prints card pictures from Scryfall: hold Print until
  // they've loaded, so none print blank (but never for more than 10 seconds).
  const pictures = job.layout === "yard-sale" ? (job.yardSale?.showcase.length ?? 0) : 0;
  const [picturesReady, setPicturesReady] = useState(pictures === 0);
  useEffect(() => {
    if (pictures === 0) return;
    const timer = window.setTimeout(() => setPicturesReady(true), CARD_PICTURES_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [pictures]);

  useFocusTrap(rootRef, true, onClose);

  useLayoutEffect(() => {
    document.body.classList.add(PRINTING_BODY_CLASS);
    const style = document.createElement("style");
    style.setAttribute("data-gg-flyer-page", "");
    style.textContent = "@page { size: 8.5in 11in; margin: 0.4in; }";
    document.head.appendChild(style);
    return () => {
      document.body.classList.remove(PRINTING_BODY_CLASS);
      style.remove();
    };
  }, []);

  // Fit the on-screen preview to the window (phones see the whole page).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      if (stage.clientWidth > 0) setZoom(Math.min(1, stage.clientWidth / (SHEET_WIDTH_IN * PX_PER_IN)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className="gg-admin-portal gg-flyerprint-root"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} preview`}
    >
      <div className="gg-labelprint-toolbar no-print">
        <div className="gg-labelprint-heading">
          <strong>{title}</strong>
          <span>{HINTS[job.layout]}</span>
        </div>
        <div className="gg-labelprint-actions">
          <Button variant="primary" icon="printer" disabled={!picturesReady} onClick={() => window.print()}>
            {picturesReady ? "Print" : "Loading cards…"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div ref={stageRef} className="gg-flyerprint-stage">
        <div className="gg-flyerprint-zoom" style={{ zoom }}>
          {job.layout === "flyer" ? (
            <Flyer job={job} />
          ) : job.layout === "yard-sale" ? (
            <YardSaleSign job={job} onImagesSettled={() => setPicturesReady(true)} />
          ) : (
            <TableSign job={job} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The printed address, split between the site and the page
 * ("geega-games.com" / "/sell-cards-and-games?ref=…") so a long one breaks
 * there instead of mid-word, which is what makes it hard to type.
 */
function Address({ address }: { address: string }) {
  const slash = address.indexOf("/");
  const lines = slash > 0 ? [address.slice(0, slash), address.slice(slash)] : [address];
  return (
    <span className="gg-flyer__address">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function Flyer({ job }: { job: FlyerJob }) {
  const { copy } = job;
  return (
    <article className="gg-flyer gg-flyer--flyer" data-testid="flyer-page">
      <div className="gg-flyer__main">
        <header className="gg-flyer__top">
          <img className="gg-flyer__logo" src="/logo.png" alt="Geega Games" />
          <h1 className="gg-flyer__headline">{copy.headline}</h1>
          <p className="gg-flyer__sub">{copy.sub}</p>
        </header>
        <div className="gg-flyer__middle">
          <div className="gg-flyer__qrblock">
            <QrCode value={job.url} size={240} label={`QR code for ${job.address}`} />
            <strong className="gg-flyer__cta">{copy.cta}</strong>
            <Address address={job.address} />
          </div>
          <ul className="gg-flyer__points">
            {copy.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        {job.extraLine && <p className="gg-flyer__extra">{job.extraLine}</p>}
        {copy.finePrint && <p className="gg-flyer__fine">{copy.finePrint}</p>}
      </div>
      <div className="gg-flyer__strips">
        {Array.from({ length: TEAR_OFF_STRIPS }, (_, i) => (
          <div key={i} className="gg-flyer__strip">
            <strong>{copy.stripLabel}</strong>
            <Address address={job.address} />
          </div>
        ))}
      </div>
    </article>
  );
}

function TableSign({ job }: { job: FlyerJob }) {
  const { copy } = job;
  return (
    <article className="gg-flyer gg-flyer--sign" data-testid="sign-page">
      <img className="gg-flyer__logo" src="/logo.png" alt="Geega Games" />
      <h1 className="gg-flyer__headline">{copy.headline}</h1>
      <QrCode value={job.url} size={400} label={`QR code for ${job.address}`} />
      <strong className="gg-flyer__cta">{copy.cta}</strong>
      <Address address={job.address} />
      {job.extraLine && <p className="gg-flyer__extra">{job.extraLine}</p>}
      {copy.finePrint && <p className="gg-flyer__fine">{copy.finePrint}</p>}
    </article>
  );
}
