import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { rememberClaim } from "../lib/guestClaims";
import { useSEO } from "../lib/useSEO";
import { supabase } from "../../supabase";
import { SellProgress } from "../components/sell/SellProgress";
import { SellCardSearch } from "../components/sell/SellCardSearch";
import { SellCardList } from "../components/sell/SellCardList";
import { BulkListInput } from "../components/sell/BulkListInput";
import { CollectionPhotoUpload, MAX_PHOTO_BYTES } from "../components/sell/CollectionPhotoUpload";
import { CollectionDetails } from "../components/sell/CollectionDetails";
import { SellerContactForm } from "../components/sell/SellerContactForm";
import { SellReview } from "../components/sell/SellReview";
import { emptyDraft, loadDraft, saveDraft, clearDraft } from "../lib/sellDraft";
import { submitSellForm, uploadSellPhoto } from "../lib/sellApi";
import {
  cardPhotoRequirementMet,
  conditionNeedsPhotos,
  defaultConditionForReleaseDate,
  newLocalId,
  type SellCardLine,
  type SellDraft,
  type SellPhoto,
  type SellPrinting,
} from "../lib/sellTypes";

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const TOTAL_STEPS = 4;

// Manually searching for and adding an exact printing (as opposed to a
// pasted/CSV line — see SellCardLine.rawInput, which stays null here and
// only here) is the one path where we can confidently apply an age-based
// default condition rather than assuming Near Mint.
function printingToCardLine(p: SellPrinting): SellCardLine {
  return {
    localId: newLocalId(),
    scryfallId: p.scryfallId,
    cardName: p.cardName,
    setCode: p.setCode,
    setName: p.setName,
    collectorNumber: p.collectorNumber,
    imageUrl: p.imageUrl,
    condition: defaultConditionForReleaseDate(p.releasedAt),
    finish: p.availableFinishes[0] ?? "nonfoil",
    quantity: 1,
    scryfallPriceCents: p.scryfallPriceCents,
    sellerNotes: "",
    matchStatus: "matched",
    rawInput: null,
    releasedAt: p.releasedAt,
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function SellPage() {
  useSEO({
    title: "Sell Your Magic: The Gathering Cards Online — St. Louis & the Midwest | Geega Games",
    description:
      "Get an offer for your Magic: The Gathering cards or collection. Based near St. Louis, MO, we buy from sellers within about a 6-hour drive — Missouri, Illinois, Kentucky, Indiana, Tennessee, Arkansas, Kansas, Iowa, and Oklahoma.",
    path: "/sell",
  });

  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SellDraft>(() => loadDraft() ?? emptyDraft());
  const [photos, setPhotos] = useState<SellPhoto[]>([]);
  const [honeypot, setHoneypot] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ referenceNumber: string } | null>(null);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  // Prefill from the signed-in user's profile — never overwrites something
  // already typed. Guests never see this; they aren't required to sign in.
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (!active) return;
        setDraft((d) => ({
          ...d,
          contact: {
            ...d.contact,
            firstName: d.contact.firstName || profile?.first_name || "",
            lastName: d.contact.lastName || profile?.last_name || "",
            email: d.contact.email || user.email || "",
            phone: d.contact.phone || profile?.phone || "",
          },
        }));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateContact(patch: Partial<SellDraft["contact"]>) {
    setDraft((d) => ({ ...d, contact: { ...d.contact, ...patch } }));
  }
  function updateCollection(patch: Partial<SellDraft["collection"]>) {
    setDraft((d) => ({ ...d, collection: { ...d.collection, ...patch } }));
  }
  function addCards(lines: SellCardLine[]) {
    setDraft((d) => ({ ...d, cards: [...d.cards, ...lines] }));
  }
  function updateCard(localId: string, patch: Partial<SellCardLine>) {
    setDraft((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    }));
  }
  function removeCard(localId: string) {
    setDraft((d) => ({ ...d, cards: d.cards.filter((c) => c.localId !== localId) }));
    // Any photo attached specifically to this card is meaningless once the
    // card itself is gone — drop it too, rather than silently uploading and
    // submitting an orphaned photo tagged with a card that no longer exists.
    setPhotos((prev) => {
      const [orphaned, kept] = [
        prev.filter((p) => p.cardLocalId === localId),
        prev.filter((p) => p.cardLocalId !== localId),
      ];
      orphaned.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return kept;
    });
  }

  function startUpload(photo: SellPhoto) {
    setPhotos((prev) =>
      prev.map((p) => (p.localId === photo.localId ? { ...p, status: "uploading" } : p)),
    );
    uploadSellPhoto(draft.draftId, photo)
      .then((path) => {
        setPhotos((prev) =>
          prev.map((p) => (p.localId === photo.localId ? { ...p, status: "uploaded", uploadedPath: path } : p)),
        );
      })
      .catch((err: unknown) => {
        setPhotos((prev) =>
          prev.map((p) =>
            p.localId === photo.localId
              ? { ...p, status: "error", errorMessage: err instanceof Error ? err.message : "Upload failed" }
              : p,
          ),
        );
      });
  }

  function handleFilesSelected(
    files: File[],
    cardLocalId: string | null = null,
    side: "front" | "back" | null = null,
  ) {
    const additions: SellPhoto[] = files.map((file) => {
      if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
        return {
          localId: newLocalId(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          errorMessage: "Unsupported file type",
          originalFilename: file.name,
          cardLocalId,
          side,
        };
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return {
          localId: newLocalId(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "error",
          errorMessage: "File is larger than 15 MB",
          originalFilename: file.name,
          cardLocalId,
          side,
        };
      }
      return {
        localId: newLocalId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
        originalFilename: file.name,
        cardLocalId,
        side,
      };
    });
    setPhotos((prev) => [...prev, ...additions]);
    additions.filter((p) => p.status === "pending").forEach(startUpload);
  }

  // Each of the two slots (front/back) holds exactly one photo — selecting a
  // replacement drops whatever was already in that slot first.
  function setCardPhotoSlot(cardLocalId: string, side: "front" | "back", file: File) {
    setPhotos((prev) => {
      const existing = prev.find((p) => p.cardLocalId === cardLocalId && p.side === side);
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return prev.filter((p) => !(p.cardLocalId === cardLocalId && p.side === side));
    });
    handleFilesSelected([file], cardLocalId, side);
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

  function goNext() {
    if (step === 2) {
      if (!draft.contact.firstName.trim() || !draft.contact.lastName.trim() || !isValidEmail(draft.contact.email)) {
        setContactError("Please enter your first name, last name, and a valid email address.");
        return;
      }
    }
    setContactError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const photosStillUploading = photos.some((p) => p.status === "uploading");

  // A card needs photo proof whenever its claimed condition is better than
  // what its age would suggest (or is claimed Near Mint outright) — see
  // conditionNeedsPhotos. Applies regardless of how the card was entered
  // (search, pasted list, or CSV): a typed-in condition claim is no less a
  // claim than one picked from the dropdown, and skipping this check for
  // pasted/CSV cards would just be a bypass for anyone who wants one. Blocks
  // submission until BOTH a front and back photo for that card have
  // finished uploading.
  const cardsMissingRequiredPhotos = draft.cards.filter(
    (c) =>
      conditionNeedsPhotos(c.condition, defaultConditionForReleaseDate(c.releasedAt)) &&
      !cardPhotoRequirementMet(photos, c.localId),
  );

  async function handleSubmit() {
    if (!draft.agreedToTerms) {
      setSubmitError("Please confirm you own or are authorized to sell these items before submitting.");
      return;
    }
    if (cardsMissingRequiredPhotos.length > 0) {
      setSubmitError(
        "Please add front and back photos for the cards where you changed the condition before submitting — see above.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const uploaded = photos.filter((p) => p.status === "uploaded" && p.uploadedPath);
      const res = await submitSellForm({
        draftId: draft.draftId,
        hp_ref: honeypot,
        contact: draft.contact,
        collection: draft.collection,
        cards: draft.cards,
        photos: uploaded.map((p) => ({
          path: p.uploadedPath!,
          originalFilename: p.originalFilename,
          cardLocalId: p.cardLocalId,
          side: p.side,
        })),
        agreedToTerms: draft.agreedToTerms,
      });
      if (!res.ok) {
        setSubmitError(res.message ?? "Something went wrong. Please try again.");
        return;
      }
      clearDraft();
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      if (res.claim) rememberClaim({ kind: "sell", id: res.claim.id, token: res.claim.token });
      setResult({ referenceNumber: res.referenceNumber! });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="gg-page gg-prose gg-sellsuccess">
        <h1>We received your collection!</h1>
        <p>
          Thanks for giving Geega Games the opportunity to look at your cards. We&rsquo;ll review the
          information you submitted and contact you using your preferred contact method.
        </p>
        <div className="gg-sellsuccess__ref">
          <span className="gg-card-meta">Your reference number</span>
          <strong>{result.referenceNumber}</strong>
          <p className="gg-card-meta">Save this for your records.</p>
        </div>
        {!user && (
          <div className="gg-sellsuccess__account">
            <strong>Follow this submission with a free account</strong>
            <p className="gg-card-meta">
              See its status and your offer any time, and get store credit worth 20% more than
              a PayPal payout. We&rsquo;ll link this submission to your account automatically.
            </p>
            <Link to="/signup?next=/account/sell-submissions" className="gg-btn gg-btn-ghost gg-btn-sm">
              Create a free account
            </Link>{" "}
            <Link to="/login?next=/account/sell-submissions" className="gg-card-meta">
              or sign in
            </Link>
          </div>
        )}
        <p>
          <Link to="/shop" className="gg-btn">
            Continue shopping
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="gg-page gg-sell">
      {step === 0 && (
        <>
          <section className="gg-sellhero">
            <h1>Sell Your Magic Cards to Geega Games</h1>
            <p>
              Have a full collection — binders, boxes, or bags of cards? You don&rsquo;t need to
              know what any of it is or enter cards one at a time. Just upload a few photos and
              tell us about it; we&rsquo;ll handle the rest.
            </p>
            <p className="gg-card-meta">
              Selling a specific handful of cards instead? You can search and add them
              individually further down.
            </p>
            <p className="gg-card-meta">
              Based near St. Louis and buying from sellers within about a 6-hour drive — but
              shipping in works from anywhere, near or far.
            </p>
          </section>

          <section className="gg-sellsteps">
            <div className="gg-sellsteps__item">
              <strong>1. Tell us what you have</strong>
              <p>Upload photos of a full collection, search individual cards, paste/upload a list, or a combination.</p>
            </div>
            <div className="gg-sellsteps__item">
              <strong>2. We review your collection</strong>
              <p>We review the cards, printings, condition information, photos, and collection details.</p>
            </div>
            <div className="gg-sellsteps__item">
              <strong>3. We contact you</strong>
              <p>We reach out to discuss the collection, ask questions if needed, and go over next steps.</p>
            </div>
          </section>
          <p className="gg-alert gg-alert-warn">
            Submitting this form does not automatically constitute an offer or agreement to
            purchase — we review every submission individually.
          </p>
        </>
      )}

      <SellProgress step={step} />

      {step === 0 && (
        <div className="gg-sellstep">
          <h2>What are you selling?</h2>
          <p className="gg-card-meta">
            Use one, some, or all of the options below — whatever&rsquo;s easiest for what you
            have.
          </p>

          <div className="gg-sellsection gg-sellsection--featured">
            <h3>
              Have a full collection? Upload photos <span className="gg-badge">No card entry needed</span>
            </h3>
            <p className="gg-card-meta">
              Don&rsquo;t know Magic cards well, or have thousands to go through? Skip typing
              anything in — just upload photos of binders, boxes, decks, sealed items, or an
              overview of the whole collection, and add any notes you have in the next step.
            </p>
            <CollectionPhotoUpload
              photos={photos.filter((p) => p.cardLocalId == null)}
              onFilesSelected={(files) => handleFilesSelected(files)}
              onRemove={removePhoto}
              onRetry={retryPhoto}
            />
          </div>

          <div className="gg-sellsection">
            <h3>Selling specific cards? Search and add them</h3>
            <p className="gg-card-meta">
              Know exactly which cards you have? Add them below to help us review your submission
              faster.
            </p>
            <SellCardSearch onSelect={(p) => addCards([printingToCardLine(p)])} />
          </div>

          <div className="gg-sellsection">
            <h3>Or paste a card list</h3>
            <BulkListInput onAddCards={addCards} onUpdateCard={updateCard} />
          </div>

          <SellCardList
            cards={draft.cards}
            onUpdate={updateCard}
            onRemove={removeCard}
            onRematch={(id, p) => updateCard(id, { ...printingToCardLine(p), localId: id })}
            photos={photos}
            onSelectCardPhoto={setCardPhotoSlot}
            onRemoveCardPhoto={removePhoto}
            onRetryCardPhoto={retryPhoto}
          />
        </div>
      )}

      {step === 1 && (
        <div className="gg-sellstep">
          <h2>Tell us about the collection</h2>
          <CollectionDetails value={draft.collection} onChange={updateCollection} />
        </div>
      )}

      {step === 2 && (
        <div className="gg-sellstep">
          <h2>Your contact information</h2>
          {contactError && (
            <div className="gg-alert gg-alert-error" role="alert">
              {contactError}
            </div>
          )}
          <SellerContactForm value={draft.contact} onChange={updateContact} />
        </div>
      )}

      {step === 3 && (
        <div className="gg-sellstep">
          <h2>Review &amp; submit</h2>
          <SellReview
            contact={draft.contact}
            collection={draft.collection}
            cards={draft.cards}
            photos={photos}
            onEditStep={setStep}
          />

          {photosStillUploading && (
            <p className="gg-alert gg-alert-warn" role="status">
              Please wait for your photos to finish uploading before submitting.
            </p>
          )}

          {submitError && (
            <div className="gg-alert gg-alert-error" role="alert">
              {submitError}
            </div>
          )}

          {/* Honeypot: hidden from real users via CSS, real sellers never fill it. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="sell-hp">Leave this field blank</label>
            <input
              id="sell-hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <label className="gg-check" style={{ marginTop: "1rem" }}>
            <input
              type="checkbox"
              checked={draft.agreedToTerms}
              onChange={(e) => setDraft((d) => ({ ...d, agreedToTerms: e.target.checked }))}
            />
            I confirm that I own these items or am authorized to sell them, and I understand that
            submitting this form does not guarantee an offer or purchase.
          </label>

          <div className="gg-sellstep__nav">
            <button type="button" className="gg-btn gg-btn-ghost" onClick={goBack} disabled={submitting}>
              Back
            </button>
            <button
              type="button"
              className="gg-btn"
              onClick={handleSubmit}
              disabled={
                submitting ||
                photosStillUploading ||
                !draft.agreedToTerms ||
                cardsMissingRequiredPhotos.length > 0
              }
            >
              {submitting ? "Submitting…" : "Submit my collection"}
            </button>
          </div>
        </div>
      )}

      {step < 3 && (
        <div className="gg-sellstep__nav">
          {step > 0 && (
            <button type="button" className="gg-btn gg-btn-ghost" onClick={goBack}>
              Back
            </button>
          )}
          <button type="button" className="gg-btn" onClick={goNext}>
            {step === 0 ? "Start Your Submission" : "Continue"}
          </button>
        </div>
      )}
    </div>
  );
}
