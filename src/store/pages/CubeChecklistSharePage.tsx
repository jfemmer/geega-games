import { useMemo, useState } from "react";
import { ToastProvider } from "../../admin/components/ui/ToastProvider";
import { CubeChecklistView } from "../../admin/components/cube/CubeChecklistView";
import { Button } from "../../admin/components/ui/Button";
import { TextField } from "../../admin/components/ui/Field";
import { CHECKLIST_LIMITS } from "../lib/cubeChecklist";
import { readSavedName, saveName, shareLinkCaller } from "../lib/cubeChecklistApi";
import { siteLogoSrc } from "../lib/siteLogo";
import "../../admin/admin.css";

// /cube-checklist?t=<token> — the share link for a cube checklist. Friends
// open it on their phones (no account), type their name once, and work the
// list together with staff: mark cards found, swap cards for better options,
// look up printings. The token in the link is the only access; staff can turn
// it off or replace it from the admin Cube Checklist page.
//
// Standalone like the kiosk and yard sale (App.tsx renders it without the
// storefront header, cart or account). It reuses the admin dashboard's
// checklist view and design system, scoped under .gg-admin as in the admin.

function tokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get("t") ?? "";
}

export default function CubeChecklistSharePage() {
  const token = useMemo(() => tokenFromUrl(), []);
  const [who, setWho] = useState(readSavedName);
  const [editing, setEditing] = useState(() => readSavedName() === "");
  const [draft, setDraft] = useState(who);

  const call = useMemo(() => shareLinkCaller(token, who), [token, who]);

  function submitName() {
    const name = draft.trim().replace(/\s+/g, " ").slice(0, CHECKLIST_LIMITS.personName);
    if (!name) return;
    saveName(name);
    setWho(name);
    setEditing(false);
  }

  return (
    <div className="gg-admin gg-cubeshare">
      <ToastProvider>
        <main className="gg-cubeshare__main">
          <header className="gg-cubeshare__head">
            <img src={siteLogoSrc()} alt="Geega Games" className="gg-cubeshare__logo" />
            <div>
              <h1 className="gg-pagehead__title">Cube Checklist</h1>
              <p className="gg-pagehead__desc">
                Mark cards as you find them, and swap in better options. Everyone with this link sees the same list.
              </p>
            </div>
          </header>

          {!token ? (
            <p className="gg-card-meta">This link is missing its code. Ask whoever sent it for the full link.</p>
          ) : editing ? (
            <form
              className="gg-card gg-cubeshare__name"
              onSubmit={(e) => {
                e.preventDefault();
                submitName();
              }}
            >
              <TextField
                label="Your name"
                hint="Shown next to the cards you find or swap, so everyone knows who has what."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={CHECKLIST_LIMITS.personName}
                autoFocus
                required
              />
              <div className="gg-cubecheck__shareactions">
                <Button type="submit" variant="primary" disabled={!draft.trim()}>
                  Continue
                </Button>
                {who && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <CubeChecklistView
              call={call}
              identity={
                <>
                  Marking cards as <strong>{who}</strong> ·{" "}
                  <button
                    type="button"
                    className="gg-cubecheck__link"
                    onClick={() => {
                      setDraft(who);
                      setEditing(true);
                    }}
                  >
                    change
                  </button>
                </>
              }
            />
          )}
        </main>
      </ToastProvider>
    </div>
  );
}
