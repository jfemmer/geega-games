import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { SelectField, TextArea, TextField } from "../components/ui/Field";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { TableSkeleton, ErrorState } from "../components/ui/States";
import { CubeChecklistView } from "../components/cube/CubeChecklistView";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { adminFetch } from "../repositories/apiClient";
import {
  CUBE_CHECKLIST_PATH,
  RARITY_RULE_LABELS,
  defaultRarityRule,
  type ChecklistAdminSummary,
  type RarityRule,
  type SuggestionListSummary,
} from "../../store/lib/cubeChecklist";
import { timeAgo } from "../utils/format";
import type { CubeChecklistCaller } from "../../store/lib/cubeChecklistApi";

// TEMPORARY — Cube Checklist (staff side).
//
// A shared working copy of a CubeCobra cube that staff and friends work
// through together: mark cards found, swap cards for better options (commons
// only for a pauper cube), look up printings. Friends use the secret share
// link (/cube-checklist?t=…, no login); staff use this page. Everything is
// stored in cube_checklists / cube_checklist_cards via
// /api/admin/cube-checklists and /api/cube-checklist.

const ENDPOINT = "/api/admin/cube-checklists";
const DEFAULT_CUBE = "thepaupercube";
/** Where the first, browser-only version of this page kept its ticks. */
const legacyKey = (cubeId: string) => `gg-cube-checklist:${cubeId}`;

