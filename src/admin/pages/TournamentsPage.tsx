import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { SelectField, TextField } from "../components/ui/Field";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { Icon } from "../components/ui/Icon";
import { ErrorState, TableSkeleton } from "../components/ui/States";
import { CreateTournamentForm } from "../components/tournaments/CreateTournamentForm";
import { RoundMatches } from "../components/tournaments/RoundMatches";
import { AddEntrantForm, EntrantFields, StandingsTable } from "../components/tournaments/StandingsTable";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { ADMIN_BASE } from "../hooks/useRouter";
import { adminFetch } from "../repositories/apiClient";
import {
  MAX_TOURNAMENT_NAME,
  activeEntrants,
  canRepairRound,
  cleanPlayerName,
  computeStandings,
  entrantLabel,
  entrantProblem,
  formatInfo,
  matchesInRound,
  hasNewOpponents,
  nextRoundBlocker,
  type ReportableResult,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentMatch,
  type TournamentSummary,
} from "../utils/tournament";

// Admin → Tournaments: run a 1v1 or Two-Headed Giant event at the store.
// Enter everyone's names, then each round pairs every player (or team) at
// random with someone they haven't played yet; tap the winner of each match
// and the standings keep score. Pairing happens on the server
// (/api/admin/tournaments) so two devices can't pair the same round twice.

const ENDPOINT = "/api/admin/tournaments";
const PAGE_PATH = `${ADMIN_BASE}/tournaments`;

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

function summaryLabel(t: TournamentSummary): string {
  const format = formatInfo(t.format).label;
  if (t.status === "finished") return `${t.name} · ${format} (finished)`;
  return t.currentRound > 0 ? `${t.name} · ${format} · round ${t.currentRound}` : `${t.name} · ${format}`;
}

