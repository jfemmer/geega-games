import { useEffect, useState } from "react";
import type { FlyerJob } from "../components/partners/FlyerPrintView";
import { saveFile } from "../utils/saveFile";
import { YARD_SALE_SIGN_PDF_NAME } from "../utils/yardSaleSign";

export const YARD_SALE_SIGN_PDF_ERROR =
  "Couldn't make the PDF. Check your connection and try again, or use Print and pick Save as PDF.";

type PdfState = { status: "preparing" } | { status: "ready"; blob: Blob } | { status: "failed" };

/**
 * The yard sale sign as a PDF file, for Save PDF in the sign preview. It's
 * made as soon as the preview opens (pdf-lib and the fonts load only then),
 * so tapping Save PDF can hand the file straight to the share sheet: phones
 * only open it right after a tap. Null for any other print job.
 */
export function useYardSaleSignPdf(job: FlyerJob | null) {
  const [state, setState] = useState<PdfState>({ status: "preparing" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!job) return;
    let alive = true;
    import("../utils/yardSaleSignPdf")
      .then(({ makeYardSaleSignPdf }) => makeYardSaleSignPdf(job))
      .then((blob) => {
        if (alive) setState({ status: "ready", blob });
      })
      .catch(() => {
        if (alive) setState({ status: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [job, attempt]);

  if (!job) return null;

  function save() {
    if (state.status === "ready") {
      void saveFile(state.blob, YARD_SALE_SIGN_PDF_NAME, "Yard sale sign");
    } else if (state.status === "failed") {
      setState({ status: "preparing" });
      setAttempt((n) => n + 1);
    }
  }

  return { status: state.status, save };
}
