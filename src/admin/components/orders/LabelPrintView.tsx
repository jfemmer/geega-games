import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { shipFromLines } from "../../../store/lib/shipFrom";
import {
  ADDRESS_BLOCK,
  PAGE_SIZE_IN,
  addressFontSizePt,
  recipientLines,
  type PweLabelFormat,
} from "../../utils/shippingLabels";
import type { Order } from "../../types";

// One-click label printing for the Orders page. Opening this prints right
// away (the browser's print dialog is the only step left), then closes
// itself when the dialog does.
//
//   pwe      Plain White Envelope: the store's return address and the
//            customer's address, printed straight onto a 3⅝ × 6½ or a #10
//            envelope (see PweLabelFormat). No postage, no server call.
//   postage  the 4×6 label image bought through EasyPost, for the label
//            printer.
//
// Printing is isolated to the envelope or label: while this is open, the
// body carries gg-printing-label (admin.css hides everything else when
// printing) and a <style> sets the page to its exact size, so no scaling or
// margins creep in, and clips the printout to that one page, so a printer
// never feeds a blank second envelope or label. Both are removed on close,
// so they never affect another print (like a POS receipt).

export type LabelPrintJob =
  | { kind: "pwe"; order: Order; format: PweLabelFormat }
  | { kind: "postage"; order: Order; labelUrl: string };

const PRINTING_BODY_CLASS = "gg-printing-label";
const PX_PER_IN = 96;
/** An afterprint sooner than this means the dialog didn't block (iOS), so stay open. */
const REAL_DIALOG_MS = 1000;

/** Print dialog settings, set once (browsers remember them). */
const PRINT_SETTINGS = "margins None and scale 100%. Your browser remembers this after the first one.";

function envelopeHint(size: string): string {
  return `Load a ${size} envelope in your printer. In the print dialog, pick that envelope size, ${PRINT_SETTINGS} The stamp goes in the top right corner.`;
}

const HINTS: Record<PweLabelFormat | "postage-4x6", string> = {
  "envelope-6-3-4": envelopeHint("3⅝ × 6½ (#6¾)"),
  "envelope-10": envelopeHint("4⅛ × 9½ (#10)"),
  "postage-4x6": `For a 4×6 label printer. In the print dialog, pick it with paper size 4×6 (or 100 × 150 mm), ${PRINT_SETTINGS}`,
};

export function LabelPrintView({ job, onClose }: { job: LabelPrintJob; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const printStartedAt = useRef<number | null>(null);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">(
    job.kind === "postage" ? "loading" : "ready",
  );
  const [landscapeImage, setLandscapeImage] = useState(false);
  const [zoom, setZoom] = useState(1);

  const pageKey = job.kind === "pwe" ? job.format : "postage-4x6";
  const page = PAGE_SIZE_IN[pageKey];
  const title = `${job.kind === "pwe" ? "Envelope" : "Shipping label"} for ${job.order.orderNumber}`;

  useFocusTrap(rootRef, true, onClose);

  useLayoutEffect(() => {
    document.body.classList.add(PRINTING_BODY_CLASS);
    const style = document.createElement("style");
    style.setAttribute("data-gg-label-page", "");
    const size = `width: ${page.width}in !important; height: ${page.height}in !important;`;
    style.textContent =
      `@page { size: ${page.width}in ${page.height}in; margin: 0; }\n` +
      `@media print { html, body { ${size} overflow: hidden !important; } }`;
    document.head.appendChild(style);
    return () => {
      document.body.classList.remove(PRINTING_BODY_CLASS);
      style.remove();
    };
  }, [page.width, page.height]);

  // Fit the on-screen preview to the window.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      // Not laid out yet (or hidden): keep the full size rather than zoom to nothing.
      if (stage.clientWidth > 0) setZoom(Math.min(1, stage.clientWidth / (page.width * PX_PER_IN)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [page.width]);

  function print() {
    printStartedAt.current = Date.now();
    window.print();
  }

  // Print as soon as there's something to print. For an address label that's
  // immediately, still inside the click that opened this.
  const autoPrinted = useRef(false);
  useLayoutEffect(() => {
    if (autoPrinted.current || imageState !== "ready") return;
    autoPrinted.current = true;
    print();
  }, [imageState]);

  // Back to the order once the print dialog closes.
  useEffect(() => {
    let timer: number | undefined;
    function afterPrint() {
      const started = printStartedAt.current;
      if (started !== null && Date.now() - started >= REAL_DIALOG_MS) {
        timer = window.setTimeout(onClose, 300);
      }
    }
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("afterprint", afterPrint);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className="gg-admin-portal gg-labelprint-root"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="gg-labelprint-toolbar no-print">
        <div className="gg-labelprint-heading">
          <strong>{title}</strong>
          <span>{HINTS[pageKey]}</span>
        </div>
        <div className="gg-labelprint-actions">
          <Button variant="primary" icon="printer" onClick={print} disabled={imageState !== "ready"}>
            Print
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {imageState === "error" && job.kind === "postage" && (
          <p className="gg-alert gg-alert-error" role="alert">
            Couldn&rsquo;t load the label image.{" "}
            <a href={job.labelUrl} target="_blank" rel="noopener noreferrer">
              Open the label file
            </a>{" "}
            and print it from there.
          </p>
        )}
      </div>

      <div ref={stageRef} className="gg-labelprint-stage">
        <div className="gg-labelprint-zoom" style={{ zoom }}>
          <div className={`gg-labelpage gg-labelpage--${pageKey}`}>
            {job.kind === "pwe" ? (
              <div className="gg-label">
                <div className="gg-label__from">
                  {shipFromLines().map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  <div className="gg-label__ref">Order {job.order.orderNumber}</div>
                </div>
                <PweAddress order={job.order} format={job.format} />
              </div>
            ) : (
              <img
                className={`gg-label__img${landscapeImage ? " gg-label__img--landscape" : ""}`}
                src={job.labelUrl}
                alt={`Postage label for ${job.order.orderNumber}`}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setLandscapeImage(img.naturalWidth > img.naturalHeight);
                  setImageState("ready");
                }}
                onError={() => setImageState("error")}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The delivery address, placed for the format and sized so no line breaks. */
function PweAddress({ order, format }: { order: Order; format: PweLabelFormat }) {
  const lines = recipientLines(order);
  const block = ADDRESS_BLOCK[format];
  return (
    <div
      className="gg-label__to"
      style={{
        left: `${block.leftIn}in`,
        top: `${block.topIn}in`,
        width: `${block.widthIn}in`,
        fontSize: `${addressFontSizePt(lines, format)}pt`,
      }}
    >
      {lines.map((line, i) => (
        <div key={`${i}-${line}`}>{line}</div>
      ))}
    </div>
  );
}
