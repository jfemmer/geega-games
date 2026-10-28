import { useEffect, useId, useRef, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { useAuth } from "../lib/AuthContext";
import { authLinkWithReturn } from "../lib/authRedirect";
import { formatCents } from "../lib/money";
import {
  ACKNOWLEDGMENTS,
  CHANNEL_DISCLOSURES,
  describeChannelFees,
  emptyAnswers,
  signingProblems,
  type AcknowledgmentKey,
  type ChannelAnswers,
} from "../lib/consignmentAgreement";
import { CHANNEL_LABELS, CONSIGNMENT_CHANNELS } from "../lib/consignmentMath";
import {
  CONSIGN_SIGN_PATH,
  loadInvite,
  signAgreement,
  signedAgreementUrl,
  useEstimatorConfig,
  type InviteView,
} from "../lib/consignmentApi";
import { AgreementText } from "../components/consignment/AgreementText";
import { PayoutEstimator } from "../components/consignment/PayoutEstimator";

// /consign/sign?t=<secret>: a consignor reviews and signs their consignment
// agreement. They must be signed in with the email it was sent to. They read
// the whole agreement, answer Yes or No for each sales channel, choose on
// additional insurance (nothing is pre-selected), tick each acknowledgment,
// and type their legal name twice. The server checks all of it again and
// records the signature against the exact text shown (its SHA-256).

type State =
  | { status: "loading" }
  | { status: "error"; message: string; code: number }
  | { status: "ready"; invite: InviteView }
  | { status: "done"; label: string; agreementId: string; pdfReady: boolean };

function YesNo({
  name,
  value,
  onChange,
  yes,
  no,
}: {
  name: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yes: string;
  no: string;
}) {
  return (
    <div className="gg-consign__choices">
      <label className={`gg-consign__choice${value === true ? " is-on" : ""}`}>
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} />
        <span>{yes}</span>
      </label>
      <label className={`gg-consign__choice${value === false ? " is-on" : ""}`}>
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} />
        <span>{no}</span>
      </label>
    </div>
  );
}

