import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { TextArea, TextField } from "../../components/ui/Field";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { AgreementText } from "../../../store/components/consignment/AgreementText";
import { useEstimatorConfig, type EstimatorConfig } from "../../../store/lib/consignmentApi";
import { TEMPLATE_TOKENS, publishProblems, renderAgreement, type AgreementTerms } from "../../../store/lib/consignmentAgreement";
import { consignmentAdminApi, type AgreementVersion } from "./consignmentAdminApi";

// Admin > Consignments > Agreement. The agreement's text is versioned: one
// draft can be edited at a time; publishing makes it the version new
// invitations use and retires the previous one. Published text never
// changes, and every agreement already sent or signed keeps its own frozen
// copy. Publishing is refused while bracketed blanks or attorney notes remain.
// Only the owner can save or publish (the API enforces it).

function previewTerms(config: EstimatorConfig): AgreementTerms {
  return {
    capturedAt: new Date().toISOString(),
    channels: config.channels,
    commissionTiers: [...config.commissionTiers],
    insurance: { service: config.insuranceService, includedCoverageCents: config.insurance.includedCoverageCents, effectiveFrom: config.effectiveFrom.insurance },
    minCardValueCents: 0,
    initialTermDays: config.initialTermDays,
    inspectionDays: config.inspectionDays,
    payoutMethods: ["paypal", "venmo", "zelle", "check"],
    supportEmail: "support@geega-games.com",
  };
}

