import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../../../supabase";
import { Link } from "../../lib/router";
import { useAuth } from "../../lib/AuthContext";
import { useReveal } from "../../lib/useReveal";
import { formatCents } from "../../lib/money";
import { submitSortingRequest, type SortingOption, type SortingRequestPayload } from "../../lib/sortingApi";
import {
  SORTING_ACCOUNT_PATH,
  SORTING_DELIVERY_LABELS,
  SORTING_LIMITS,
  SORTING_SHIPPING_TERMS,
  formatRatePerThousand,
} from "../../lib/sortingService";
import ReturnAddressFields from "./ReturnAddressFields";
import {
  EMPTY_RETURN_ADDRESS,
  checkReturnAddress,
  estimateFor,
  useSavedAddresses,
  type ReturnAddressState,
  type SortingPlan,
} from "../../lib/sortingForm";

// The collection sorting request form. It takes the option, card count and
// drop-off / shipping choice from the calculator above it (the page owns
// that state), adds the customer's details and — for a shipped collection —
// the return address (saved addresses for signed-in customers, like
// checkout) and the required shipping-terms checkbox, then sends it to
// /api/sorting-requests, which re-checks everything.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function SortingRequestForm({
  options,
  plan,
  onEditPlan,
}: {
  options: SortingOption[];
  plan: SortingPlan;
  /** Take the customer back to the calculator to change their choices. */
  onEditPlan: () => void;
}) {
  const { user } = useAuth();
  const { addresses: saved } = useSavedAddresses(user?.id ?? null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // null until the customer types: a signed-in customer's own email is offered.
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  // "" = not chosen yet: the default saved address, or the form when there's none.
  const [returnAddress, setReturnAddress] = useState<ReturnAddressState>({ ...EMPTY_RETURN_ADDRESS, selected: "" });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRef, revealError] = useReveal<HTMLParagraphElement>();
  const [done, setDone] = useState<{ referenceNumber: string; firstName: string; shipped: boolean } | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const { option, cards, sortingCents } = estimateFor(plan, options);
  const shipped = plan.delivery === "ship";
  const effectiveAddress: ReturnAddressState = {
    ...returnAddress,
    selected: returnAddress.selected || (saved[0]?.id ?? "new"),
  };
  const emailValue = email ?? user?.email ?? "";

  const fail = (message: string) => {
    setError(message);
    revealError();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!option || !cards || !plan.delivery) {
      return fail("Choose a sorting option, enter about how many cards you have, and pick drop-off or shipping above.");
    }
    if (!firstName.trim() || !lastName.trim() || !isValidEmail(emailValue)) {
      return fail("Please enter your first name, last name and a valid email address.");
    }

    let returnAddressId: string | null = null;
    let typedAddress: SortingRequestPayload["returnAddress"] = null;
    if (shipped) {
      const check = checkReturnAddress(effectiveAddress, saved);
      if (!check.ok) return fail(check.message);
      if (!termsAccepted) return fail("Please tick the box to confirm you understand the shipping terms.");
      returnAddressId = check.savedId;
      typedAddress = check.address;
    }

    setSubmitting(true);
    try {
      // Signed in and typed a new address: save it to their address book, the
      // way checkout does, and send the saved copy.
      if (shipped && user && typedAddress && effectiveAddress.saveToBook) {
        const { data, error: saveErr } = await supabase
          .from("addresses")
          .insert({
            user_id: user.id,
            recipient: typedAddress.recipient,
            line1: typedAddress.line1,
            line2: typedAddress.line2 || null,
            city: typedAddress.city,
            state: typedAddress.state,
            postal_code: typedAddress.postalCode,
            country: "US",
            is_default: saved.length === 0,
          })
          .select("id")
          .single();
        // Not being able to save it to the book doesn't stop the request.
        if (!saveErr && data?.id) returnAddressId = data.id as string;
      }
      const res = await submitSortingRequest({
        optionId: option.id,
        estimatedCards: cards,
        deliveryMethod: plan.delivery,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailValue.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        returnAddressId,
        returnAddress: returnAddressId ? null : typedAddress,
        shippingTermsAccepted: shipped ? termsAccepted : false,
        website,
      });
      setDone({ referenceNumber: res.referenceNumber, firstName: firstName.trim(), shipped });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="gg-referral-done" ref={doneRef} tabIndex={-1} role="status">
        <h3>Thanks{done.firstName ? `, ${done.firstName}` : ""} — we got your request!</h3>
        <p>What happens next:</p>
        <ol className="gg-referral-next">
          {done.shipped ? (
            <>
              <li>
                We&rsquo;ll email you when we&rsquo;re ready for your cards, with the address to ship them to.
                Please wait for that email before sending anything.
              </li>
              <li>Pack your cards securely and ship them to us — you cover the supplies, postage and any insurance.</li>
              <li>We count and sort your collection, then email your complete quote: sorting, return shipping and packaging.</li>
              <li>Approve and pay your quote, and we ship your sorted collection back.</li>
            </>
          ) : (
            <>
              <li>We&rsquo;ll get in touch to set up a time and place to drop off your cards in the St. Louis area.</li>
              <li>We count and sort your collection, then email your final quote to approve.</li>
              <li>Pay online or when you pick up your sorted collection.</li>
            </>
          )}
        </ol>
        <p>We also emailed you a copy.</p>
        <p className="gg-card-meta">
          Your reference number: <strong>{done.referenceNumber}</strong>
        </p>
        {user && (
          <p className="gg-card-meta">
            Follow it any time in <Link to={SORTING_ACCOUNT_PATH}>your account</Link>.
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="gg-referral-form gg-sort-form" onSubmit={submit} noValidate>
      <div className="gg-sort-summary">
        <div className="gg-sort-summary__rows">
          <span>
            <strong>{option ? option.name : "No sorting option chosen yet"}</strong>
            {option ? ` · ${formatRatePerThousand(option.ratePerThousandCents)}` : ""}
          </span>
          <span>
            {cards ? `About ${cards.toLocaleString("en-US")} cards` : "Card count not entered yet"}
            {plan.delivery ? ` · ${SORTING_DELIVERY_LABELS[plan.delivery]}` : ""}
          </span>
          {sortingCents !== null && (
            <span>
              Sorting estimate: <strong>{formatCents(sortingCents)}</strong>
              {shipped ? " + return shipping & packaging (pending final shipping quote)" : ""}
            </span>
          )}
        </div>
        <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={onEditPlan}>
          {option && cards && plan.delivery ? "Change" : "Choose in the calculator"}
        </button>
      </div>

      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="sort-first">First name</label>
          <input id="sort-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="sort-last">Last name</label>
          <input id="sort-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="sort-email">Email</label>
          <input
            id="sort-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={emailValue}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="sort-phone">Phone (optional)</label>
          <input id="sort-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <div className="gg-field">
        <label htmlFor="sort-notes">Anything we should know? (optional)</label>
        <textarea
          id="sort-notes"
          rows={3}
          maxLength={SORTING_LIMITS.maxCustomerNotes}
          placeholder="e.g. how you'd like it sorted, cards to set aside, or a date you need it back by."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {shipped && (
        <fieldset className="gg-sort-fieldset">
          <legend>Where should we ship it back?</legend>
          <ReturnAddressFields value={effectiveAddress} onChange={setReturnAddress} saved={saved} signedIn={!!user} />
        </fieldset>
      )}

      {/* Honeypot — hidden from people and screen readers. */}
      <div className="gg-referral-hp" aria-hidden="true">
        <label htmlFor="sort-website">Website</label>
        <input id="sort-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {shipped && (
        <label className="gg-check gg-referral-consent">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            required
            aria-required="true"
          />
          <span>{SORTING_SHIPPING_TERMS}</span>
        </label>
      )}

      {error && (
        <p className="gg-alert gg-alert-error" role="alert" ref={errorRef}>
          {error}
        </p>
      )}

      <p className="gg-referral-assure">
        Free to request — you only pay once you&rsquo;ve approved your final quote.
      </p>

      <button type="submit" className="gg-btn" disabled={submitting}>
        {submitting ? "Sending…" : "Send my sorting request"}
      </button>
    </form>
  );
}
