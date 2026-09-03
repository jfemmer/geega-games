import { useEffect, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, TextArea, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Tabs } from "../components/ui/Nav";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { campaignRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { formatNumber } from "../utils/format";
import { CAMPAIGN_AUDIENCE_LABELS } from "../utils/labels";
import type { Campaign, CampaignAudience } from "../types";

const AUDIENCES: CampaignAudience[] = [
  "active_subscribers",
  "confirmed_recent",
  "all_customers",
];

type PreviewMode = "desktop" | "mobile" | "text";

const BLANK = {
  name: "",
  subject: "",
  previewText: "",
  body: "",
  buttonText: "",
  buttonUrl: "",
  audience: "active_subscribers" as CampaignAudience,
};

export function CampaignEditor({
  campaign,
  open,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ ...BLANK });
  const [preview, setPreview] = useState<PreviewMode>("desktop");
  const [recipients, setRecipients] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const readOnly =
    campaign != null &&
    ["sent", "sending", "queued", "cancelled", "failed"].includes(
      campaign.status,
    );

  useEffect(() => {
    if (open) {
      setForm(
        campaign
          ? {
              name: campaign.name,
              subject: campaign.subject,
              previewText: campaign.previewText,
              body: campaign.body,
              buttonText: campaign.buttonText ?? "",
              buttonUrl: campaign.buttonUrl ?? "",
              audience: campaign.audience,
            }
          : { ...BLANK },
      );
      setPreview("desktop");
    }
  }, [open, campaign]);

  useEffect(() => {
    campaignRepository.recipientCount(form.audience).then(setRecipients);
  }, [form.audience]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Give the campaign an internal name.";
    if (!form.subject.trim()) return "Add a subject line.";
    if (!form.body.trim()) return "Write some body content.";
    if (form.buttonText.trim() && !form.buttonUrl.trim())
      return "Add a URL for the button, or clear the button text.";
    return null;
  }

  async function save(): Promise<Campaign | null> {
    const err = validate();
    if (err) {
      toast.error(err);
      return null;
    }
    setBusy(true);
    try {
      const saved = await campaignRepository.save({
        id: campaign?.id,
        name: form.name.trim(),
        subject: form.subject.trim(),
        previewText: form.previewText.trim(),
        body: form.body.trim(),
        buttonText: form.buttonText.trim() || null,
        buttonUrl: form.buttonUrl.trim() || null,
        audience: form.audience,
        status: "draft",
        recipientCount: recipients,
        scheduledAt: null,
      });
      onSaved();
      return saved;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    const saved = await save();
    if (saved) {
      toast.success("Draft saved.");
      onClose();
    }
  }

  async function handleSendTest() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    toast.success("Test email simulated to your address (not actually sent).");
  }

  async function handleSend() {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      await campaignRepository.send(saved.id);
      toast.success(
        `Campaign queued to ${formatNumber(recipients)} recipients (simulated — no real email sent).`,
      );
      onSaved();
      onClose();
    } catch {
      toast.error("Could not queue the campaign.");
    } finally {
      setBusy(false);
      setConfirmSend(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={campaign ? (readOnly ? "Campaign" : "Edit campaign") : "New campaign"}
        variant="drawer"
        size="lg"
        footer={
          readOnly ? (
            <div className="gg-drawer-actions__buttons">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="gg-drawer-actions__buttons">
              <Button variant="ghost" onClick={handleSendTest} disabled={busy}>
                Send test
              </Button>
              <Button
                variant="secondary"
                onClick={handleSaveDraft}
                loading={busy}
              >
                Save draft
              </Button>
              <Button
                variant="primary"
                icon="mail"
                disabled={busy}
                onClick={() => {
                  const err = validate();
                  if (err) {
                    toast.error(err);
                    return;
                  }
                  setConfirmSend(true);
                }}
              >
                Send…
              </Button>
            </div>
          )
        }
      >
        <div className="gg-campaign">
          <div className="gg-campaign__form">
            <TextField
              label="Internal name"
              value={form.name}
              disabled={readOnly}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Weekend Commander sale"
            />
            <TextField
              label="Subject line"
              value={form.subject}
              disabled={readOnly}
              onChange={(e) => set("subject", e.target.value)}
            />
            <TextField
              label="Preview text"
              value={form.previewText}
              disabled={readOnly}
              onChange={(e) => set("previewText", e.target.value)}
              hint="Shown after the subject in most inboxes."
            />
            <TextArea
              label="Body"
              value={form.body}
              rows={7}
              disabled={readOnly}
              onChange={(e) => set("body", e.target.value)}
              hint="Plain text with line breaks. Rich blocks come later."
            />
            <div className="gg-form-grid">
              <TextField
                label="Button text"
                value={form.buttonText}
                disabled={readOnly}
                onChange={(e) => set("buttonText", e.target.value)}
                placeholder="Optional"
              />
              <TextField
                label="Button URL"
                value={form.buttonUrl}
                disabled={readOnly}
                onChange={(e) => set("buttonUrl", e.target.value)}
                placeholder="https://…"
              />
            </div>
            <SelectField
              label="Audience"
              value={form.audience}
              disabled={readOnly}
              onChange={(e) => set("audience", e.target.value as CampaignAudience)}
              hint={`${formatNumber(recipients)} recipients`}
            >
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {CAMPAIGN_AUDIENCE_LABELS[a]}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="gg-campaign__preview">
            <div className="gg-campaign__previewbar">
              <Tabs
                items={[
                  { key: "desktop", label: "Desktop" },
                  { key: "mobile", label: "Mobile" },
                  { key: "text", label: "Plain text" },
                ]}
                active={preview}
                onChange={(k) => setPreview(k as PreviewMode)}
                ariaLabel="Preview mode"
              />
            </div>
            <CampaignPreview mode={preview} form={form} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmSend}
        title="Send this campaign?"
        message={`This will queue “${form.subject}” to ${formatNumber(
          recipients,
        )} recipients (${CAMPAIGN_AUDIENCE_LABELS[form.audience]}). In the mock, delivery is simulated and no real email is sent.`}
        confirmLabel="Send now"
        tone="primary"
        onConfirm={handleSend}
        onCancel={() => setConfirmSend(false)}
      />
    </>
  );
}