export function AgreementVersionsPanel() {
  const toast = useToast();
  const config = useEstimatorConfig();
  const [versions, setVersions] = useState<AgreementVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; title: string; bodyMd: string; changeSummary: string } | null>(null);
  const [preview, setPreview] = useState(false);

  async function load() {
    setError(null);
    try {
      setVersions(await consignmentAdminApi.versions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the agreement.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const draft = versions?.find((v) => v.status === "draft") ?? null;
  const published = versions?.find((v) => v.status === "published") ?? null;
  const liveProblems = useMemo(() => (editing ? publishProblems(editing.bodyMd) : []), [editing]);
  const unsaved = Boolean(editing?.id && draft && (editing.bodyMd !== draft.body_md || editing.title !== draft.title || editing.changeSummary !== (draft.change_summary ?? "")));

  const rendered = useMemo(() => {
    if (!editing || config.status !== "ready") return null;
    try {
      return renderAgreement(editing.bodyMd, { versionNumber: draft?.version_number ?? 1, consignmentNumber: 1001, consignorName: "Sample Consignor", terms: previewTerms(config.config) });
    } catch (e) {
      return e instanceof Error ? e.message : "This draft can't be filled in.";
    }
  }, [editing, config, draft]);

  async function run(key: string, fn: () => Promise<AgreementVersion[]>, done: string) {
    setBusy(key);
    try {
      setVersions(await fn());
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!versions) return <Spinner label="Loading the agreement" />;

  return (
    <div className="gg-cs">
      <p className="gg-cs-lead">
        New invitations use the published version, filled in with the rates in effect when each one is sent. Agreements already sent or signed
        never change. Have an attorney review a version before you publish it.
      </p>

      <SectionCard title="Versions">
        <table className="gg-cs-table">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.version_number}</strong> {v.title}
                </td>
                <td>
                  <Badge tone={v.status === "published" ? "success" : v.status === "draft" ? "warning" : "neutral"}>
                    {v.status === "published" ? "In use" : v.status === "draft" ? "Draft" : "Retired"}
                  </Badge>
                </td>
                <td>
                  {v.change_summary}
                  {v.published_at && <span className="gg-cs-note">Published {new Date(v.published_at).toLocaleString()} by {v.published_by}</span>}
                  {v.status === "draft" && v.problems.length > 0 && (
                    <span className="gg-cs-note">{v.problems.length} blank{v.problems.length === 1 ? "" : "s"} or notes left before it can be published</span>
                  )}
                  <span className="gg-cs-note">Text SHA-256 {v.body_sha256.slice(0, 16)}…</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="gg-btn-row">
          {draft ? (
            <Button
              variant="primary"
              icon="edit"
              onClick={() => setEditing({ id: draft.id, title: draft.title, bodyMd: draft.body_md, changeSummary: draft.change_summary ?? "" })}
            >
              Edit draft version {draft.version_number}
            </Button>
          ) : published ? (
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => setEditing({ title: published.title, bodyMd: published.body_md, changeSummary: "" })}
            >
              Start version {Math.max(...versions.map((v) => v.version_number)) + 1} from the one in use
            </Button>
          ) : null}
          {!published && <span className="gg-cs-note">No version is published yet, so no agreement can be sent.</span>}
        </div>
      </SectionCard>

      {editing && (
        <SectionCard title={editing.id ? `Draft version ${draft?.version_number ?? ""}` : "New draft"}>
          <div className="gg-cs">
            <TextField label="Title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <TextField
              label="What changed (shown with the version)"
              value={editing.changeSummary}
              onChange={(e) => setEditing({ ...editing, changeSummary: e.target.value })}
            />
            <div className="gg-btn-row">
              <Button size="sm" variant={preview ? "secondary" : "primary"} onClick={() => setPreview(false)}>
                Edit text
              </Button>
              <Button size="sm" variant={preview ? "primary" : "secondary"} onClick={() => setPreview(true)}>
                Preview with today's rates
              </Button>
            </div>
            {preview ? (
              <div className="gg-cn-preview">
                {rendered === null ? <Spinner label="Loading rates" /> : <AgreementText markdown={rendered} />}
              </div>
            ) : (
              <TextArea
                label="Agreement text"
                className="gg-cn-editor"
                rows={24}
                value={editing.bodyMd}
                onChange={(e) => setEditing({ ...editing, bodyMd: e.target.value })}
                hint={`Markdown: "## " headings, **bold**, numbered and "- " lists, and | tables |. Fields filled in when sent: ${TEMPLATE_TOKENS.map((t) => `{{${t}}}`).join(", ")}.`}
              />
            )}
            {liveProblems.length > 0 && (
              <div className="gg-cn-problems" role="status">
                <strong>Fill in or remove before publishing ({liveProblems.length}):</strong>
                <ul>
                  {liveProblems.slice(0, 12).map((p, i) => (
                    <li key={i}>
                      <code>{p.text}</code>
                      {p.kind === "unknown_field" ? " (unknown field)" : ""}
                    </li>
                  ))}
                  {liveProblems.length > 12 && <li>and {liveProblems.length - 12} more</li>}
                </ul>
              </div>
            )}
            <div className="gg-btn-row">
              <Button
                variant="primary"
                loading={busy === "save"}
                onClick={() =>
                  void run(
                    "save",
                    () => consignmentAdminApi.saveDraft({ id: editing.id, title: editing.title, bodyMd: editing.bodyMd, changeSummary: editing.changeSummary }),
                    "Draft saved.",
                  ).then((ok) => {
                    if (ok && !editing.id) setEditing(null);
                  })
                }
              >
                Save draft
              </Button>
              {editing.id && (
                <Button
                  variant="gold"
                  disabled={liveProblems.length > 0 || unsaved}
                  loading={busy === "publish"}
                  title={liveProblems.length ? "Fill in every blank first" : unsaved ? "Save your edits first" : undefined}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Publish this version? New invitations will use it from now on, and its text can't be edited afterwards. Only publish once it has been reviewed.",
                      )
                    )
                      return;
                    void run("publish", () => consignmentAdminApi.publish(editing.id!), "Published. New invitations use this version.").then((ok) => {
                      if (ok) setEditing(null);
                    });
                  }}
                >
                  Publish
                </Button>
              )}
              {editing.id && (
                <Button
                  variant="danger"
                  loading={busy === "delete"}
                  onClick={() => {
                    if (!window.confirm("Delete this draft? This can't be undone.")) return;
                    void run("delete", () => consignmentAdminApi.deleteDraft(editing.id!), "Draft deleted.").then((ok) => ok && setEditing(null));
                  }}
                >
                  Delete draft
                </Button>
              )}
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Close
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
