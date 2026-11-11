import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { AgreementText } from "../components/consignment/AgreementText";
import { PARTNER_ENTITY_TYPES, partnerSigningProblems, type PartnerAgreementAck } from "../lib/partnerAgreement";
import type { PartnerKind } from "../lib/partnerTypes";
import { US_REGIONS } from "../lib/usAddress";

// /partner-agreement?t=… — an approved partner reads and signs their
// Referral Partner or Partner Store Agreement. No account needed: the link
// from the approval email is the key (api/partner-agreement.ts). Same layout
// and agreement renderer as the consignment signing page, so the text shown
// is exactly what the signed PDF shows. The Referral Partner Agreement also
// asks for the legal entity signing, and takes effect when Geega Games
// countersigns it.

const PATH = "/partner-agreement";
const API = "/api/partner-agreement";

type PendingView = {
  status: "pending";
  kind: PartnerKind;
  title: string;
  versionNumber: number;
  businessName: string;
  contactName: string;
  renderedMd: string;
  agreementSha256: string;
  acknowledgments: PartnerAgreementAck[];
  expiresAt: string;
  /** Ask for the legal entity (agreements Geega Games countersigns). */
  collectEntity?: boolean;
  entityDefaults?: { name: string; state: string };
};
type SignedView = {
  status: "signed" | "awaiting";
  title: string;
  businessName: string;
  signedAt: string;
  signerName: string | null;
  effectiveAt?: string | null;
};
type View = PendingView | SignedView;

/** States, D.C. and territories, for "state of organization". */
const STATE_OPTIONS = US_REGIONS.filter((r) => r.group !== "military");

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; view: PendingView }
  | { status: "signed"; view: SignedView }
  | { status: "done"; kind: PartnerKind; title: string; activated: boolean; emailed: boolean; awaitingCountersign: boolean };