export function TournamentsPage({ query, onNavigate }: { query: URLSearchParams; onNavigate: Navigate }) {
  const toast = useToast();
  const list = useAsync(
    () => adminFetch<{ tournaments: TournamentSummary[] }>(ENDPOINT).then((r) => r.tournaments),
    [],
  );
  const [creating, setCreating] = useState(false);
  // A tournament just created, shown straight away while the list catches up.
  const [created, setCreated] = useState<TournamentDetail | null>(null);

  const all = list.data ?? [];
  const wanted = query.get("id");
  const selectedId =
    (wanted && (all.some((t) => t.id === wanted) || created?.id === wanted) ? wanted : null) ??
    all.find((t) => t.status === "active")?.id ??
    all[0]?.id ??
    null;
  const showCreate = creating || (list.data != null && all.length === 0 && !created);

  const select = useCallback(
    (id: string | null) => onNavigate(id ? `${PAGE_PATH}?id=${encodeURIComponent(id)}` : PAGE_PATH, { replace: true }),
    [onNavigate],
  );

  return (
    <div className="gg-page">
      <PageHeader
        title="Tournaments"
        description="Run 1v1 or Two-Headed Giant events: add everyone's names, pair random opponents who haven't played yet, and keep score."
        actions={
          !showCreate && all.length > 0 ? (
            <Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>
              New tournament
            </Button>
          ) : undefined
        }
      />

      {list.loading && !list.data ? (
        <SectionCard title="Tournaments">
          <TableSkeleton rows={4} cols={3} />
        </SectionCard>
      ) : list.error && !list.data ? (
        <SectionCard title="Tournaments">
          <ErrorState message={`Could not load tournaments. ${list.error}`} onRetry={list.reload} />
        </SectionCard>
      ) : (
        <>
          {showCreate && (
            <CreateTournamentForm
              canCancel={all.length > 0}
              onCancel={() => setCreating(false)}
              onCreated={(t) => {
                setCreating(false);
                setCreated(t);
                select(t.id);
                list.reload();
                toast.success(`${t.name} is ready. Start round 1 when everyone's seated.`);
              }}
            />
          )}
          {selectedId && !showCreate && (
            <>
              {all.length > 1 && (
                <div className="gg-tourney-picker">
                  <SelectField label="Tournament" value={selectedId} onChange={(e) => select(e.target.value)}>
                    {all.map((t) => (
                      <option key={t.id} value={t.id}>
                        {summaryLabel(t)}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
              <TournamentView
                key={selectedId}
                id={selectedId}
                initial={created?.id === selectedId ? created : null}
                onListChanged={list.reload}
                onDeleted={() => {
                  setCreated(null);
                  select(null);
                  list.reload();
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

type Confirm =
  | { kind: "delete" }
  | { kind: "finish"; pending: number }
  | { kind: "remove"; entrant: TournamentEntrant; opponent: string | null };

function withResult(detail: TournamentDetail, matchId: string, result: ReportableResult): TournamentDetail {
  return {
    ...detail,
    matches: detail.matches.map((m) =>
      m.id === matchId ? { ...m, result, reportedAt: result === "pending" ? null : new Date().toISOString() } : m,
    ),
  };
}

/** Wording for the confirm dialog before deleting, finishing early or dropping someone. */
function describeConfirm(
  confirm: Confirm,
  detail: TournamentDetail,
  hasMatches: (entrantId: string) => boolean,
): { title: string; message: string; confirmLabel: string; tone: "primary" | "danger" } {
  const info = formatInfo(detail.format);
  if (confirm.kind === "delete") {
    return {
      title: "Delete this tournament?",
      message: `${detail.name}, its ${info.nounPlural}, pairings and results are removed for good.`,
      confirmLabel: "Delete tournament",
      tone: "danger",
    };
  }
  if (confirm.kind === "finish") {
    const one = confirm.pending === 1;
    return {
      title: "Finish the tournament?",
      message: `${one ? "One result" : `${confirm.pending} results`} in round ${detail.currentRound} ${one ? "isn't" : "aren't"} in yet and won't count. You can reopen the tournament later.`,
      confirmLabel: "Finish",
      tone: "primary",
    };
  }
  const label = entrantLabel(confirm.entrant);
  if (!hasMatches(confirm.entrant.id)) {
    return {
      title: `Remove ${label}?`,
      message: "They'll be taken out of the tournament.",
      confirmLabel: "Remove",
      tone: "danger",
    };
  }
  return {
    title: `Drop ${label}?`,
    message: `Their results stay in the standings and they won't be paired again.${confirm.opponent ? ` Their match this round goes to ${confirm.opponent}.` : ""} You can bring them back later.`,
    confirmLabel: "Drop",
    tone: "danger",
  };
}

function TournamentView({
  id,
  initial,
  onListChanged,
  onDeleted,
}: {
  id: string;
  initial: TournamentDetail | null;
  onListChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<TournamentDetail | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ entrant: TournamentEntrant; values: string[]; error: string | null } | null>(
    null,
  );
  // Results are saved as they're tapped; the page shows them straight away.
  // Server copies are applied once the last tap in flight comes back, so a
  // slower reply can't flash an older result.
  const inFlight = useRef(0);
  const [reporting, setReporting] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<{ tournament: TournamentDetail }>(`${ENDPOINT}?id=${encodeURIComponent(id)}`);
      if (inFlight.current === 0) setDetail(res.tournament);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load the tournament.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Another device may have recorded results: refresh when this one comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const run = useCallback(
    async (
      key: string,
      body: Record<string, unknown>,
      opts: { success?: string; listChanged?: boolean } = {},
    ): Promise<boolean> => {
      setBusy(key);
      try {
        const res = await adminFetch<{ tournament?: TournamentDetail }>(ENDPOINT, {
          method: "POST",
          body: { ...body, id },
          notify: false,
        });
        if (res.tournament) setDetail(res.tournament);
        if (opts.success) toast.success(opts.success);
        if (opts.listChanged !== false) onListChanged();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
        void load();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [id, load, onListChanged, toast],
  );

  const report = useCallback(
    async (match: TournamentMatch, result: ReportableResult) => {
      inFlight.current += 1;
      setReporting((n) => n + 1);
      setDetail((d) => (d ? withResult(d, match.id, result) : d));
      try {
        const res = await adminFetch<{ tournament: TournamentDetail }>(ENDPOINT, {
          method: "POST",
          body: { action: "report", id, matchId: match.id, result },
          notify: false,
        });
        inFlight.current -= 1;
        if (inFlight.current === 0) setDetail(res.tournament);
      } catch (err) {
        inFlight.current -= 1;
        toast.error(err instanceof Error ? err.message : "Couldn't save that result.");
        void load();
      } finally {
        setReporting((n) => n - 1);
      }
    },
    [id, load, toast],
  );

  const derived = useMemo(() => {
    if (!detail) return null;
    const labels = new Map(detail.entrants.map((e) => [e.id, entrantLabel(e)]));
    const standings = computeStandings(detail.entrants, detail.matches);
    const current = matchesInRound(detail.matches, detail.currentRound);
    const active = activeEntrants(detail);
    const blocker = nextRoundBlocker(detail);
    // Nobody left with a new opponent: the round robin is complete.
    const exhausted =
      !blocker &&
      detail.currentRound > 0 &&
      !hasNewOpponents(
        active.map((e) => e.id),
        detail.matches,
      );
    const pairs = current.filter((m) => m.b != null).length;
    const byes = current.length - pairs;
    const extraByes = Math.max(0, byes - ((pairs * 2 + byes) % 2));
    const pending = current.filter((m) => m.result === "pending").length;
    return { labels, standings, current, active, blocker, exhausted, pairs, byes, extraByes, pending };
  }, [detail]);

  if (!detail || !derived) {
    return loadError ? (
      <SectionCard title="Tournament">
        <ErrorState message={`Could not load the tournament. ${loadError}`} onRetry={() => void load()} />
      </SectionCard>
    ) : (
      <SectionCard title="Tournament">
        <TableSkeleton rows={5} cols={4} />
      </SectionCard>
    );
  }

  const info = formatInfo(detail.format);
  const editable = detail.status === "active";
  const started = detail.currentRound > 0;
  const { labels, standings, current, active, blocker, exhausted, pairs, byes, extraByes, pending } = derived;
  const droppedCount = detail.entrants.length - active.length;
  const leaders = started ? standings.filter((r) => r.rank === 1 && r.points > 0) : [];
  const pairBusy = busy === "pair" || busy === "repair";

  const pairNext = () =>
    run(
      "pair",
      { action: "pair", round: detail.currentRound + 1 },
      { success: `Round ${detail.currentRound + 1} is paired.` },
    );
  const repair = () =>
    run(
      "repair",
      { action: "pair", round: detail.currentRound, replace: true },
      { success: `Round ${detail.currentRound} re-paired.` },
    );
  const finish = () => run("finish", { action: "finish" }, { success: "Tournament finished. Final standings are locked in." });

  function askFinish() {
    if (pending > 0) setConfirm({ kind: "finish", pending });
    else void finish();
  }

  function askRemove(entrant: TournamentEntrant) {
    const open = current.find((m) => m.result === "pending" && m.b != null && (m.a === entrant.id || m.b === entrant.id));
    const opponentId = open ? (open.a === entrant.id ? open.b : open.a) : null;
    setConfirm({ kind: "remove", entrant, opponent: opponentId ? (labels.get(opponentId) ?? null) : null });
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault();
    if (renaming == null) return;
    if (!renaming.trim()) return;
    const ok = await run("rename", { action: "rename", name: renaming.trim() }, { success: "Renamed." });
    if (ok) setRenaming(null);
  }

  async function saveEntrant(e: FormEvent) {
    e.preventDefault();
    if (!editing || !detail) return;
    const players = Array.from({ length: info.teamSize }, (_, i) => cleanPlayerName(editing.values[i] ?? ""));
    const problem = entrantProblem(detail.format, players);
    if (problem) {
      setEditing({ ...editing, error: problem });
      return;
    }
    const ok = await run(
      "edit-entrant",
      { action: "rename-entrant", entrantId: editing.entrant.id, players },
      { success: "Saved.", listChanged: false },
    );
    if (ok) setEditing(null);
  }

  const hasMatches = (entrantId: string) => detail.matches.some((m) => m.a === entrantId || m.b === entrantId);

  async function confirmAction() {
    if (!confirm) return;
    if (confirm.kind === "delete") {
      const ok = await run("delete", { action: "delete" }, { success: "Tournament deleted.", listChanged: false });
      setConfirm(null);
      if (ok) onDeleted();
      return;
    }
    if (confirm.kind === "finish") {
      await finish();
      setConfirm(null);
      return;
    }
    const label = entrantLabel(confirm.entrant);
    const played = hasMatches(confirm.entrant.id);
    await run(
      "remove",
      { action: "remove-entrant", entrantId: confirm.entrant.id },
      { success: played ? `${label} dropped.` : `${label} removed.` },
    );
    setConfirm(null);
  }

  const confirmText = confirm ? describeConfirm(confirm, detail, hasMatches) : null;

  const earlierRounds = Array.from({ length: Math.max(0, detail.currentRound - 1) }, (_, i) => detail.currentRound - 1 - i);

  return (
    <>
      <SectionCard
        title={detail.name}
        className="gg-tourney-headcard"
        action={
          <div className="gg-btn-row gg-tourney-head-actions">
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setRenaming(detail.name)}>
              Rename
            </Button>
            {editable ? (
              <Button size="sm" variant="secondary" icon="check" loading={busy === "finish"} onClick={askFinish}>
                Finish
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "reopen"}
                onClick={() => run("reopen", { action: "reopen" }, { success: "Tournament reopened." })}
              >
                Reopen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              aria-label="Delete tournament"
              title="Delete tournament"
              onClick={() => setConfirm({ kind: "delete" })}
            />
          </div>
        }
      >
        <div className="gg-tourney-meta">
          <Badge tone="purple">{info.label}</Badge>
          <Badge tone={editable ? "success" : "neutral"} dot>
            {editable ? "In progress" : "Finished"}
          </Badge>
          <span>{started ? `Round ${detail.currentRound}` : "Not started"}</span>
          <span>
            · {active.length} {active.length === 1 ? info.noun : info.nounPlural}
            {droppedCount > 0 ? ` (${droppedCount} dropped)` : ""}
          </span>
        </div>
        {!editable && leaders.length > 0 && (
          <div className="gg-tourney-champion">
            <Icon name="trophy" size={18} />
            <span>
              {leaders.length === 1 ? "Winner: " : "Tied for first: "}
              <strong>{leaders.map((r) => entrantLabel(r.entrant)).join(", ")}</strong>
              {leaders.length === 1 && ` (${leaders[0].wins}-${leaders[0].losses}-${leaders[0].draws})`}
            </span>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={started ? `Round ${detail.currentRound}` : "Round 1"}
        action={
          started && pairs > 0 ? (
            <span className="gg-muted" aria-live="polite">
              {pairs - pending} of {pairs} result{pairs === 1 ? "" : "s"} in
            </span>
          ) : undefined
        }
      >
        {!started ? (
          <div className="gg-tourney-start">
            <p>
              {active.length} {active.length === 1 ? info.noun : info.nounPlural} entered. Each round pairs everyone at
              random with someone they haven't played yet{active.length % 2 === 1 ? ", and one gets a bye (a free win)" : ""}.
            </p>
            {blocker && <p className="gg-muted">{blocker}</p>}
            {editable && (
              <Button variant="primary" icon="swap" disabled={Boolean(blocker)} loading={busy === "pair"} onClick={pairNext}>
                Start round 1
              </Button>
            )}
          </div>
        ) : (
          <>
            {extraByes > 0 && (
              <div className="gg-inline-note gg-inline-note--info gg-tourney-note">
                <Icon name="info" size={16} />
                <span>
                  Not everyone had a new opponent left, so {byes} {info.nounPlural} got a bye this round.
                </span>
              </div>
            )}
            <RoundMatches
              matches={current}
              labels={labels}
              editable={editable}
              allowClear
              onReport={(m, r) => void report(m, r)}
            />
            {editable && (
              <div className="gg-tourney-next">
                {exhausted ? (
                  <>
                    <div className="gg-inline-note gg-inline-note--success">
                      <Icon name="checkCircle" size={16} />
                      <span>
                        Everyone still in has played each other, so there are no new pairings left. Finish the tournament
                        to lock in the standings.
                      </span>
                    </div>
                    <Button variant="primary" icon="trophy" loading={busy === "finish"} onClick={askFinish}>
                      Finish tournament
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      icon="swap"
                      disabled={Boolean(blocker) || reporting > 0 || pairBusy}
                      loading={busy === "pair"}
                      onClick={pairNext}
                    >
                      Pair round {detail.currentRound + 1}
                    </Button>
                    {canRepairRound(detail) && (
                      <Button variant="ghost" disabled={pairBusy} loading={busy === "repair"} onClick={repair}>
                        Re-pair round {detail.currentRound}
                      </Button>
                    )}
                    {blocker && <p className="gg-muted">{blocker}</p>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Standings"
        action={
          <span className="gg-muted">
            {started ? `After round ${detail.currentRound}` : `${active.length} ${info.nounPlural}`}
          </span>
        }
      >
        <StandingsTable
          rows={standings}
          format={detail.format}
          labels={labels}
          editable={editable}
          started={started}
          onEdit={(entrant) => setEditing({ entrant, values: [...entrant.players], error: null })}
          onRemove={askRemove}
          onRestore={(entrant) =>
            void run(
              "restore",
              { action: "restore-entrant", entrantId: entrant.id },
              { success: `${entrantLabel(entrant)} is back in from the next round.` },
            )
          }
        />
        {editable && (
          <AddEntrantForm
            format={detail.format}
            started={started}
            onAdd={(players) =>
              run(
                "add",
                { action: "add-entrant", players },
                { success: `${players.join(" & ")} added${started ? " — they're paired from the next round" : ""}.` },
              )
            }
          />
        )}
        <p className="gg-muted gg-tourney-scoring">
          3 points for a win (a bye counts as a win), 1 for a draw. Ties are broken by opponents' match-win %.
        </p>
      </SectionCard>

      {earlierRounds.length > 0 && (
        <SectionCard title="Earlier rounds">
          {earlierRounds.map((round) => {
            const matches = matchesInRound(detail.matches, round);
            const played = matches.filter((m) => m.b != null).length;
            return (
              <details key={round} className="gg-tourney-round">
                <summary>
                  Round {round}
                  <span className="gg-muted">
                    {played} match{played === 1 ? "" : "es"}
                  </span>
                </summary>
                <RoundMatches
                  matches={matches}
                  labels={labels}
                  editable={editable}
                  allowClear={false}
                  onReport={(m, r) => void report(m, r)}
                />
              </details>
            );
          })}
        </SectionCard>
      )}

      {confirmText && (
        <ConfirmDialog
          open
          title={confirmText.title}
          message={confirmText.message}
          confirmLabel={confirmText.confirmLabel}
          tone={confirmText.tone}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}

      <Modal
        open={renaming != null}
        onClose={() => setRenaming(null)}
        title="Rename tournament"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)} disabled={busy === "rename"}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="gg-tourney-rename"
              loading={busy === "rename"}
              disabled={!renaming?.trim()}
            >
              Save
            </Button>
          </>
        }
      >
        <form id="gg-tourney-rename" onSubmit={saveRename}>
          <TextField
            label="Name"
            value={renaming ?? ""}
            maxLength={MAX_TOURNAMENT_NAME}
            autoFocus
            onChange={(e) => setRenaming(e.target.value)}
          />
        </form>
      </Modal>

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={detail.format === "2hg" ? "Edit team" : "Edit player"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy === "edit-entrant"}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="gg-tourney-edit" loading={busy === "edit-entrant"}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <form id="gg-tourney-edit" className="gg-tourney-editfields" onSubmit={saveEntrant} noValidate>
            <EntrantFields
              format={detail.format}
              values={editing.values}
              autoFocus
              onChange={(values) => setEditing({ ...editing, values, error: null })}
            />
            {editing.error && (
              <p className="gg-field__error" role="alert">
                {editing.error}
              </p>
            )}
          </form>
        )}
      </Modal>
    </>
  );
}