function CampaignPreview({
  mode,
  form,
}: {
  mode: PreviewMode;
  form: typeof BLANK;
}) {
  if (mode === "text") {
    return (
      <div className="gg-preview-text">
        <pre>
          {form.subject && `Subject: ${form.subject}\n\n`}
          {form.body || "Your message will appear here."}
          {form.buttonText && `\n\n${form.buttonText}: ${form.buttonUrl}`}
        </pre>
      </div>
    );
  }
  return (
    <div
      className={`gg-preview-frame gg-preview-frame--${mode}`}
      aria-label={`${mode} email preview`}
    >
      <div className="gg-email">
        <div className="gg-email__brand">
          <Icon name="sparkle" size={18} /> Geega Games
        </div>
        <div className="gg-email__card">
          <h2 className="gg-email__subject">
            {form.subject || "Your subject line"}
          </h2>
          {form.previewText && (
            <p className="gg-email__preheader">{form.previewText}</p>
          )}
          <div className="gg-email__body">
            {(form.body || "Your message will appear here.")
              .split("\n")
              .map((line, i) => (
                <p key={i}>{line || "\u00A0"}</p>
              ))}
          </div>
          {form.buttonText && (
            <div className="gg-email__btnwrap">
              <span className="gg-email__btn">{form.buttonText}</span>
            </div>
          )}
          <div className="gg-email__footer">
            You’re receiving this because you subscribed at geega-games.com.
            <br />
            Unsubscribe · Update preferences
          </div>
        </div>
      </div>
    </div>
  );
}