async function request<T>(init: { method: "GET" | "POST"; query?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${init.query ?? ""}`, {
      method: init.method,
      headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !body || body.ok === false) throw new Error(body?.message || "Something went wrong. Please try again.");
  return body;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function SignForm({ token, view, onDone }: { token: string; view: PendingView; onDone: (s: State) => void }) {
  const ids = useId();
  const [reachedEnd, setReachedEnd] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [legalName, setLegalName] = useState("");
  const [title, setTitle] = useState("");
  const [typedSignature, setTypedSignature] = useState("");
  const [entity, setEntity] = useState({
    name: view.entityDefaults?.name ?? "",
    type: "",
    state: view.entityDefaults?.state ?? "",
    address: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  // "I have read this entire agreement" unlocks once its end has been on screen.
  useEffect(() => {
    const el = endRef.current;
    if (!el || reachedEnd) return;
    if (typeof IntersectionObserver === "undefined") {
      setReachedEnd(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setReachedEnd(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [reachedEnd]);

  const collectEntity = view.collectEntity === true;
  const problems = partnerSigningProblems(
    view.kind,
    { legalName, title, typedSignature, acknowledgments: acks, entity: collectEntity ? entity : undefined },
    { collectEntity },
  );
  const setEntityField = (k: keyof typeof entity) => (e: { target: { value: string } }) => setEntity((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit() {
    setShowProblems(true);
    if (problems.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await request<{ activated: boolean; pdfEmailed: boolean; awaitingCountersign?: boolean }>({
        method: "POST",
        body: {
          t: token,
          agreementSha256: view.agreementSha256,
          acknowledgments: acks,
          legalName,
          title,
          typedSignature,
          ...(collectEntity ? { entity } : {}),
        },
      });
      onDone({
        status: "done",
        kind: view.kind,
        title: view.title,
        activated: res.activated,
        emailed: res.pdfEmailed,
        awaitingCountersign: res.awaitingCountersign === true,
      });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not record your signature. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="gg-consign">
      <header className="gg-consign__head">
        <p className="gg-consign__eyebrow">
          {view.businessName} · Version {view.versionNumber}
        </p>
        <h1>{view.title}</h1>
        <p>
          Hi {view.contactName.split(" ")[0] || "there"}. Please read the whole agreement, tick each box and sign. Take your time: this link
          works until {longDate(view.expiresAt)}. Questions first? Reply to the email we sent you.
        </p>
      </header>

      <section className="gg-consign__card" aria-labelledby={`${ids}-agr`}>
        <h2 id={`${ids}-agr`} className="gg-consign__step">
          1. Read the agreement
        </h2>
        <div className="gg-consign__doc" tabIndex={0} aria-label={`${view.title} text`}>
          <AgreementText markdown={view.renderedMd} />
          <div ref={endRef} className="gg-consign__end">
            End of agreement
          </div>
        </div>
      </section>

      <section className="gg-consign__card" aria-labelledby={`${ids}-ack`}>
        <h2 id={`${ids}-ack`} className="gg-consign__step">
          2. Confirm and sign
        </h2>
        {!reachedEnd && <p className="gg-consign__hint">Scroll through to the end of the agreement to confirm you've read it.</p>}
        <div className="gg-consign__acks">
          {view.acknowledgments.map((a) => {
            const locked = a.key === "reviewed" && !reachedEnd;
            return (
              <label key={a.key} className={`gg-tc-ack${locked ? " is-locked" : ""}`}>
                <input
                  type="checkbox"
                  checked={acks[a.key] === true}
                  disabled={locked}
                  onChange={(e) => setAcks((prev) => ({ ...prev, [a.key]: e.target.checked }))}
                />
                <span>{a.label}</span>
              </label>
            );
          })}
        </div>
        <div className="gg-form gg-consign__sign">
          {collectEntity && (
            <fieldset className="gg-consign__entity">
              <legend>Who is signing up</legend>
              <p className="gg-consign__hint">The legal entity this agreement binds and pays (Section 3.1).</p>
              <label className="gg-field" htmlFor={`${ids}-ename`}>
                <span>Legal name of the business (or your own name, if you're an individual)</span>
                <input id={`${ids}-ename`} autoComplete="organization" value={entity.name} maxLength={200} onChange={setEntityField("name")} />
              </label>
              <label className="gg-field" htmlFor={`${ids}-etype`}>
                <span>Type of business</span>
                <select id={`${ids}-etype`} className="gg-state-select" value={entity.type} onChange={setEntityField("type")}>
                  <option value="">Choose…</option>
                  {PARTNER_ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gg-field" htmlFor={`${ids}-estate`}>
                <span>{entity.type === "individual" ? "State you live in" : "State it's organized in"}</span>
                <select id={`${ids}-estate`} className="gg-state-select" autoComplete="address-level1" value={entity.state} onChange={setEntityField("state")}>
                  <option value="">Choose…</option>
                  {STATE_OPTIONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gg-field" htmlFor={`${ids}-eaddr`}>
                <span>Business mailing address</span>
                <input
                  id={`${ids}-eaddr`}
                  autoComplete="street-address"
                  placeholder="Street, city, state ZIP"
                  value={entity.address}
                  maxLength={300}
                  onChange={setEntityField("address")}
                />
              </label>
            </fieldset>
          )}
          <label className="gg-field" htmlFor={`${ids}-name`}>
            <span>Full legal name</span>
            <input id={`${ids}-name`} autoComplete="name" value={legalName} maxLength={200} onChange={(e) => setLegalName(e.target.value)} />
          </label>
          <label className="gg-field" htmlFor={`${ids}-title`}>
            <span>Your title or role at {view.businessName}</span>
            <input
              id={`${ids}-title`}
              autoComplete="organization-title"
              placeholder="Owner"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="gg-field" htmlFor={`${ids}-sig`}>
            <span>Electronic signature: type your full legal name again</span>
            <input
              id={`${ids}-sig`}
              className="gg-consign__signature"
              autoComplete="off"
              value={typedSignature}
              maxLength={200}
              onChange={(e) => setTypedSignature(e.target.value)}
            />
          </label>
        </div>
        {showProblems && problems.length > 0 && (
          <ul className="gg-alert gg-alert-warn gg-consign__problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {submitError && (
          <p className="gg-alert gg-alert-error" role="alert">
            {submitError}
          </p>
        )}
        <button type="button" className="gg-btn gg-consign__submit" disabled={submitting} onClick={() => void submit()}>
          {submitting ? "Signing…" : `Sign for ${view.businessName}`}
        </button>
        <p className="gg-consign__fine">
          {collectEntity
            ? "Signing records the business details, your typed name, title, each box you ticked, the time, your IP address and browser with the exact text above. Geega Games then countersigns, and you'll get the fully signed PDF by email."
            : "Signing records your typed name, title, each box you ticked, the time, your IP address and browser with the exact text above. You'll get a PDF copy by email."}
        </p>
      </section>
    </div>
  );
}

export default function PartnerAgreementPage() {
  useSEO({
    title: "Sign your partner agreement | Geega Games",
    description: "Review and sign your Geega Games partner agreement.",
    path: PATH,
    noIndex: true,
  });
  const { query } = useRouter();
  const token = query.get("t") ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState({ status: "loading" });
    request<View>({ method: "GET", query: `?t=${encodeURIComponent(token)}` }).then(
      (view) => {
        if (cancelled) return;
        setState(view.status === "pending" ? { status: "ready", view } : { status: "signed", view });
      },
      (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : "Something went wrong." }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Partner agreement</h1>
        <p className="gg-alert gg-alert-error" role="alert">
          This link is missing its code. Open the newest email from Geega Games and use the button in it.
        </p>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="gg-page gg-consign-page" aria-busy="true">
        <h1>Partner agreement</h1>
        <p role="status">Opening your agreement…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Partner agreement</h1>
        <p className="gg-alert gg-alert-error" role="alert">
          {state.message}
        </p>
      </div>
    );
  }
  if (state.status === "signed") {
    const v = state.view;
    return (
      <div className="gg-page gg-consign-page">
        <h1>Already signed</h1>
        {v.status === "awaiting" ? (
          <p>
            {v.signerName ?? "Someone"} signed the {v.title} for {v.businessName} on {longDate(v.signedAt)}. It's waiting for Geega Games to
            countersign it, and we'll email you the fully signed PDF then. Questions? Reply to any email from Geega Games.
          </p>
        ) : (
          <p>
            {v.signerName ?? "Someone"} signed the {v.title} for {v.businessName} on {longDate(v.signedAt)}
            {v.effectiveAt && v.effectiveAt !== v.signedAt ? `, and it took effect on ${longDate(v.effectiveAt)}` : ""}. A PDF copy was
            emailed then. Need another copy? Reply to any email from Geega Games.
          </p>
        )}
      </div>
    );
  }
  if (state.status === "done" && state.awaitingCountersign) {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Thanks, you've signed</h1>
        <p className="gg-alert gg-alert-ok" role="status">
          We've got your signature on the {state.title}.
        </p>
        <p>
          Geega Games will review your details and countersign it. The agreement takes effect then: you'll get
          the fully signed PDF by email{state.kind === "referrer" ? ", followed by your personal referral link and QR code" : ""}.
        </p>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Thanks, it's signed</h1>
        <p className="gg-alert gg-alert-ok" role="status">
          Your {state.title} is signed.{" "}
          {state.emailed ? "A PDF copy is on its way to your email." : "We'll email you a PDF copy shortly."}
        </p>
        {state.activated && (
          <p>
            {state.kind === "referrer"
              ? "Your partnership is now active. Your personal referral link and QR code are on their way in a separate email."
              : "Your store is now an active Geega Games partner. We'll send you leads that match what you buy."}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="gg-page gg-consign-page">
      <SignForm token={token} view={state.view} onDone={setState} />
    </div>
  );
}
