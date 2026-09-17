import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import type { Order } from "../../types";

// A plain (no-postage) address label for Plain White Envelope orders — just
// the return address and the recipient's address, sized for a thermal label
// printer. PWE is intentionally untracked (see ShipModal), so this never
// touches order status or calls the server; it only formats data already on
// the order.
//
// Printing is isolated to just this label (not the rest of the admin
// dashboard) via a body class that admin.css scopes a `@media print` rule
// to — added on mount, removed on unmount, so it can never leak into an
// unrelated print action (e.g. the POS receipt printer) triggered later.
const PRINTING_BODY_CLASS = "gg-printing-label";

// Keep in sync with SHIP_FROM_ADDRESS in api/_lib/easypost.ts if the
// business's return address ever changes. Duplicated deliberately — that
// file is server-only and can't be imported into the browser bundle.
const SHIP_FROM = {
  name: "Geega Games",
  street1: "390 Newbury Dr.",
  cityStateZip: "Ballwin, MO 63011",
};

export function AddressLabelPrint({ order, onClose }: { order: Order; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add(PRINTING_BODY_CLASS);
    return () => document.body.classList.remove(PRINTING_BODY_CLASS);
  }, []);

  return createPortal(
    <div className="gg-labelprint-overlay">
      <div className="gg-labelprint-toolbar no-print">
        <Button variant="primary" icon="download" onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="gg-shippinglabel">
        <div className="gg-shippinglabel__from">
          {SHIP_FROM.name}
          <br />
          {SHIP_FROM.street1}
          <br />
          {SHIP_FROM.cityStateZip}
        </div>
        <div className="gg-shippinglabel__to">
          {order.shipRecipient}
          <br />
          {order.shipLine1}
          {order.shipLine2 ? (
            <>
              <br />
              {order.shipLine2}
            </>
          ) : null}
          <br />
          {order.shipCity}, {order.shipState} {order.shipPostalCode}
        </div>
      </div>
    </div>,
    document.body,
  );
}
