import { useMemo, useState, type FormEvent } from "react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextArea, TextField } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { adminFetch } from "../../repositories/apiClient";
import {
  MAX_ENTRANTS,
  MAX_SPOTS,
  MAX_TOURNAMENT_NAME,
  TOURNAMENT_FORMATS,
  duplicateName,
  entrantLabel,
  formatInfo,
  parsePlayerList,
  parseTeamList,
  randomTeams,
  spotsProblem,
  type TournamentDetail,
  type TournamentFormat,
} from "../../utils/tournament";

// New tournament: a name, 1v1 or Two-Headed Giant, and how players get in:
//   • Sign-ups (default): set the number of player spots. Players scan the QR
//     code on the player display and enter their name and commander; round 1
//     starts on its own when the last spot fills.
//   • Typed names: enter everyone now. Two-Headed Giant teams are typed as
//     pairs ("Alex & Sam") or made at random, with a Shuffle button.

type TeamMode = "random" | "set";
type JoinMode = "signup" | "names";

const DEFAULT_SPOTS = 8;

/** Small seeded generator so the random teams preview holds still between renders. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function defaultName(format: TournamentFormat, now = new Date()): string {
  const day = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${formatInfo(format).label} · ${day}`;
}

export function CreateTournamentForm({
  canCancel,
  onCancel,
  onCreated,
}: {
  canCancel: boolean;
  onCancel: () => void;
  onCreated: (tournament: TournamentDetail) => void;
}) {
  const [format, setFormat] = useState<TournamentFormat>("1v1");
  const [name, setName] = useState(() => defaultName("1v1"));
  const [nameEdited, setNameEdited] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>("signup");
  const [spots, setSpots] = useState(String(DEFAULT_SPOTS));
  const [teamMode, setTeamMode] = useState<TeamMode>("random");
  const [text, setText] = useState("");
  const [seed, setSeed] = useState(newSeed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const info = formatInfo(format);

  // What will be entered, and anything stopping it.
  const plan = useMemo((): { entrants: string[][]; problem: string | null } => {
    if (format === "1v1") {
      const entrants = parsePlayerList(text).map((n) => [n]);
      return { entrants, problem: null };
    }
    if (teamMode === "random") {
      const names = parsePlayerList(text);
      const entrants = randomTeams(names, seeded(seed));
      return {
        entrants,
        problem: names.length % 2 === 1 ? "Two-Headed Giant needs an even number of players. Add one more name." : null,
      };
    }
    const { teams, problems } = parseTeamList(text);
    return {
      entrants: teams,
      problem:
        problems.length > 0
          ? `Each line needs two names, like "Alex & Sam". Check: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "…" : ""}`
          : null,
    };
  }, [format, teamMode, text, seed]);

  function pickFormat(next: TournamentFormat) {
    setFormat(next);
    setError(null);
    if (!nameEdited) setName(defaultName(next));
  }

  function validate(): string | null {
    if (!name.trim()) return "Give the tournament a name.";
    if (joinMode === "signup") return spotsProblem(format, Number(spots));
    if (plan.problem) return plan.problem;
    if (plan.entrants.length < 2) return `Add at least two ${info.nounPlural}.`;
    if (plan.entrants.length > MAX_ENTRANTS) return `A tournament can have up to ${MAX_ENTRANTS} ${info.nounPlural}.`;
    const dup = duplicateName(plan.entrants);
    if (dup) return `${dup} is entered more than once.`;
    const sameTeam = plan.entrants.find((e) => e.length === 2 && e[0].toLowerCase() === e[1].toLowerCase());
    if (sameTeam) return `${sameTeam[0]} can't be on a team with themselves.`;
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const res = await adminFetch<{ id: string; tournament: TournamentDetail }>("/api/admin/tournaments", {
        method: "POST",
        body:
          joinMode === "signup"
            ? { action: "create", name: name.trim(), format, entrants: [], spots: Number(spots) }
            : { action: "create", name: name.trim(), format, entrants: plan.entrants },
      });
      onCreated(res.tournament);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the tournament.");
    } finally {
      setBusy(false);
    }
  }

  const listLabel = format === "2hg" && teamMode === "set" ? "Teams" : "Players";
  const listHint =
    format === "1v1"
      ? "One name per line."
      : teamMode === "random"
        ? "One name per line. They're paired into random teams of two."
        : "One team per line, like: Alex & Sam";
  const placeholder =
    format === "2hg" && teamMode === "set" ? "Alex & Sam\nJordan & Casey" : "Alex\nSam\nJordan\nCasey";

  return (
    <SectionCard title="New tournament">
      <form className="gg-tourney-create" onSubmit={submit} noValidate>
        <TextField
          label="Name"
          value={name}
          maxLength={MAX_TOURNAMENT_NAME}
          required
          onChange={(e) => {
            setName(e.target.value);
            setNameEdited(true);
          }}
        />

        <div className="gg-field">
          <span className="gg-field__label" id="tourney-format-label">
            Format
          </span>
          <div className="gg-tourney-formats" role="radiogroup" aria-labelledby="tourney-format-label">
            {TOURNAMENT_FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={format === f.value}
                className={`gg-tourney-format ${format === f.value ? "is-selected" : ""}`}
                onClick={() => pickFormat(f.value)}
              >
                <strong>{f.label}</strong>
                <span>{f.teamSize === 1 ? "One player against one player" : "Teams of two share a life total"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="gg-field">
          <span className="gg-field__label" id="tourney-join-label">
            How do players get in?
          </span>
          <div className="gg-tourney-formats" role="radiogroup" aria-labelledby="tourney-join-label">
            {(
              [
                ["signup", "Players sign up", "They scan the QR code and enter their name and commander"],
                ["names", "I'll enter names", "Type everyone in now"],
              ] as const
            ).map(([mode, label, hint]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={joinMode === mode}
                className={`gg-tourney-format ${joinMode === mode ? "is-selected" : ""}`}
                onClick={() => {
                  setJoinMode(mode);
                  setError(null);
                }}
              >
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </div>

        {joinMode === "signup" && (
          <TextField
            label="Player spots"
            type="number"
            inputMode="numeric"
            min={format === "2hg" ? 4 : 2}
            max={MAX_SPOTS}
            step={format === "2hg" ? 2 : 1}
            value={spots}
            hint={
              format === "2hg"
                ? "Players, not teams: an even number. Friends can team up when they sign up; everyone else gets a random teammate. Round 1 starts when every spot is filled."
                : "Round 1 starts on its own when every spot is filled. You can also start early."
            }
            onChange={(e) => {
              setSpots(e.target.value);
              setError(null);
            }}
          />
        )}

        {joinMode === "names" && format === "2hg" && (
          <div className="gg-field">
            <span className="gg-field__label" id="tourney-teams-label">
              Team setup
            </span>
            <div className="gg-tabs" role="radiogroup" aria-labelledby="tourney-teams-label">
              {(
                [
                  ["random", "Random teams"],
                  ["set", "I'll set the teams"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={teamMode === mode}
                  className={`gg-tab ${teamMode === mode ? "gg-tab--active" : ""}`}
                  onClick={() => {
                    setTeamMode(mode);
                    setError(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {joinMode === "names" && (
          <TextArea
            label={listLabel}
            hint={listHint}
            value={text}
            rows={8}
            placeholder={placeholder}
            autoCapitalize="words"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
        )}

        {joinMode === "names" && plan.entrants.length > 0 && (
          <div className="gg-tourney-preview" aria-live="polite">
            <div className="gg-tourney-preview__head">
              <strong>
                {plan.entrants.length} {plan.entrants.length === 1 ? info.noun : info.nounPlural}
              </strong>
              {format === "2hg" && teamMode === "random" && plan.entrants.length > 1 && (
                <Button type="button" size="sm" variant="ghost" icon="swap" onClick={() => setSeed(newSeed())}>
                  Shuffle teams
                </Button>
              )}
            </div>
            {format === "2hg" && (
              <ul className="gg-tourney-preview__teams">
                {plan.entrants.map((team) => (
                  <li key={team.join("|")}>{entrantLabel({ players: team })}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="gg-inline-note gg-inline-note--warning" role="alert">
            <Icon name="warning" size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="gg-btn-row">
          <Button type="submit" variant="primary" icon="trophy" loading={busy}>
            Create tournament
          </Button>
          {canCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
