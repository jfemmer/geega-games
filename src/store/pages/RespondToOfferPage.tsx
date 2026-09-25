import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { STORE_CREDIT_BONUS_PERCENT, storeCreditValueCents } from "../lib/sellTypes";
import { formatCents } from "../lib/money";
import { SUPPORT_EMAIL } from "./StaticPages";
import { useSEO } from "../lib/useSEO";
import { lookupSellOffer, respondToSellOffer, type SellOfferLookup } from "../lib/sellApi";

// Public, guest-facing "respond to your offer" page — the seller-facing half
// of the accept/decline/counter feature (see sell_submission_offer_lookup
// and /api/sell/respond-to-offer.ts). Mirrors TrackOrderPage's lookup-form
// shape and anti-enumeration UX (a wrong ref/email and an offer that hasn't
// been sent yet look identical) so returning sellers see a familiar pattern.
//
// The link in the offer email carries ?ref=&email= so this auto-submits the
// lookup on load — most sellers will never see the manual form at all.

type ActionStep = null | "accept" | "decline" | "counter";

const money = (cents: number) => formatCents(cents);

/** Sign-in/sign-up link that returns to this offer, pre-filled. */
function respondReturnLink(base: "/login" | "/signup", ref: string, email: string): string {
  const back = `/sell/offer?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(email)}`;
  return `${base}?next=${encodeURIComponent(back)}${base === "/signup" ? `&email=${encodeURIComponent(email)}` : ""}`;
}

