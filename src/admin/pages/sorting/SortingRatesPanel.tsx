import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { TextArea, TextField } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState, ErrorState, TableSkeleton } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { sortingRepository, type OptionInput } from "../../repositories/sorting.supabase";
import type { SortingOptionAdmin } from "../../types";
import { SORTING_PATH, formatRatePerThousand, parseDollarsToCents } from "../../../store/lib/sortingService";

// The advertised collection sorting rates (per 1,000 cards). Customers see the
// shown ones on /collection-sorting; with none shown, the page says requests
// open soon. A request keeps the name and rate it was made with, so changing
// or removing a rate never changes anything already quoted.

interface Draft {
  id: string | null;
  name: string;
  rate: string;
  description: string;
  sortOrder: string;
  active: boolean;
}

const NEW_DRAFT: Draft = { id: null, name: "", rate: "", description: "", sortOrder: "0", active: true };

function draftOf(o: SortingOptionAdmin): Draft {
  return {
    id: o.id,
    name: o.name,
    rate: (o.ratePerThousandCents / 100).toFixed(2),
    description: o.description ?? "",
    sortOrder: String(o.sortOrder),
    active: o.active,
  };
}

export function SortingRatesPanel() {
  const toast = useToast();
  const options = useAsync(() => sortingRepository.listOptions(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SortingOptionAdmin | null>(null);

  async function save() {
    if (!draft) return;
    const cents = parseDollarsToCents(draft.rate);
    if (!draft.name.trim()) return setError("Give the rate a name, like “Sort by set”.");
    if (cents === null || cents <= 0) return setError("Enter the price per 1,000 cards, like 25.00.");
    const order = Number.parseInt(draft.sortOrder || "0", 10);
    if (!Number.isInteger(order) || order < -1000 || order > 1000) return setError("Order must be a whole number.");
    const input: OptionInput = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      ratePerThousandCents: cents,
      sortOrder: order,
      active: draft.active,
    };
    setSaving(true);
    setError(null);
    try {
      if (draft.id) await sortingRepository.updateOption(draft.id, input);
      else await sortingRepository.createOption(input);
      toast.success(draft.id ? "Rate updated." : "Rate added.");
      setDraft(null);
      options.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rate.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(o: SortingOptionAdmin) {
    try {
      await sortingRepository.updateOption(o.id, { active: !o.active });
      toast.success(o.active ? `${o.name} is hidden from customers.` : `${o.name} is shown to customers.`);
      options.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the rate.");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await sortingRepository.deleteOption(deleting.id);
      toast.success("Rate removed.");
      setDeleting(null);
      options.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the rate.");
    }
  }

  const rows = options.data ?? [];
  const shownCount = rows.filter((o) => o.active).length;

  return (
    <div className="gg-sortrates">
      <p className="gg-card-meta">
        Customers see shown rates on <a href={SORTING_PATH} target="_blank" rel="noopener noreferrer">{SORTING_PATH}</a>.
        Rates cover sorting only — return shipping and packaging are quoted per collection. Changing a rate never
        changes requests already made.
      </p>
      {!options.loading && !options.error && shownCount === 0 && (
        <div className="gg-inline-note gg-inline-note--warning">
          <span>
            No rates are shown, so the sorting page says requests open soon and the request form is hidden. Add a rate
            (or show one) to open requests.
          </span>
        </div>
      )}

      {options.loading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : options.error ? (
        <ErrorState message="Could not load the rates." onRetry={options.reload} />
      ) : rows.length === 0 && !draft ? (
        <EmptyState icon="dollar" title="No rates yet" message="Add your first per-1,000-card rate to open sorting requests." />
      ) : (
        <ul className="gg-sortrates__list">
          {rows.map((o) => (
            <li key={o.id} className="gg-sortrates__row">
              <div className="gg-sortrates__info">
                <div className="gg-sortrates__name">
                  <strong>{o.name}</strong>
                  <Badge tone={o.active ? "success" : "neutral"}>{o.active ? "Shown" : "Hidden"}</Badge>
                </div>
                <div className="gg-sortrates__rate">{formatRatePerThousand(o.ratePerThousandCents)}</div>
                {o.description && <div className="gg-card-meta">{o.description}</div>}
              </div>
              <div className="gg-sortrates__actions">
                <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(o))}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void toggle(o)}>
                  {o.active ? "Hide" : "Show"}
                </Button>
                <Button variant="ghost" size="sm" icon="trash" aria-label={`Remove ${o.name}`} onClick={() => setDeleting(o)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="gg-sortrates__form">
          <h3>{draft.id ? "Edit rate" : "Add a rate"}</h3>
          <div className="gg-form-grid">
            <TextField
              label="Name"
              placeholder="e.g. Sort by set"
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label="Price per 1,000 cards ($)"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.rate}
              onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
            />
          </div>
          <TextArea
            label="Description (optional)"
            rows={2}
            maxLength={400}
            placeholder="What this sort includes, shown under the rate."
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="gg-form-grid">
            <TextField
              label="Order"
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
              hint="Lower numbers show first."
            />
            <label className="gg-check-inline gg-sortrates__shown">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Show to customers
            </label>
          </div>
          {error && (
            <p className="gg-sortq__error" role="alert">
              {error}
            </p>
          )}
          <div className="gg-drawer-actions__buttons">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
              {draft.id ? "Save rate" : "Add rate"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="sm" icon="plus" onClick={() => setDraft({ ...NEW_DRAFT })}>
          Add a rate
        </Button>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this rate?"
        message={`Remove “${deleting?.name ?? ""}”? Customers won't see it any more. Requests already made keep their own copy of it. To take it off the site for now, hide it instead.`}
        confirmLabel="Remove rate"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
