import { useState } from "react";
import { SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { QrCode } from "../partners/QrCode";
import { useToast } from "../../hooks/useToast";
import { tournamentShareUrl } from "../../utils/tournament";

// Admin → Tournaments: the player display link. Open it on the store TV, or
// let players scan the QR code to follow along on their phones and add their
// commander. Staff can turn the link off or replace it.

export function PlayerDisplayPanel({
  share,
  busy,
  onChange,
}: {
  share: { token: string; enabled: boolean };
  busy: boolean;
  onChange: (change: { enabled?: boolean; rotate?: boolean }) => Promise<boolean>;
}) {
  const toast = useToast();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const phoneUrl = tournamentShareUrl(origin, share.token);
  const tvUrl = tournamentShareUrl(origin, share.token, true);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it instead.");
    }
  }

  return (
    <SectionCard
      title="Player display"
      action={
        <Badge tone={share.enabled ? "success" : "neutral"} dot>
          {share.enabled ? "Link on" : "Link off"}
        </Badge>
      }
    >
      {share.enabled ? (
        <div className="gg-tourney-share">
          <QrCode value={phoneUrl} size={120} label="QR code for the player display" />
          <div className="gg-tourney-share__body">
            <p>
              Put the bracket on a TV, or let players scan the code to follow along on their phones and add their
              commander.
            </p>
            <a className="gg-tourney-share__url" href={phoneUrl} target="_blank" rel="noopener noreferrer">
              {phoneUrl}
            </a>
            <div className="gg-btn-row">
              <Button
                variant="primary"
                icon="external"
                onClick={() => window.open(tvUrl, "_blank", "noopener,noreferrer")}
              >
                Open TV display
              </Button>
              <Button variant="secondary" icon="copy" onClick={copy}>
                Copy link
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmRotate(true)}>
                New link
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void onChange({ enabled: false })}>
                Turn off
              </Button>
            </div>
            <p className="gg-muted">
              Anyone with the link sees pairings and standings and can set commanders. Results and names stay with staff.
            </p>
          </div>
        </div>
      ) : (
        <div className="gg-tourney-share__off">
          <p className="gg-muted">The player display link is off, so the TV and players' phones can't open it.</p>
          <Button variant="secondary" loading={busy} onClick={() => void onChange({ enabled: true })}>
            Turn link on
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmRotate}
        title="Make a new link?"
        message="The current link and its QR code stop working, including on any TV showing it. Open the display again with the new link."
        confirmLabel="New link"
        onConfirm={async () => {
          await onChange({ rotate: true });
          setConfirmRotate(false);
        }}
        onCancel={() => setConfirmRotate(false)}
      />
    </SectionCard>
  );
}
