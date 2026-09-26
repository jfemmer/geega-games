import { useState } from "react";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

// The "Delete lead" block at the bottom of the Buying Leads and Partner
// Leads drawers. Deleting is permanent (the lead, its details and the
// seller's photos), so it always goes through a confirmation. Only the store
// owner can delete; the server enforces that and explains if anyone else
// tries.

export function DeleteLeadSection({
  referenceNumber,
  warning,
  blockedReason,
  onDelete,
}: {
  referenceNumber: string;
  /** Extra caution for the confirmation, e.g. "It's marked Completed…". */
  warning?: string | null;
  /** When set, this lead can't be deleted and the reason is shown instead. */
  blockedReason?: string | null;
  /** Deletes the lead. Report errors to the user; resolve either way. */
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="gg-leaddetail__section gg-leaddetail__danger">
      <h3>Delete lead</h3>
      {blockedReason ? (
        <p className="gg-card-meta">{blockedReason}</p>
      ) : (
        <>
          <p className="gg-card-meta">
            Removes this lead and the seller&rsquo;s photos for good. This can&rsquo;t be undone.
          </p>
          <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirming(true)}>
            Delete lead
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Delete lead ${referenceNumber}?`}
        message={[
          "This permanently deletes the lead and the seller's photos. It can't be undone.",
          warning ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel="Delete lead"
        tone="danger"
        onConfirm={async () => {
          await onDelete();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
