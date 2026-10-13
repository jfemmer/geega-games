import { useMemo, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { SelectField } from "../../components/ui/Field";
import { Spinner } from "../../components/ui/States";
import { Icon } from "../../components/ui/Icon";
import { useAsync } from "../../hooks/useAsync";
import { scanRepository, scryfallRepository } from "../../repositories";
import { CONDITION_LABELS } from "../../utils/labels";
import { approvalPatch, isSureMatch } from "../../utils/scanApproval";
import type { CardCondition, CardScan, InventoryPriceFloor } from "../../types";

// "Approve sure matches": every card recognition was sure about (auto-matched
// and not yet reviewed) goes to "ready" in one go — the same as pressing
// Enter on each: finish from the batch's foil switch, today's Scryfall price
// for that finish (raised to the price floors) unless staff typed one, and
// the condition chosen here for cards nobody has graded yet. Cards that
// can't be approved (no Scryfall price) are left matched and listed.
//
// Mounted only while open, so every opening starts fresh.

const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];
const CONCURRENCY = 2;
const PAGE_SIZE = 500;
/** A session the bridge kept adding batches to can grow past one page. */
const MAX_PAGES = 20;

interface Skipped {
  scan: CardScan;
  reason: string;
}

/** Every matched scan in the session, across pages (each card once, even if rows shift between pages). */
async function allMatchedScans(sessionId: string): Promise<CardScan[]> {
  const first = await scanRepository.listScans(sessionId, { filter: "matched", pageSize: PAGE_SIZE, page: 1 });
  const byId = new Map(first.rows.map((s) => [s.id, s]));
  for (let page = 2; (page - 1) * PAGE_SIZE < first.total && page <= MAX_PAGES; page++) {
    const next = await scanRepository.listScans(sessionId, { filter: "matched", pageSize: PAGE_SIZE, page });
    if (next.rows.length === 0) break;
    for (const s of next.rows) byId.set(s.id, s);
  }
  return [...byId.values()];
}

export function ApproveSureModal({
  sessionId,
  priceFloors,
  onClose,
  onDone,
}: {
  sessionId: string;
  priceFloors: InventoryPriceFloor[];
  onClose: () => void;
  onDone: (result: { approved: number; skipped: number }) => void;
}) {
  const matched = useAsync(() => allMatchedScans(sessionId), [sessionId]);
  const sure = useMemo(() => (matched.data ? matched.data.filter(isSureMatch) : null), [matched.data]);
  const loadError = matched.error;
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [skipped, setSkipped] = useState<Skipped[]>([]);

  const ungraded = sure?.filter((s) => !s.confirmedCondition).length ?? 0;

  async function approveAll() {
    if (!sure || sure.length === 0) return;
    setRunning(true);
    setDone(0);
    const skippedNow: Skipped[] = [];
    let approved = 0;
    let next = 0;
    async function worker() {
      while (next < sure!.length) {
        const scan = sure![next++];
        try {
          // Today's price for the printing — the same lookup as picking a match by hand.
          const printing = (await scryfallRepository.getByScryfallId(scan.selectedScryfallId!)) ?? scan.selectedPrinting;
          if (!printing) {
            skippedNow.push({ scan, reason: "Couldn't load this printing." });
          } else {
            const result = approvalPatch(scan, printing, priceFloors, condition);
            if (result.ok) {
              await scanRepository.updateScan(scan.id, result.patch);
              approved++;
            } else {
              skippedNow.push({ scan, reason: result.reason });
            }
          }
        } catch (err) {
          skippedNow.push({ scan, reason: err instanceof Error ? err.message : "Couldn't save." });
        }
        setDone((d) => d + 1);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sure.length) }, worker));
    setRunning(false);
    setSkipped(skippedNow);
    onDone({ approved, skipped: skippedNow.length });
    if (skippedNow.length === 0) onClose();
  }

  const count = sure?.length ?? 0;
  const finished = !running && done > 0;

  return (
    <Modal
      open
      onClose={() => !running && onClose()}
      title="Approve sure matches"
      size="sm"
      footer={
        finished ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={running}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={approveAll} loading={running} disabled={!sure || count === 0}>
              {running ? `Approving ${done} of ${count}…` : `Approve ${count}`}
            </Button>
          </>
        )
      }
    >
      {loadError && <p className="gg-bridge-panel__error" role="alert">{loadError}</p>}
      {!sure && !loadError && <Spinner label="Finding sure matches" />}
      {sure && !finished && (
        <div className="gg-approvesure">
          {count === 0 ? (
            <p>No sure matches waiting in this session — everything left needs a look.</p>
          ) : (
            <>
              <p>
                <strong>{count}</strong> sure match{count === 1 ? "" : "es"} will be marked ready to add to inventory,
                priced at today's Scryfall price for {count === 1 ? "its" : "their"} finish (raised to your price floors)
                unless you already typed a price.
              </p>
              {ungraded > 0 && (
                <SelectField
                  label={`Condition for the ${ungraded} card${ungraded === 1 ? "" : "s"} not graded yet`}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as CardCondition)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </SelectField>
              )}
              <p className="gg-muted">Nothing is added to inventory until you click "Add to inventory".</p>
            </>
          )}
        </div>
      )}
      {finished && (
        <div className="gg-approvesure">
          <p>
            <Icon name="checkCircle" size={16} /> {done - skipped.length} approved.
          </p>
          {skipped.length > 0 && (
            <>
              <p>{skipped.length} still need a look:</p>
              <ul className="gg-approvesure__skipped">
                {skipped.slice(0, 8).map(({ scan, reason }) => (
                  <li key={scan.id}>
                    #{String(scan.sequenceNumber).padStart(3, "0")} {scan.selectedPrinting?.cardName ?? ""} — {reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
