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
import { AddEntrantForm, EntrantFields, FfaStandingsTable, StandingsTable } from "../components/tournaments/StandingsTable";
import { PodTables } from "../components/tournaments/PodTables";
import { CommanderPicker, type CommanderOption } from "../components/tournaments/CommanderPicker";
import { PlayerDisplayPanel } from "../components/tournaments/PlayerDisplayPanel";
import { useAsync } from "../hooks/useAsync";
import { useClock } from "../hooks/useClock";
import { useToast } from "../hooks/useToast";
import { ADMIN_BASE } from "../hooks/useRouter";
import { adminFetch } from "../repositories/apiClient";
import {
  MAX_SPOTS,
  MAX_STARTING_LIFE,
  MAX_TABLE_SIZE,
  MAX_TOURNAMENT_NAME,
  MIN_TABLE_SIZE,
  activeEntrants,
  canRepairRound,
  cleanPlayerName,
  computeFfaStandings,
  computeStandings,
  entrantLabel,
  entrantProblem,
  findSeatAt,
  formatInfo,
  matchesInRound,
  hasLiveGames,
  hasNewOpponents,
  isSigningUp,
  minPlayers,
  nextRoundBlocker,
  ordinal,
  playerCount,
  podsInRound,
  soloEntrants,
  spotsProblem,
  startingLifeProblem,
  stillIn,
  tableSizes,
  tableSizeProblem,
  type ReportableResult,
  type TournamentCommander,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentMatch,
  type TournamentSummary,
} from "../utils/tournament";

// Admin → Tournaments: run a 1v1, Two-Headed Giant or free-for-all event at
// the store. Enter everyone's names (or let them sign up), then each round
// pairs every player (or team) at random with someone they haven't played
// yet; tap the winner of each match and the standings keep score.
// Free-for-all instead deals everyone onto tables of up to N players each
// round; players go out from their phones (or staff tap Out) and points go by
// finishing place. Pairing and dealing happen on the server
// (/api/admin/tournaments) so two devices can't start the same round twice.

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
        description="Run 1v1, Two-Headed Giant or big free-for-all games: players scan in to sign up, each round pairs (or deals) new opponents, and the standings keep score."
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
                toast.success(
                  t.spots != null
                    ? `${t.name} is ready. Open the TV display so players can scan in and sign up.`
                    : `${t.name} is ready. Start round 1 when everyone's seated.`,
                );
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

/** "two tables of 4", "one table of 8", "tables of 4, 3 and 3". */
function describeTables(sizes: number[]): string {
  if (sizes.length === 0) return "tables";
  if (sizes.length === 1) return `one table of ${sizes[0]}`;
  if (sizes.every((n) => n === sizes[0])) {
    const words = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    return `${words[sizes.length] ?? sizes.length} tables of ${sizes[0]}`;
  }
  return `tables of ${sizes.slice(0, -1).join(", ")} and ${sizes[sizes.length - 1]}`;
}

/** What a players-per-table number means for the players in now. */
function tableSizeHint(players: number, size: number): string {
  const base = "Used from the next deal; games being played keep their tables.";
  if (players < 2 || tableSizeProblem(size)) return base;
  return `With ${players} players: ${describeTables(tableSizes(players, size))}. ${base}`;
}