function readLegacy(cubeId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(legacyKey(cubeId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function clearLegacy(cubeId: string): void {
  try {
    window.localStorage.removeItem(legacyKey(cubeId));
  } catch {
    /* ignore */
  }
}

function shareUrl(token: string): string {
  return `${window.location.origin}${CUBE_CHECKLIST_PATH}?t=${encodeURIComponent(token)}`;
}

export function CubeChecklistPage() {
  const toast = useToast();
  const lists = useAsync(
    () => adminFetch<{ checklists: ChecklistAdminSummary[] }>(ENDPOINT).then((r) => r.checklists),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const all = lists.data ?? [];
  const selected = all.find((l) => l.id === selectedId) ?? all[0] ?? null;
  const showCreate = creating || (lists.data != null && all.length === 0);

  return (
    <div className="gg-page">
      <PageHeader
        title="Cube Checklist"
        description="Work through a cube with friends: mark cards found, swap in better options, and check printings."
        actions={
          !showCreate && all.length > 0 ? (
            <Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>
              New checklist
            </Button>
          ) : undefined
        }
      />

      {lists.loading && !lists.data ? (
        <SectionCard title="Checklists">
          <TableSkeleton rows={4} cols={3} />
        </SectionCard>
      ) : lists.error ? (
        <SectionCard title="Checklists">
          <ErrorState message={`Could not load checklists. ${lists.error}`} onRetry={lists.reload} />
        </SectionCard>
      ) : (
        <>
          {showCreate && (
            <CreateChecklist
              canCancel={all.length > 0}
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setSelectedId(id);
                lists.reload();
                toast.success("Checklist created. Copy the share link to invite friends.");
              }}
            />
          )}
          {selected && !showCreate && (
            <>
              {all.length > 1 && (
                <div className="gg-cubecheck__picker">
                  <SelectField
                    label="Checklist"
                    value={selected.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {all.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.foundCount}/{l.cardCount} found)
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
              <SharePanel
                key={`share:${selected.id}`}
                list={selected}
                onChanged={lists.reload}
                onDeleted={() => {
                  setSelectedId(null);
                  lists.reload();
                }}
              />
              <SelectedChecklist key={selected.id} list={selected} />
              <SuggestionListEditor key={`suggestions:${selected.id}`} list={selected} onChanged={lists.reload} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SelectedChecklist({ list }: { list: ChecklistAdminSummary }) {
  const toast = useToast();
  const [legacy, setLegacy] = useState<string[]>(() => readLegacy(list.cubeId));
  const [importing, setImporting] = useState(false);
  // Bumped after an import so the view reloads with the new ticks.
  const [viewKey, setViewKey] = useState(0);

  const call = useMemo<CubeChecklistCaller>(
    () =>
      <T,>(body: Record<string, unknown>) =>
        adminFetch<T>(ENDPOINT, {
          method: "POST",
          body: { ...body, id: list.id },
          notify: body.action !== "get" && body.action !== "printings" && body.action !== "suggest" && body.action !== "search",
        }),
    [list.id],
  );

  async function importLegacy() {
    setImporting(true);
    try {
      const { marked } = await adminFetch<{ marked: number }>(ENDPOINT, {
        method: "POST",
        body: { action: "import-found", id: list.id, names: legacy },
      });
      clearLegacy(list.cubeId);
      setLegacy([]);
      setViewKey((n) => n + 1);
      toast.success(`Marked ${marked} card${marked === 1 ? "" : "s"} found.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add them.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      {legacy.length > 0 && (
        <div className="gg-cubecheck__banner" role="status">
          <span>
            You crossed off {legacy.length} card{legacy.length === 1 ? "" : "s"} in this browser before the list
            was shared. Add them to the shared list as found?
          </span>
          <span className="gg-cubecheck__banneractions">
            <Button size="sm" variant="primary" loading={importing} onClick={() => void importLegacy()}>
              Add them
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearLegacy(list.cubeId);
                setLegacy([]);
              }}
            >
              Dismiss
            </Button>
          </span>
        </div>
      )}
      <CubeChecklistView key={viewKey} call={call} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function SharePanel({
  list,
  onChanged,
  onDeleted,
}: {
  list: ChecklistAdminSummary;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const url = shareUrl(list.shareToken);

  const post = useCallback(
    async (body: Record<string, unknown>, done: string) => {
      setBusy(true);
      try {
        await adminFetch(ENDPOINT, { method: "POST", body: { ...body, id: list.id } });
        toast.success(done);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [list.id, toast],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
    } catch {
      toast.info("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: list.name, url });
        return;
      } catch {
        /* cancelled — fall back to copy */
      }
    }
    await copy();
  }

  return (
    <SectionCard
      title={list.name}
      action={
        <span className="gg-cubecheck__badges">
          <Badge tone="neutral">CubeCobra: {list.cubeId}</Badge>
          <Badge tone="info">Swaps: {RARITY_RULE_LABELS[list.rarityRule]}</Badge>
        </span>
      }
    >
      <div className="gg-cubecheck__share">
        <label className="gg-field__label" htmlFor="gg-cube-share-url">
          Share link — anyone with it can mark cards found and swap cards, no login needed
        </label>
        <div className="gg-cubecheck__shareurl">
          <input
            id="gg-cube-share-url"
            className="gg-input"
            readOnly
            value={list.shareEnabled ? url : "Link is off"}
            onFocus={(e) => e.currentTarget.select()}
            disabled={!list.shareEnabled}
          />
          {list.shareEnabled && (
            <Button variant="primary" icon="copy" onClick={() => void share()}>
              Share
            </Button>
          )}
        </div>
        <div className="gg-cubecheck__shareactions">
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              if (await post({ action: "update", shareEnabled: !list.shareEnabled }, list.shareEnabled ? "Link turned off." : "Link turned on.")) onChanged();
            }}
          >
            {list.shareEnabled ? "Turn link off" : "Turn link on"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("rotate")}>
            Replace link
          </Button>
          {list.shareEnabled && (
            <a className="gg-btn gg-btn--ghost gg-btn--sm" href={url} target="_blank" rel="noreferrer">
              Open as a friend sees it
            </a>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("delete")}>
            Delete checklist
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "rotate"}
        title="Replace the share link?"
        message="The current link stops working right away. You'll need to send everyone the new one."
        confirmLabel="Replace link"
        onConfirm={async () => {
          if (await post({ action: "update", rotateToken: true }, "New link ready. Send it to everyone.")) onChanged();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete “${list.name}”?`}
        message="This removes the checklist, everything marked found, and all swaps, for everyone. It can't be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (await post({ action: "delete" }, "Checklist deleted.")) onDeleted();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */

function CreateChecklist({
  canCancel,
  onCancel,
  onCreated,
}: {
  canCancel: boolean;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [cubeId, setCubeId] = useState(DEFAULT_CUBE);
  const [name, setName] = useState("");
  const [rule, setRule] = useState<RarityRule>(defaultRarityRule(DEFAULT_CUBE));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accept a pasted CubeCobra link as well as the bare id.
  const cleanId = cubeId.trim().replace(/^https?:\/\/(www\.)?cubecobra\.com\/cube\/[a-z]+\//i, "").replace(/[/?#].*$/, "");
  const pauper = defaultRarityRule(cleanId) === "common";

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { checklist } = await adminFetch<{ checklist: { id: string } }>(ENDPOINT, {
        method: "POST",
        body: { action: "create", cubeId: cleanId, name: name.trim() || undefined, rarityRule: pauper ? "common" : rule },
      });
      onCreated(checklist.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the checklist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="New shared checklist">
      <form
        className="gg-cubecheck__create"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <TextField
          label="CubeCobra cube"
          hint="The cube id or link, e.g. thepaupercube. Its card list is copied in once."
          value={cubeId}
          onChange={(e) => setCubeId(e.target.value)}
          required
        />
        <TextField
          label="Name (optional)"
          hint="Defaults to the cube's name on CubeCobra."
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <SelectField
          label="Swaps may bring in"
          value={pauper ? "common" : rule}
          onChange={(e) => setRule(e.target.value as RarityRule)}
          disabled={pauper}
          hint={pauper ? "Pauper cubes are commons only." : undefined}
        >
          <option value="common">{RARITY_RULE_LABELS.common}</option>
          <option value="common_uncommon">{RARITY_RULE_LABELS.common_uncommon}</option>
        </SelectField>
        {error && (
          <p className="gg-field__error" role="alert">
            {error}
          </p>
        )}
        <div className="gg-cubecheck__shareactions">
          <Button type="submit" variant="primary" loading={busy} disabled={!cleanId}>
            Create checklist
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

/* ------------------------------------------------------------------ */

/**
 * The suggestion list: cards staff want suggested as swaps, best first.
 * Suggested upgrades pair them with the cube's lowest-rated cards, and they
 * come first in each card's Better options.
 */
function SuggestionListEditor({ list, onChanged }: { list: ChecklistAdminSummary; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [summary, setSummary] = useState<SuggestionListSummary | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "ratings" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const r = await adminFetch<{ names: string[]; summary: SuggestionListSummary }>(ENDPOINT, {
        method: "POST",
        body: { action: "suggestions-get", id: list.id },
        notify: false,
      });
      setText(r.names.join("\n"));
      setSummary(r.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the suggestion list.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const r = await adminFetch<{ summary: SuggestionListSummary }>(ENDPOINT, {
        method: "POST",
        body: { action: "suggestions-set", id: list.id, names: text ?? "" },
      });
      setSummary(r.summary);
      toast.success(`Saved ${r.summary.saved} cards. ${r.summary.usable} can be suggested.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the suggestion list.");
    } finally {
      setBusy(null);
    }
  }

  async function refreshRatings() {
    setBusy("ratings");
    try {
      await adminFetch(ENDPOINT, { method: "POST", body: { action: "refresh-ratings", id: list.id } });
      toast.success("Ratings updated from CubeCobra.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't get ratings from CubeCobra.");
    } finally {
      setBusy(null);
    }
  }

  const count = text == null ? 0 : text.split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <SectionCard
      title="Suggestion list"
      action={
        <Button
          size="sm"
          variant="ghost"
          iconRight={open ? "chevronDown" : "chevronRight"}
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && text == null) void load();
          }}
        >
          {open ? "Hide" : "Edit"}
        </Button>
      }
    >
      <p className="gg-card-meta">
        Cards you'd like suggested as swaps, best first. They show up as <strong>Suggested upgrades</strong> for the
        cube's lowest-rated cards, and first in each card's Better options. Only cards that aren't on the list and
        fit the rarity rule ({RARITY_RULE_LABELS[list.rarityRule].toLowerCase()}) are suggested.{" "}
        Ratings from CubeCobra {list.ratingsUpdatedAt ? `updated ${timeAgo(list.ratingsUpdatedAt)}` : "not fetched yet"}
        {" · "}
        <button
          type="button"
          className="gg-cubecheck__link"
          disabled={busy === "ratings"}
          onClick={() => void refreshRatings()}
        >
          {busy === "ratings" ? "Updating…" : "Update now"}
        </button>
      </p>
      {open && (
        <div className="gg-cubecheck__create gg-cubecheck__suggestions">
          {text == null ? (
            busy === "load" ? (
              <TableSkeleton rows={3} cols={1} />
            ) : (
              error && <ErrorState message={error} onRetry={() => void load()} />
            )
          ) : (
            <>
              <TextArea
                label={`Card names, one per line (${count})`}
                hint="Paste a list in order of priority. Counts like “1x” and lines starting with # are ignored."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                spellCheck={false}
              />
              {error && (
                <p className="gg-field__error" role="alert">
                  {error}
                </p>
              )}
              <div className="gg-cubecheck__shareactions">
                <Button variant="primary" loading={busy === "save"} onClick={() => void save()}>
                  Save list
                </Button>
              </div>
            </>
          )}
          {summary && (
            <div className="gg-cubecheck__summary" role="status">
              <p>
                <strong>{summary.usable}</strong> of {summary.saved} can be suggested.{" "}
                {summary.alreadyOnList > 0 && <>{summary.alreadyOnList} are already on the list. </>}
              </p>
              {summary.notAllowed.length > 0 && (
                <p>
                  Never printed {list.rarityRule === "common" ? "at common" : "at common or uncommon"} in paper (
                  {summary.notAllowed.length}): {summary.notAllowed.join(", ")}
                </p>
              )}
              {summary.notFound.length > 0 && (
                <p>
                  Not found on Scryfall — check the spelling ({summary.notFound.length}): {summary.notFound.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
