import { useEffect, useRef, useState } from "react";
import { CollectionPhotoUpload, MAX_PHOTO_BYTES } from "./sell/CollectionPhotoUpload";
import { uploadSellPhoto } from "../lib/sellApi";
import { newLocalId, type SellPhoto } from "../lib/sellTypes";
import {
  REFERRAL_CATEGORIES,
  REFERRAL_CONTACT_METHODS,
  REFERRAL_HANDOFF_OPTIONS,
  REFERRAL_MAX_DESCRIPTION,
  REFERRAL_SIZE_OPTIONS,
  type ReferralCategory,
  type ReferralContactMethod,
} from "../lib/referralTypes";

// Lead form for Pokémon / One Piece / video game sellers (POST
// /api/referral-leads). Geega Games doesn't buy these itself — the consent
// checkbox says plainly that the details go to our buying partner, and the
// API refuses a lead without it.
//
// Photos reuse the sell flow's private-bucket upload (/api/sell/photo-uploads
// under a random draft id); the API only keeps paths Storage confirms exist.

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function ReferralLeadForm({
  category,
  descriptionPlaceholder,
  sourcePath,
}: {
  category: ReferralCategory;
  descriptionPlaceholder: string;
  sourcePath: string;
}) {
  const [draftId] = useState(newLocalId);
  const [categories, setCategories] = useState<ReferralCategory[]>([category]);
  const [description, setDescription] = useState("");
  const [size, setSize] = useState("");
  const [handoff, setHandoff] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactMethod, setContactMethod] = useState<ReferralContactMethod>("email");
  const [location, setLocation] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [photos, setPhotos] = useState<SellPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Free the photo previews' object URLs when the form goes away.
  const photosRef = useRef<SellPhoto[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  useEffect(() => {
    if (referenceNumber) resultRef.current?.focus();
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

  function toggleCategory(value: ReferralCategory) {
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (categories.length === 0) return setError("Please choose what you're selling.");
    if (!description.trim()) return setError("Please tell us a little about what you have.");
    if (!firstName.trim() || !isValidEmail(email)) {
      return setError("Please enter your first name and a valid email address.");
    }
    if (contactMethod !== "email" && !phone.trim()) {
      return setError("Please add a phone number, or choose email as your contact method.");
    }
    if (!consent) return setError("Please confirm we can share your details with our buying partner.");
    if (photos.some((p) => p.status === "uploading" || p.status === "pending")) {
      return setError("Your photos are still uploading — give it a moment and try again.");
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/referral-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories,
          description,
          size: size || undefined,
          handoff: handoff || undefined,
          contact: {
            firstName,
            lastName,
            email,
            phone,
            preferredContactMethod: contactMethod,
            location,
          },
          draftId,
          photos: photos.filter((p) => p.status === "uploaded" && p.uploadedPath).map((p) => ({ path: p.uploadedPath })),
          consent,
          sourcePath,
          website,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error((body && typeof body.message === "string" && body.message) || "Something went wrong. Please try again.");
      }
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      setReferenceNumber(String(body.referenceNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (referenceNumber) {
    return (
      <div className="gg-referral-done" ref={resultRef} tabIndex={-1} role="status">
        <h3>Thanks{firstName ? `, ${firstName}` : ""} — we got it!</h3>
        <p>
          We&rsquo;re passing your details to our buying partner, and they&rsquo;ll contact you
          directly to talk about an offer. We also emailed you a copy.
        </p>
        <p className="gg-card-meta">
          Your reference number: <strong>{referenceNumber}</strong>
        </p>
      </div>
    );
  }

  return (
    <form className="gg-referral-form" onSubmit={submit} noValidate>
      <fieldset className="gg-sellcheckgroup">
        <legend>What are you selling?</legend>
        <div className="gg-sellcheckgroup__grid">
          {REFERRAL_CATEGORIES.map((c) => (
            <label key={c.value} className="gg-check">
              <input
                type="checkbox"
                checked={categories.includes(c.value)}
                onChange={() => toggleCategory(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="gg-field">
        <label htmlFor="rl-description">Tell us about it</label>
        <textarea
          id="rl-description"
          rows={5}
          maxLength={REFERRAL_MAX_DESCRIPTION}
          placeholder={descriptionPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="rl-size">Roughly how much? (optional)</label>
          <select id="rl-size" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Select one</option>
            {REFERRAL_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="gg-field">
          <label htmlFor="rl-handoff">Meet up or ship?</label>
          <select id="rl-handoff" value={handoff} onChange={(e) => setHandoff(e.target.value)}>
            <option value="">Not sure yet</option>
            {REFERRAL_HANDOFF_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="gg-field">
        <span className="gg-referral-label">Photos (optional, but they help a lot)</span>
        <CollectionPhotoUpload
          photos={photos}
          onFilesSelected={addPhotos}
          onRemove={removePhoto}
          onRetry={retryPhoto}
        />
      </div>

      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="rl-first">First name</label>
          <input
            id="rl-first"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="rl-last">Last name (optional)</label>
          <input
            id="rl-last"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="rl-email">Email</label>
          <input
            id="rl-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="rl-phone">Phone (optional)</label>
          <input
            id="rl-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="gg-field gg-field-span2">
          <label htmlFor="rl-location">Where are you? City and state, or ZIP (optional)</label>
          <input
            id="rl-location"
            autoComplete="address-level2"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="gg-sellcheckgroup">
        <legend>Best way to reach you</legend>
        <div className="gg-sellcheckgroup__grid">
          {REFERRAL_CONTACT_METHODS.map((m) => (
            <label key={m.value} className="gg-check">
              <input
                type="radio"
                name="rl-contact-method"
                checked={contactMethod === m.value}
                onChange={() => setContactMethod(m.value)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Honeypot — hidden from people and screen readers. */}
      <div className="gg-referral-hp" aria-hidden="true">
        <label htmlFor="rl-website">Website</label>
        <input
          id="rl-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <label className="gg-check gg-referral-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I own these items (or am allowed to sell them), and I agree that Geega Games can share what
          I&rsquo;ve entered here — including my contact details and photos — with its buying
          partner so they can contact me about an offer.
        </span>
      </label>

      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="gg-btn" disabled={submitting}>
        {submitting ? "Sending…" : "Send to our buying partner"}
      </button>
    </form>
  );
}