type Confirm =
  | { kind: "delete" }
  | { kind: "finish"; pending: number }
  /** note: what happens to the game they're in ("Their match this round goes to Sam."). */
  | { kind: "remove"; entrant: TournamentEntrant; note: string | null };

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
      message:
        detail.format === "ffa"
          ? `${one ? "One game" : `${confirm.pending} games`} in round ${detail.currentRound} ${one ? "isn't" : "aren't"} over yet. Players already out keep their places; anyone still playing gets no points for it. You can reopen the tournament later.`
          : `${one ? "One result" : `${confirm.pending} results`} in round ${detail.currentRound} ${one ? "isn't" : "aren't"} in yet and won't count. You can reopen the tournament later.`,
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
    message: `Their results stay in the standings and they won't be ${detail.format === "ffa" ? "dealt in" : "paired"} again.${confirm.note ? ` ${confirm.note}` : ""} You can bring them back later.`,
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
  const [editingSpots, setEditingSpots] = useState<{ value: string; error: string | null } | null>(null);
  const [editingLife, setEditingLife] = useState<{ value: string; error: string | null } | null>(null);
  const [editingTables, setEditingTables] = useState<{ value: string; error: string | null } | null>(null);
  const [editing, setEditing] = useState<{
    entrant: TournamentEntrant;
    values: string[];
    commanders: (TournamentCommander | null)[];
    error: string | null;
  } | null>(null);
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

  // While games are being played, players change life totals and record
  // losses from their phones: keep this page up to date.
  const liveRound = detail != null && hasLiveGames(detail);
  useEffect(() => {
    if (!liveRound) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && inFlight.current === 0) void load();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [liveRound, load]);
  const now = useClock(liveRound);

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

  const searchCommanders = useCallback(
    (query: string) =>
      adminFetch<{ options: CommanderOption[] }>(ENDPOINT, {
        method: "POST",
        body: { action: "commander-search", query },
        notify: false,
      }).then((r) => r.options),
    [],
  );

  const derived = useMemo(() => {
    if (!detail) return null;
    const labels = new Map(detail.entrants.map((e) => [e.id, entrantLabel(e)]));
    const standings = computeStandings(detail.entrants, detail.matches);
    const ffaStandings = detail.format === "ffa" ? computeFfaStandings(detail.entrants, detail.pods) : [];
    const current = matchesInRound(detail.matches, detail.currentRound);
    const currentPods = podsInRound(detail.pods, detail.currentRound);
    const active = activeEntrants(detail);
    const blocker = nextRoundBlocker(detail);
    // Nobody left with a new opponent: the round robin is complete (free-for-all reshuffles forever).
    const exhausted =
      detail.format !== "ffa" &&
      !blocker &&
      detail.currentRound > 0 &&
      !hasNewOpponents(
        active.map((e) => e.id),
        detail.matches,
      );
    const pairs = current.filter((m) => m.b != null).length;
    const byes = current.length - pairs;
    const extraByes = Math.max(0, byes - ((pairs * 2 + byes) % 2));
    const pending =
      detail.format === "ffa"
        ? currentPods.filter((p) => !p.endedAt).length
        : current.filter((m) => m.result === "pending").length;
    return { labels, standings, ffaStandings, current, currentPods, active, blocker, exhausted, pairs, byes, extraByes, pending };
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
  const { labels, standings, ffaStandings, current, currentPods, active, blocker, exhausted, pairs, byes, extraByes, pending } =
    derived;
  const ffa = detail.format === "ffa";
  const droppedCount = detail.entrants.length - active.length;
  const leaderRows = started ? (ffa ? ffaStandings : standings).filter((r) => r.rank === 1 && r.points > 0) : [];
  const leaders = leaderRows.map((r) => ({
    entrant: r.entrant,
    record: "losses" in r ? `${r.wins}-${r.losses}-${r.draws}` : `${r.points} points`,
  }));
  const pairBusy = busy === "pair" || busy === "repair";
  // Free-for-all words: tables are dealt, not paired.
  const pairWord = ffa ? "dealt" : "paired";
  const podBusy = busy?.startsWith("pod:") ? busy.slice(4) : null;

  const signingUp = isSigningUp(detail);
  const players = playerCount(detail);
  const spotsLeft = signingUp && detail.spots != null ? Math.max(0, detail.spots - players) : 0;
  const solos = soloEntrants(detail);

  const pairNext = () =>
    detail.currentRound === 0
      ? run("pair", { action: "start" }, { success: `Round 1 is ${pairWord}. Good luck, everyone!` })
      : run(
          "pair",
          { action: "pair", round: detail.currentRound + 1 },
          { success: `Round ${detail.currentRound + 1} is ${pairWord}.` },
        );

  async function saveTables(e: FormEvent) {
    e.preventDefault();
    if (!editingTables) return;
    const value = Number(editingTables.value);
    const problem = tableSizeProblem(value);
    if (problem) {
      setEditingTables({ ...editingTables, error: problem });
      return;
    }
    const ok = await run(
      "table-size",
      { action: "table-size", tableSize: value },
      { success: `Tables of up to ${value} from the next deal.`, listChanged: false },
    );
    if (ok) setEditingTables(null);
  }

  /** Free-for-all table changes, saved one table at a time. */
  const podAction = (podId: string, body: Record<string, unknown>, success?: string) =>
    void run(`pod:${podId}`, body, { success, listChanged: false });

  async function saveLife(e: FormEvent) {
    e.preventDefault();
    if (!editingLife) return;
    const value = Number(editingLife.value);
    const problem = startingLifeProblem(value);
    if (problem) {
      setEditingLife({ ...editingLife, error: problem });
      return;
    }
    const ok = await run(
      "starting-life",
      { action: "starting-life", life: value },
      { success: `Games start at ${value} life.`, listChanged: false },
    );
    if (ok) setEditingLife(null);
  }

  async function saveSpots(e: FormEvent) {
    e.preventDefault();
    if (!editingSpots) return;
    const value = Number(editingSpots.value);
    const problem = spotsProblem(detail!.format, value);
    if (problem) {
      setEditingSpots({ ...editingSpots, error: problem });
      return;
    }
    const ok = await run("spots", { action: "spots", spots: value }, { success: `${value} player spots.` });
    if (ok) setEditingSpots(null);
  }
  const repair = () =>
    run(
      "repair",
      { action: "pair", round: detail.currentRound, replace: true },
      { success: `Round ${detail.currentRound} re-${pairWord}.` },
    );
  const finish = () => run("finish", { action: "finish" }, { success: "Tournament finished. Final standings are locked in." });

  function askFinish() {
    if (pending > 0) setConfirm({ kind: "finish", pending });
    else void finish();
  }

  function askRemove(entrant: TournamentEntrant) {
    if (ffa) {
      const seat = findSeatAt(detail!.pods, detail!.currentRound, entrant.id);
      const playing = seat && !seat.pod.endedAt && !seat.player.outAt ? seat : null;
      const left = playing ? stillIn(playing.pod).length : 0;
      setConfirm({
        kind: "remove",
        entrant,
        note: playing
          ? `They're out of their game at table ${playing.pod.table} and finish ${ordinal(left)}${left === 2 ? ", so the other player wins it" : ""}.`
          : null,
      });
      return;
    }
    const open = current.find((m) => m.result === "pending" && m.b != null && (m.a === entrant.id || m.b === entrant.id));
    const opponentId = open ? (open.a === entrant.id ? open.b : open.a) : null;
    const opponent = opponentId ? (labels.get(opponentId) ?? null) : null;
    setConfirm({ kind: "remove", entrant, note: opponent ? `Their match this round goes to ${opponent}.` : null });
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
    const players = Array.from({ length: info.teamSize }, (_, i) => cleanPlayerName(editing.values[i] ?? "")).filter(
      (p, i) => i === 0 || p || !signingUp,
    );
    const problem = entrantProblem(detail.format, players, signingUp);
    if (problem) {
      setEditing({ ...editing, error: problem });
      return;
    }
    const ok = await run(
      "edit-entrant",
      {
        action: "rename-entrant",
        entrantId: editing.entrant.id,
        players,
        commanders: players.map((_, i) => editing.commanders[i] ?? null),
      },
      { success: "Saved.", listChanged: false },
    );
    if (ok) setEditing(null);
  }

  const hasMatches = (entrantId: string) =>
    detail.matches.some((m) => m.a === entrantId || m.b === entrantId) ||
    detail.pods.some((pod) => pod.players.some((p) => p.entrantId === entrantId));

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

  const editEntrant = (entrant: TournamentEntrant) =>
    setEditing({ entrant, values: [...entrant.players], commanders: [...entrant.commanders], error: null });
  const restoreEntrant = (entrant: TournamentEntrant) =>
    void run(
      "restore",
      { action: "restore-entrant", entrantId: entrant.id },
      { success: `${entrantLabel(entrant)} is back in from the next round.` },
    );

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
          <Badge tone={signingUp ? "info" : editable ? "success" : "neutral"} dot>
            {signingUp ? "Signing up" : editable ? "In progress" : "Finished"}
          </Badge>
          <span>{started ? `Round ${detail.currentRound}` : signingUp ? `${players} of ${detail.spots} spots filled` : "Not started"}</span>
          {!signingUp && (
            <span>
              · {active.length} {active.length === 1 ? info.noun : info.nounPlural}
              {droppedCount > 0 ? ` (${droppedCount} dropped)` : ""}
            </span>
          )}
          <span>· Starting life {detail.startingLife}</span>
          {editable && (
            <button
              type="button"
              className="gg-link-btn"
              aria-label="Change starting life"
              onClick={() => setEditingLife({ value: String(detail.startingLife), error: null })}
            >
              Change
            </button>
          )}
          {ffa && detail.tableSize != null && (
            <>
              <span>· Tables of up to {detail.tableSize}</span>
              {editable && (
                <button
                  type="button"
                  className="gg-link-btn"
                  aria-label="Change players per table"
                  onClick={() => setEditingTables({ value: String(detail.tableSize), error: null })}
                >
                  Change
                </button>
              )}
            </>
          )}
        </div>
        {!editable && leaders.length > 0 && (
          <div className="gg-tourney-champion">
            <Icon name="trophy" size={18} />
            <span>
              {leaders.length === 1 ? "Winner: " : "Tied for first: "}
              <strong>{leaders.map((r) => entrantLabel(r.entrant)).join(", ")}</strong>
              {leaders.length === 1 && ` (${leaders[0].record})`}
            </span>
          </div>
        )}
      </SectionCard>

      {detail.share && (
        <PlayerDisplayPanel
          share={detail.share}
          signingUp={signingUp}
          busy={busy === "share"}
          onChange={(change) =>
            run(
              "share",
              { action: "share", ...change },
              {
                success: change.rotate
                  ? "New link made. Open the TV display again with it."
                  : change.enabled
                    ? "Player display link is on."
                    : "Player display link is off.",
                listChanged: false,
              },
            )
          }
        />
      )}

      {signingUp && detail.spots != null ? (
        <SectionCard
          title="Sign-ups"
          action={
            <span className="gg-muted" aria-live="polite">
              {players} of {detail.spots} spots filled
            </span>
          }
        >
          <div className="gg-tourney-signup">
            <div
              className="gg-tourney-signup__bar"
              role="progressbar"
              aria-label="Spots filled"
              aria-valuemin={0}
              aria-valuemax={detail.spots}
              aria-valuenow={players}
            >
              <span style={{ width: `${Math.min(100, (players / detail.spots) * 100)}%` }} />
            </div>
            <p>
              {spotsLeft > 0
                ? `Waiting for ${spotsLeft} more ${spotsLeft === 1 ? "player" : "players"}. Round 1 starts on its own when the last spot fills.`
                : "Every spot is filled."}
            </p>
            {solos.length > 0 && (
              <p className="gg-muted">
                {solos.length === 1 ? "1 player is" : `${solos.length} players are`} waiting for a teammate. Anyone still
                alone gets a random teammate when round 1 starts.
              </p>
            )}
            {editable && (
              <div className="gg-btn-row">
                <Button
                  variant="primary"
                  icon="swap"
                  disabled={Boolean(blocker)}
                  loading={busy === "pair"}
                  onClick={pairNext}
                >
                  {spotsLeft > 0 ? `Start now with ${players}` : "Start round 1"}
                </Button>
                <Button variant="ghost" onClick={() => setEditingSpots({ value: String(detail.spots), error: null })}>
                  Change spots
                </Button>
              </div>
            )}
            {blocker && players > 0 && <p className="gg-muted">{blocker}</p>}
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title={started ? `Round ${detail.currentRound}` : "Round 1"}
          action={
            started && ffa && currentPods.length > 0 ? (
              <span className="gg-muted" aria-live="polite">
                {currentPods.length - pending} of {currentPods.length} game{currentPods.length === 1 ? "" : "s"} over
              </span>
            ) : started && pairs > 0 ? (
              <span className="gg-muted" aria-live="polite">
                {pairs - pending} of {pairs} result{pairs === 1 ? "" : "s"} in
              </span>
            ) : undefined
          }
        >
          {!started ? (
            <div className="gg-tourney-start">
              {ffa ? (
                <p>
                  {active.length} {active.length === 1 ? "player" : "players"} entered.{" "}
                  {active.length >= minPlayers("ffa")
                    ? `Round 1 deals them onto ${describeTables(tableSizes(active.length, detail.tableSize ?? active.length))}. `
                    : ""}
                  Each round reshuffles the tables so people sit with someone new.
                </p>
              ) : (
                <p>
                  {active.length} {active.length === 1 ? info.noun : info.nounPlural} entered. Each round pairs everyone at
                  random with someone they haven't played yet{active.length % 2 === 1 ? ", and one gets a bye (a free win)" : ""}.
                </p>
              )}
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
              {ffa ? (
                <PodTables
                  pods={currentPods}
                  labels={labels}
                  editable={editable}
                  startingLife={detail.startingLife}
                  now={now}
                  busy={podBusy}
                  onOut={(pod, p) => podAction(pod.id, { action: "knock-out", podPlayerId: p.id })}
                  onWinner={(pod, entrantId) =>
                    podAction(
                      pod.id,
                      { action: "pod-winner", podId: pod.id, entrantId },
                      `${labels.get(entrantId) ?? "They"} won${currentPods.length > 1 ? ` at table ${pod.table}` : ""}.`,
                    )
                  }
                  onUndo={(pod) => podAction(pod.id, { action: "pod-undo", podId: pod.id })}
                />
              ) : (
                <RoundMatches
                  matches={current}
                  labels={labels}
                  editable={editable}
                  allowClear
                  onReport={(m, r) => void report(m, r)}
                  startingLife={detail.startingLife}
                  now={now}
                />
              )}
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
                        disabled={Boolean(blocker) || reporting > 0 || pairBusy || podBusy != null}
                        loading={busy === "pair"}
                        onClick={pairNext}
                      >
                        {ffa ? "Deal" : "Pair"} round {detail.currentRound + 1}
                      </Button>
                      {canRepairRound(detail) && (
                        <Button variant="ghost" disabled={pairBusy} loading={busy === "repair"} onClick={repair}>
                          Re-{ffa ? "deal" : "pair"} round {detail.currentRound}
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
      )}

      <SectionCard
        title={signingUp ? "Signed up" : "Standings"}
        action={
          <span className="gg-muted">
            {started ? `After round ${detail.currentRound}` : `${active.length} ${info.nounPlural}`}
          </span>
        }
      >
        {ffa ? (
          <FfaStandingsTable
            rows={ffaStandings}
            editable={editable}
            started={started}
            onEdit={editEntrant}
            onRemove={askRemove}
            onRestore={restoreEntrant}
          />
        ) : (
          <StandingsTable
            rows={standings}
            format={detail.format}
            labels={labels}
            editable={editable}
            started={started}
            onEdit={editEntrant}
            onRemove={askRemove}
            onRestore={restoreEntrant}
          />
        )}
        {editable && (
          <AddEntrantForm
            format={detail.format}
            started={started}
            allowSolo={signingUp}
            onAdd={(players) =>
              run(
                "add",
                { action: "add-entrant", players },
                { success: `${players.join(" & ")} added${started ? ` — they're ${pairWord} in from the next round` : ""}.` },
              )
            }
          />
        )}
        <p className="gg-muted gg-tourney-scoring">
          {ffa
            ? "Points by finishing place: at a table of 8, the last one standing gets 8 points, 2nd gets 7, down to 1 for the first one out. Ties are broken by games won."
            : "3 points for a win (a bye counts as a win), 1 for a draw. Ties are broken by opponents' match-win %."}
        </p>
      </SectionCard>

      {earlierRounds.length > 0 && (
        <SectionCard title="Earlier rounds">
          {earlierRounds.map((round) => {
            if (ffa) {
              const pods = podsInRound(detail.pods, round);
              return (
                <details key={round} className="gg-tourney-round">
                  <summary>
                    Round {round}
                    <span className="gg-muted">
                      {pods.length} table{pods.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <PodTables
                    pods={pods}
                    labels={labels}
                    editable={false}
                    startingLife={detail.startingLife}
                    now={now}
                    busy={null}
                    onOut={() => undefined}
                    onWinner={() => undefined}
                    onUndo={() => undefined}
                  />
                </details>
              );
            }
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
                  startingLife={detail.startingLife}
                  now={now}
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
        open={editingLife != null}
        onClose={() => setEditingLife(null)}
        title="Starting life"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingLife(null)} disabled={busy === "starting-life"}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="gg-tourney-life" loading={busy === "starting-life"}>
              Save
            </Button>
          </>
        }
      >
        {editingLife && (
          <form id="gg-tourney-life" onSubmit={saveLife} noValidate>
            <TextField
              label="Starting life"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_STARTING_LIFE}
              value={editingLife.value}
              autoFocus
              error={editingLife.error ?? undefined}
              hint={
                detail.format === "2hg"
                  ? "Per team. Games already being played keep the life they've tracked."
                  : "Games already being played keep the life they've tracked."
              }
              onChange={(e) => setEditingLife({ value: e.target.value, error: null })}
            />
          </form>
        )}
      </Modal>

      <Modal
        open={editingTables != null}
        onClose={() => setEditingTables(null)}
        title="Players per table"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingTables(null)} disabled={busy === "table-size"}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="gg-tourney-tables" loading={busy === "table-size"}>
              Save
            </Button>
          </>
        }
      >
        {editingTables && (
          <form id="gg-tourney-tables" onSubmit={saveTables} noValidate>
            <TextField
              label="Most players per table"
              type="number"
              inputMode="numeric"
              min={MIN_TABLE_SIZE}
              max={MAX_TABLE_SIZE}
              value={editingTables.value}
              autoFocus
              error={editingTables.error ?? undefined}
              hint={tableSizeHint(active.length, Number(editingTables.value))}
              onChange={(e) => setEditingTables({ value: e.target.value, error: null })}
            />
          </form>
        )}
      </Modal>

      <Modal
        open={editingSpots != null}
        onClose={() => setEditingSpots(null)}
        title="Change player spots"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingSpots(null)} disabled={busy === "spots"}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="gg-tourney-spots" loading={busy === "spots"}>
              Save
            </Button>
          </>
        }
      >
        {editingSpots && (
          <form id="gg-tourney-spots" onSubmit={saveSpots} noValidate>
            <TextField
              label="Player spots"
              type="number"
              inputMode="numeric"
              min={Math.max(players, minPlayers(detail.format))}
              max={MAX_SPOTS}
              step={detail.format === "2hg" ? 2 : 1}
              value={editingSpots.value}
              autoFocus
              error={editingSpots.error ?? undefined}
              hint={`${players} signed up so far. If the spots match who has signed up, round 1 starts right away.`}
              onChange={(e) => setEditingSpots({ value: e.target.value, error: null })}
            />
          </form>
        )}
      </Modal>

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
              allowSolo={signingUp}
              autoFocus
              onChange={(values) => setEditing({ ...editing, values, error: null })}
            />
            {editing.values.map((_, seat) => (
              <CommanderPicker
                key={`cmd-${seat}`}
                label={
                  info.teamSize === 2
                    ? `${editing.values[seat]?.trim() || `Player ${seat + 1}`}'s commander (optional)`
                    : "Commander (optional)"
                }
                value={editing.commanders[seat] ?? null}
                onChange={(commander) => {
                  const commanders = [...editing.commanders];
                  commanders[seat] = commander;
                  setEditing({ ...editing, commanders });
                }}
                search={searchCommanders}
              />
            ))}
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