function PdfButton({ agreementId }: { agreementId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="gg-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          // Open the tab first (inside the click) so phones don't block it.
          const tab = window.open("", "_blank");
          try {
            const url = await signedAgreementUrl(agreementId);
            if (tab) tab.location.href = url;
            else window.location.href = url;
          } catch (e) {
            tab?.close();
            setError(e instanceof Error ? e.message : "Could not open the PDF.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening…" : "Download signed PDF"}
      </button>
      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function SignForm({ token, invite, onDone }: { token: string; invite: Extract<InviteView, { status: "pending" }>; onDone: (s: State) => void }) {
  const ids = useId();
  const config = useEstimatorConfig();
  const [reachedEnd, setReachedEnd] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [channels, setChannels] = useState<ChannelAnswers>(emptyAnswers());
  const [insurance, setInsurance] = useState<boolean | null>(null);
  const [acks, setAcks] = useState<Partial<Record<AcknowledgmentKey, boolean>>>({});
  const [legalName, setLegalName] = useState("");
  const [typedSignature, setTypedSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const terms = invite.terms;

  // "I've reviewed the whole agreement" unlocks once the end of it has been on screen.
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

  const problems = signingProblems({ acknowledgments: acks, channels, additionalInsurance: insurance, legalName, typedSignature });

  async function submit() {
    setShowProblems(true);
    if (problems.length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await signAgreement({
        t: token,
        agreementSha256: invite.agreementSha256,
        acknowledgments: acks,
        channels,
        additionalInsurance: insurance,
        legalName,
        typedSignature,
      });
      onDone({ status: "done", label: invite.consignmentLabel, agreementId: res.agreementId, pdfReady: res.pdfReady });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not record your signature. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const approved = CONSIGNMENT_CHANNELS.filter((c) => channels[c] === true);

  return (
    <div className="gg-consign">
      <header className="gg-consign__head">
        <p className="gg-consign__eyebrow">
          {invite.consignmentLabel} · Version {invite.versionNumber}
        </p>
        <h1>{invite.title}</h1>
        <p>
          Hi {invite.consignorName.split(" ")[0]}. Please read the whole agreement, make your choices below, and sign. Take your time: this
          link works until {new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
        </p>
      </header>

      <section className="gg-consign__card" aria-labelledby={`${ids}-agr`}>
        <h2 id={`${ids}-agr`} className="gg-consign__step">
          1. Read the agreement
        </h2>
        <div className="gg-consign__doc" tabIndex={0} aria-label="Consignment agreement text">
          <AgreementText markdown={invite.renderedMd} />
          <div ref={endRef} className="gg-consign__end">
            End of agreement
          </div>
        </div>
      </section>

      <section className="gg-consign__card" aria-labelledby={`${ids}-ch`}>
        <h2 id={`${ids}-ch`} className="gg-consign__step">
          2. Where may we sell your cards?
        </h2>
        <p className="gg-consign__hint">Answer each one. We'll never list your cards on a channel you decline.</p>
        {CONSIGNMENT_CHANNELS.filter((c) => terms.channels[c]).map((c) => (
          <fieldset key={c} className="gg-consign__channel">
            <legend>{CHANNEL_LABELS[c]}</legend>
            <p>{CHANNEL_DISCLOSURES[c]}</p>
            <p className="gg-consign__fees">Fees as of signing: {describeChannelFees(terms.channels[c]!)} Account-specific fees may differ.</p>
            <YesNo
              name={`${ids}-${c}`}
              value={channels[c]}
              onChange={(v) => setChannels((prev) => ({ ...prev, [c]: v }))}
              yes={`Yes, approve ${CHANNEL_LABELS[c]} sales`}
              no={`No, decline ${CHANNEL_LABELS[c]} sales`}
            />
          </fieldset>
        ))}
      </section>

      <section className="gg-consign__card" aria-labelledby={`${ids}-ins`}>
        <h2 id={`${ids}-ins`} className="gg-consign__step">
          3. Additional shipping insurance
        </h2>
        <p>
          {terms.insurance.service} includes up to {formatCents(terms.insurance.includedCoverageCents)} of insurance. Choose whether we buy more
          when a package with your cards is worth more than that.
        </p>
        <fieldset className="gg-consign__channel">
          <legend className="gg-pe-sr">Additional insurance</legend>
          <label className={`gg-consign__option${insurance === true ? " is-on" : ""}`}>
            <input type="radio" name={`${ids}-insurance`} checked={insurance === true} onChange={() => setInsurance(true)} />
            <span>
              <strong>Option A: Approve additional insurance.</strong> We buy USPS insurance up to the package's value. The actual premium is a
              shipping expense, so it lowers your payout for that sale.
            </span>
          </label>
          <label className={`gg-consign__option${insurance === false ? " is-on" : ""}`}>
            <input type="radio" name={`${ids}-insurance`} checked={insurance === false} onChange={() => setInsurance(false)} />
            <span>
              <strong>Option B: Decline additional insurance.</strong> Only the included coverage applies. If a package worth more is lost or
              damaged, you bear the loss above that coverage, which could mean no payout for that card.
            </span>
          </label>
        </fieldset>
      </section>

      <section className="gg-consign__card" aria-labelledby={`${ids}-est`}>
        <h2 id={`${ids}-est`} className="gg-consign__step">
          See what you could receive
        </h2>
        {config.status === "ready" ? (
          <PayoutEstimator config={config.config} insuranceElection={null} />
        ) : config.status === "loading" ? (
          <p className="gg-consign__hint" role="status">
            Loading the estimator…
          </p>
        ) : (
          <p className="gg-consign__hint">The estimator isn't available right now. The agreement above has every rate.</p>
        )}
      </section>

      <section className="gg-consign__card" aria-labelledby={`${ids}-ack`}>
        <h2 id={`${ids}-ack`} className="gg-consign__step">
          4. Acknowledge and sign
        </h2>
        {!reachedEnd && <p className="gg-consign__hint">Scroll through to the end of the agreement to confirm you've reviewed it.</p>}
        <div className="gg-consign__acks">
          {ACKNOWLEDGMENTS.map((a) => {
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
          <label className="gg-field" htmlFor={`${ids}-name`}>
            <span>Full legal name</span>
            <input
              id={`${ids}-name`}
              autoComplete="name"
              value={legalName}
              maxLength={200}
              onChange={(e) => setLegalName(e.target.value)}
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
        {approved.length > 0 && insurance !== null && (
          <p className="gg-consign__summary">
            You're approving sales on {approved.map((c) => CHANNEL_LABELS[c]).join(", ")}, and you{" "}
            {insurance ? "approve" : "decline"} additional insurance.
          </p>
        )}
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
          {submitting ? "Signing…" : "Sign the agreement"}
        </button>
        <p className="gg-consign__fine">
          Signing records your typed name, choices, the time, your account, IP address and browser with the exact text above. You'll get a
          PDF copy by email and in your account.
        </p>
      </section>
    </div>
  );
}

export default function ConsignSignPage() {
  useSEO({
    title: "Sign your consignment agreement | Geega Games",
    description: "Review and sign your Geega Games consignment agreement.",
    path: CONSIGN_SIGN_PATH,
    noIndex: true,
  });
  const { query } = useRouter();
  const token = query.get("t") ?? "";
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadInvite(token).then(
      (invite) => !cancelled && setState({ status: "ready", invite }),
      (e: unknown) =>
        !cancelled &&
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Something went wrong. Please try again.",
          code: (e as { status?: number }).status ?? 0,
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [token, user, authLoading]);

  const here = `${CONSIGN_SIGN_PATH}?t=${encodeURIComponent(token)}`;

  if (!token) {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Consignment agreement</h1>
        <p className="gg-alert gg-alert-error" role="alert">
          This link is missing its code. Open the newest email from Geega Games and use the button in it.
        </p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="gg-page gg-consign-page" aria-busy="true">
        <h1>Consignment agreement</h1>
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Sign in to open your agreement</h1>
        <p>
          Your consignment agreement is tied to your email address. Sign in, or create a free account, using the same email the invitation was
          sent to. You'll come right back here.
        </p>
        <div className="gg-consign__auth">
          <Link to={authLinkWithReturn("/login", here)} className="gg-btn">
            Sign in
          </Link>
          <Link to={authLinkWithReturn("/signup", here)} className="gg-btn gg-btn-ghost">
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="gg-page gg-consign-page" aria-busy="true">
        <h1>Consignment agreement</h1>
        <p role="status">Opening your agreement…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Consignment agreement</h1>
        <p className="gg-alert gg-alert-error" role="alert">
          {state.message}
        </p>
        {state.code === 403 && <p>You're signed in as {user.email}.</p>}
      </div>
    );
  }

  if (state.status === "done") {
    return (
      <div className="gg-page gg-consign-page">
        <h1>Thanks, your agreement is signed</h1>
        <p className="gg-alert gg-alert-ok" role="status">
          {state.label} is signed. {state.pdfReady ? "We've emailed you a PDF copy." : "Your PDF copy is being prepared; it'll be in your account shortly."}
        </p>
        <p>Next, send us your cards. We'll confirm when they arrive, inspect them, and post the cards we accept to your account before anything is listed.</p>
        <div className="gg-consign__auth">
          <PdfButton agreementId={state.agreementId} />
          <Link to="/account/consignments" className="gg-btn gg-btn-ghost">
            View my consignment
          </Link>
        </div>
      </div>
    );
  }

  const invite = state.invite;
  if (invite.status === "signed") {
    return (
      <div className="gg-page gg-consign-page">
        <h1>This agreement is already signed</h1>
        <p>
          {invite.consignmentLabel} was signed on {new Date(invite.signedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}.
        </p>
        <div className="gg-consign__auth">
          <PdfButton agreementId={invite.agreementId} />
          <Link to="/account/consignments" className="gg-btn gg-btn-ghost">
            View my consignment
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="gg-page gg-consign-page">
      <SignForm token={token} invite={invite} onDone={setState} />
    </div>
  );
}
