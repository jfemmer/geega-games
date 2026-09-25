import { useEffect, useRef, useState } from "react";
import { CollectionPhotoUpload, MAX_PHOTO_BYTES } from "./sell/CollectionPhotoUpload";
import { submitSellForm, uploadSellPhoto } from "../lib/sellApi";
import { rememberClaim } from "../lib/guestClaims";
import { emptyCollection, newLocalId, type SellContactInfo, type SellPhoto } from "../lib/sellTypes";

// One-screen "send photos, get an offer" form for Magic sellers — the way most
// collection buyers quote now (seller research, 2026-09-25). It creates a
// normal Sell Your Cards submission through /api/sell/submit (tagged
// source = "quick_quote"), so it lands in the admin Buying Leads queue and
// uses the same offer flow as the full /sell form. Sellers who want to list
// cards one by one still use /sell.

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

type Handoff = SellContactInfo["transactionPreference"];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function QuickPhotoQuote({ defaultHandoff = "not_sure" }: { defaultHandoff?: Handoff }) {
  const [draftId] = useState(newLocalId);
  const [photos, setPhotos] = useState<SellPhoto[]>([]);
  const [description, setDescription] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactMethod, setContactMethod] = useState<SellContactInfo["preferredContactMethod"]>("email");
  const [zip, setZip] = useState("");
  const [handoff, setHandoff] = useState<Handoff>(defaultHandoff);
  const [agreed, setAgreed] = useState(false);
  const [hpRef, setHpRef] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  // Free the photo previews' object URLs when the form goes away.
  const photosRef = useRef<SellPhoto[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  useEffect(() => {
    if (referenceNumber) doneRef.current?.focus();
  }, [referenceNumber]);

  function startUpload(photo: SellPhoto) {
    setPhotos((prev) => prev.map((p) => (p.localId === photo.localId ? { ...p, status: "uploading" } : p)));
    uploadSellPhoto(draftId, photo)
      .then((path) =>
        setPhotos((prev) =>
          prev.map((p) => (p.localId === photo.localId ? { ...p, status: "uploaded", uploadedPath: path } : p)),
        ),
      )
      .catch((err: unknown) =>
        setPhotos((prev) =>
          prev.map((p) =>
            p.localId === photo.localId
              ? { ...p, status: "error", errorMessage: err instanceof Error ? err.message : "Upload failed" }
              : p,
          ),
        ),
      );
  }

  function addPhotos(files: File[]) {
    const additions: SellPhoto[] = files.map((file) => {
      const problem = !ACCEPTED_PHOTO_TYPES.has(file.type)
        ? "Unsupported file type"
        : file.size > MAX_PHOTO_BYTES
          ? "File is larger than 15 MB"
          : null;
      return {
        localId: newLocalId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: problem ? "error" : "pending",
        errorMessage: problem ?? undefined,
        originalFilename: file.name,
        cardLocalId: null,
        side: null,
      };
    });
    setPhotos((prev) => [...prev, ...additions]);
    additions.filter((p) => p.status === "pending").forEach(startUpload);
  }

  function removePhoto(localId: string) {
    setPhotos((prev) => {
      const found = prev.find((p) => p.localId === localId);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  function retryPhoto(localId: string) {
    const photo = photos.find((p) => p.localId === localId);
    if (photo) startUpload(photo);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uploaded = photos.filter((p) => p.status === "uploaded" && p.uploadedPath);
    if (uploaded.length === 0 && !description.trim()) {
      return setError("Add a few photos or a short description of what you have.");
    }
    if (photos.some((p) => p.status === "uploading" || p.status === "pending")) {
      return setError("Your photos are still uploading — give it a moment and try again.");
    }
    if (!firstName.trim() || !lastName.trim() || !isValidEmail(email)) {
      return setError("Please enter your first name, last name and a valid email address.");
    }
    if (contactMethod !== "email" && !phone.trim()) {
      return setError("Please add a phone number, or choose email as your contact method.");
    }
    if (!agreed) return setError("Please confirm you own or are authorized to sell these items.");

    setSubmitting(true);
    try {
      const res = await submitSellForm({
        draftId,
        hp_ref: hpRef,
        contact: {
          firstName,
          lastName,
          email,
          phone,
          preferredContactMethod: contactMethod,
          city: "",
          state: "",
          zip,
          transactionPreference: handoff,
        },
        collection: { ...emptyCollection(), notes: description },
        cards: [],
        photos: uploaded.map((p) => ({ path: p.uploadedPath!, originalFilename: p.originalFilename })),
        agreedToTerms: agreed,
        source: "quick_quote",
      });
      if (!res.ok) throw new Error(res.message);
      if (res.claim) rememberClaim({ kind: "sell", id: res.claim.id, token: res.claim.token });
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      setReferenceNumber(res.referenceNumber ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (referenceNumber !== null) {
    return (
      <div className="gg-referral-done" ref={doneRef} tabIndex={-1} role="status">
        <h3>Thanks{firstName ? `, ${firstName}` : ""} — we got it!</h3>
        <p>
          We&rsquo;ll look over your photos and get back to you using your preferred contact method.
          We also emailed you a copy.
        </p>
        {referenceNumber && (
          <p className="gg-card-meta">
            Your reference number: <strong>{referenceNumber}</strong>
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="gg-referral-form" onSubmit={submit} noValidate>
      <div className="gg-field">
        <span className="gg-referral-label">Photos of your cards</span>
        <CollectionPhotoUpload
          photos={photos}
          onFilesSelected={addPhotos}
          onRemove={removePhoto}
          onRetry={retryPhoto}
        />
        <p className="gg-card-meta">
          Binder pages, the tops of boxes, and close-ups of anything you think is valuable all help.
        </p>
      </div>

      <div className="gg-field">
        <label htmlFor="qq-description">Anything we should know? (optional if you added photos)</label>
        <textarea
          id="qq-description"
          rows={3}
          maxLength={4000}
          placeholder="e.g. Two binders from the 2000s, a box of bulk and a few Commander decks."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="qq-first">First name</label>
          <input id="qq-first" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="qq-last">Last name</label>
          <input id="qq-last" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="qq-email">Email</label>
          <input id="qq-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="qq-phone">Phone (optional)</label>
          <input id="qq-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="qq-zip">ZIP code (optional)</label>
          <input
            id="qq-zip"
            autoComplete="postal-code"
            inputMode="numeric"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="qq-handoff">Meet up or ship?</label>
          <select id="qq-handoff" value={handoff} onChange={(e) => setHandoff(e.target.value as Handoff)}>
            <option value="not_sure">Not sure yet</option>
            <option value="local">Meet up in person</option>
            <option value="ship">Ship my cards</option>
            <option value="either">Either works</option>
          </select>
        </div>
      </div>

      <fieldset className="gg-sellcheckgroup">
        <legend>Best way to reach you</legend>
        <div className="gg-sellcheckgroup__grid">
          {(
            [
              ["email", "Email"],
              ["phone", "Phone call"],
              ["text", "Text"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="gg-check">
              <input
                type="radio"
                name="qq-contact-method"
                checked={contactMethod === value}
                onChange={() => setContactMethod(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Honeypot — hidden from people and screen readers. */}
      <div className="gg-referral-hp" aria-hidden="true">
        <label htmlFor="qq-ref">Reference</label>
        <input id="qq-ref" tabIndex={-1} autoComplete="off" value={hpRef} onChange={(e) => setHpRef(e.target.value)} />
      </div>

      <label className="gg-check gg-referral-consent">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I confirm that I own these items or am authorized to sell them, and I understand that
          submitting this form does not guarantee an offer or purchase.
        </span>
      </label>

      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="gg-btn" disabled={submitting}>
        {submitting ? "Sending…" : "Get my offer"}
      </button>
    </form>
  );
}