export default function RespondToOfferPage() {
  useSEO({
    title: "Respond to Your Offer | Geega Games",
    description: "Accept, decline, or counter the offer we sent for your collection.",
    path: "/sell/offer",
  });

  const { query } = useRouter();
  const { user } = useAuth();
  const [payoutMethod, setPayoutMethod] = useState<"paypal" | "store_credit">("store_credit");

  const [referenceNumberInput, setReferenceNumberInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<{ referenceNumber: string; email: string } | null>(
    null,
  );
  const [offer, setOffer] = useState<SellOfferLookup | null>(null);
  const [matchedEmail, setMatchedEmail] = useState("");

  const [actionStep, setActionStep] = useState<ActionStep>(null);
  const [counterInput, setCounterInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const autoSubmitted = useRef(false);

  const runLookup = async (referenceNumber: string, email: string) => {
    setError(null);
    setNotFound(null);
    setBusy(true);
    try {
      const result = await lookupSellOffer(referenceNumber, email);
      if (!result) {
        setNotFound({ referenceNumber, email });
      } else {
        setOffer(result);
        setMatchedEmail(email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoSubmitted.current) return;
    const ref = query.get("ref");
    const email = query.get("email");
    if (ref && email) {
      autoSubmitted.current = true;
      setReferenceNumberInput(ref);
      setEmailInput(email);
      void runLookup(ref, email);
    }
    // Auto-submit only once, from whatever query params the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await runLookup(referenceNumberInput.trim(), emailInput.trim());
  };

  const reset = () => {
    setOffer(null);
    setMatchedEmail("");
    setError(null);
    setNotFound(null);
    setReferenceNumberInput("");
    setEmailInput("");
    setActionStep(null);
    setCounterInput("");
    setSubmitError(null);
  };

  const submitResponse = async (
    response: "accepted" | "declined" | "countered",
    counterOfferCents?: number,
    payout?: "paypal" | "store_credit",
  ) => {
    if (!offer) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await respondToSellOffer({
        referenceNumber: offer.reference_number,
        email: matchedEmail,
        response,
        counterOfferCents,
        payoutMethod: response === "accepted" ? payout : undefined,
      });
      if (!result.ok) {
        setSubmitError(result.message ?? "We couldn't submit your response. Please try again.");
        return;
      }
      setOffer({
        ...offer,
        offer_response: response,
        counter_offer_cents: counterOfferCents ?? null,
        offer_responded_at: new Date().toISOString(),
        payout_method: response === "accepted" ? payout ?? "paypal" : offer.payout_method,
        store_credit_bonus_percent:
          response === "accepted" && payout === "store_credit"
            ? STORE_CREDIT_BONUS_PERCENT
            : offer.store_credit_bonus_percent,
      });
      setActionStep(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCounter = (e: FormEvent) => {
    e.preventDefault();
    const dollars = Number(counterInput);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setSubmitError("Please enter a valid counter-offer amount.");
      return;
    }
    void submitResponse("countered", Math.round(dollars * 100));
  };

  if (offer) {
    const greeting = offer.first_name ? `Hi ${offer.first_name},` : "Hi there,";

    if (offer.offer_response) {
      const creditCents = storeCreditValueCents(
        offer.offer_value_cents,
        offer.store_credit_bonus_percent ?? STORE_CREDIT_BONUS_PERCENT,
      );
      const respondedCopy: Record<"accepted" | "declined" | "countered", string> = {
        accepted:
          offer.payout_method === "store_credit"
            ? `You accepted our offer as ${money(creditCents)} in store credit. We'll be in touch with next steps — the credit is added to your account as soon as your purchase is completed (some collections ship to us for inspection first).`
            : "You accepted our offer. We'll be in touch with next steps — payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out.",
        declined:
          "You declined our offer. Thanks for considering Geega Games — we're happy to take a look at future collections anytime.",
        countered: `You countered our offer of ${money(offer.offer_value_cents)} with ${
          offer.counter_offer_cents != null ? money(offer.counter_offer_cents) : "your amount"
        }. We'll review it and follow up soon.`,
      };
      return (
        <div className="gg-page" style={{ maxWidth: 520, margin: "0 auto" }}>
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={reset}>
            ← Look up a different offer
          </button>
          <h1 style={{ color: "var(--gg-ink)", marginTop: "0.75rem" }}>
            Offer {offer.reference_number}
          </h1>
          <p className="gg-card-meta">{greeting}</p>
          <div className="gg-alert gg-alert-ok" role="status">
            {respondedCopy[offer.offer_response]}
          </div>
          {offer.offer_responded_at && (
            <p className="gg-card-meta" style={{ marginTop: "0.75rem" }}>
              Responded {new Date(offer.offer_responded_at).toLocaleString()}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="gg-page" style={{ maxWidth: 520, margin: "0 auto" }}>
        <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={reset}>
          ← Look up a different offer
        </button>
        <h1 style={{ color: "var(--gg-ink)", marginTop: "0.75rem" }}>
          Offer {offer.reference_number}
        </h1>
        <p className="gg-card-meta">{greeting}</p>

        <div
          style={{
            backgroundColor: "var(--gg-purple)",
            borderRadius: "12px",
            padding: "20px",
            margin: "1rem 0 1.5rem",
            textAlign: "center",
          }}
        >
          <p
            style={{
              color: "#e7e0f2",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: "0 0 4px",
            }}
          >
            Our offer
          </p>
          <p style={{ color: "#fff", fontSize: "2rem", fontWeight: 700, margin: 0 }}>
            {money(offer.offer_value_cents)}
          </p>
        </div>

        {submitError && (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {submitError}
          </div>
        )}

        {actionStep === null && (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="gg-btn"
              onClick={() => setActionStep("accept")}
              disabled={submitting}
            >
              Accept offer
            </button>
            <button
              type="button"
              className="gg-btn gg-btn-ghost"
              onClick={() => setActionStep("decline")}
              disabled={submitting}
            >
              Decline
            </button>
            {offer.allow_counter && (
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                onClick={() => setActionStep("counter")}
                disabled={submitting}
              >
                Counter offer
              </button>
            )}
          </div>
        )}

        {actionStep === "accept" && (
          <div className="gg-form" style={{ marginTop: "0.5rem" }}>
            <p style={{ color: "var(--gg-ink)", margin: 0 }}>How would you like to be paid?</p>
            <label className="gg-payout-option">
              <input
                type="radio"
                name="payout"
                checked={payoutMethod === "store_credit"}
                onChange={() => setPayoutMethod("store_credit")}
              />
              <span>
                <strong>
                  {money(storeCreditValueCents(offer.offer_value_cents))} in store credit
                </strong>{" "}
                <span className="gg-badge">+{STORE_CREDIT_BONUS_PERCENT}%</span>
                <span className="gg-card-meta" style={{ display: "block" }}>
                  Spend it on any singles in our shop. Added to your Geega Games account when
                  the purchase is completed.
                </span>
              </span>
            </label>
            <label className="gg-payout-option">
              <input
                type="radio"
                name="payout"
                checked={payoutMethod === "paypal"}
                onChange={() => setPayoutMethod("paypal")}
              />
              <span>
                <strong>{money(offer.offer_value_cents)} via PayPal</strong>
                <span className="gg-card-meta" style={{ display: "block" }}>
                  PayPal Goods &amp; Services only.
                </span>
              </span>
            </label>
            <p className="gg-card-meta" style={{ margin: 0 }}>
              We&rsquo;ll follow up with next steps — some collections ship to us for inspection
              first.
            </p>
            {payoutMethod === "store_credit" && !user ? (
              <div className="gg-alert gg-alert-warn" role="status">
                Store credit is saved to an account.{" "}
                <Link to={respondReturnLink("/signup", offer.reference_number, matchedEmail)}>
                  Create a free account
                </Link>{" "}
                or{" "}
                <Link to={respondReturnLink("/login", offer.reference_number, matchedEmail)}>
                  sign in
                </Link>
                , and you&rsquo;ll come right back here to accept.
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <button
                  type="button"
                  className="gg-btn"
                  onClick={() => void submitResponse("accepted", undefined, payoutMethod)}
                  disabled={submitting}
                >
                  {submitting
                    ? "Submitting…"
                    : payoutMethod === "store_credit"
                      ? "Accept as store credit"
                      : "Accept via PayPal"}
                </button>
                <button
                  type="button"
                  className="gg-btn gg-btn-ghost"
                  onClick={() => setActionStep(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {actionStep === "decline" && (
          <div className="gg-form" style={{ marginTop: "0.5rem" }}>
            <p style={{ color: "var(--gg-ink)" }}>
              Decline this offer? You're welcome to submit another collection anytime.
            </p>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                type="button"
                className="gg-btn"
                onClick={() => void submitResponse("declined")}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Yes, decline"}
              </button>
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                onClick={() => setActionStep(null)}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {actionStep === "counter" && (
          <form className="gg-form" style={{ marginTop: "0.5rem" }} onSubmit={submitCounter} noValidate>
            <div className="gg-field">
              <label htmlFor="counter-amount">Your counter-offer (USD)</label>
              <input
                id="counter-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                autoComplete="off"
                required
                value={counterInput}
                onChange={(e) => setCounterInput(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button className="gg-btn" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit counter-offer"}
              </button>
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                onClick={() => {
                  setActionStep(null);
                  setCounterInput("");
                }}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="gg-page" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", color: "var(--gg-ink)" }}>Respond to Your Offer</h1>
      <p className="gg-card-meta" style={{ textAlign: "center", marginTop: "-0.5rem" }}>
        Enter your reference number and the email you used when you submitted your collection.
      </p>
      <form className="gg-form" onSubmit={submit} noValidate>
        {notFound ? (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            We couldn&rsquo;t find an offer matching that reference number and email.
            Double-check both and try again, or{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                `Offer lookup help (${notFound.referenceNumber})`,
              )}&body=${encodeURIComponent(
                `Hi Geega Games,\n\nI'm trying to respond to an offer but couldn't find a match.\n\nReference number: ${notFound.referenceNumber}\nEmail: ${notFound.email}\n\n`,
              )}`}
            >
              contact us for help
            </a>
            .
          </div>
        ) : error ? (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {error}
          </div>
        ) : null}
        <div className="gg-field">
          <label htmlFor="offer-reference-number">Reference number</label>
          <input
            id="offer-reference-number"
            type="text"
            placeholder="GG-S-100042"
            autoComplete="off"
            required
            value={referenceNumberInput}
            onChange={(e) => setReferenceNumberInput(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="offer-email">Email</label>
          <input
            id="offer-email"
            type="email"
            autoComplete="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Looking up…" : "Find my offer"}
        </button>
      </form>
    </div>
  );
}
