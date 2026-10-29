import { useEffect, useState } from "react";
import { sendTrackingEvent, useTrackingAllowed } from "./pageViews";
import { newLocalId } from "./sellTypes";
import { FORM_STEPS, type TrackedForm } from "./formSteps";

// Seller form progress, for the admin Overview's "Seller forms: where people
// stop" (supabase/migrations/20261029060000_form_progress_tracking.sql).
//
// A form START is the first time a person taps or types in one of the form's
// fields — opening the page isn't one. From then on, the anonymous record for
// that start follows them: the furthest step reached, the last field they
// touched, how many photos they added, each press of the send button, the
// last error message the form showed them, and whether it was sent.
//
// What is sent: field and step NAMES (taken from the form's own labels) and
// our own error messages — never anything the person typed or picked. Same
// rules as page views (pageViews.ts): nothing for staff, Do Not Track,
// Global Privacy Control or automated browsers, and only real taps and
// keystrokes count (isTrusted).
//
// When things are sent: the start, every step change, every send attempt,
// error and success right away; the last field touched and the photo count
// ride along with the next of those, or go out when the person leaves the
// page, switches away from it, or the form goes away.

export { FORM_NAMES, FORM_STEPS, type TrackedForm } from "./formSteps";

const MAX_LABEL = 80;
const MAX_ERROR = 300;

/** Trimmed, single-spaced and capped. */
function tidy(text: string | null | undefined, max: number): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** The fields that make a form start: things a person types in or picks. Not buttons, not headings. */
const FIELD_SELECTOR = "input, select, textarea";

/**
 * An element's visible wording without any form controls inside it: a label
 * that wraps a text box would otherwise include what was typed in it, and
 * one that wraps a dropdown would include every option.
 */
function wording(el: Element | null | undefined): string | null {
  if (!el) return null;
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(`${FIELD_SELECTOR}, option, [aria-hidden="true"]`).forEach((n) => n.remove());
  return tidy(copy.textContent, MAX_LABEL);
}

/**
 * A field's NAME, as the person sees it — never its value: the field's own
 * <label>, a label it sits inside, its aria-label, or the question
 * (<legend>) of the group it belongs to, such as a row of choice chips.
 * Null for anything that isn't a visible form field (the hidden spam trap,
 * a heading the form focuses).
 */
export function fieldLabel(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || !target.matches(FIELD_SELECTOR)) return null;
  if (target.closest('[aria-hidden="true"]')) return null; // the spam trap
  if (target instanceof HTMLInputElement && target.type === "hidden") return null;

  const group = wording(target.closest("fieldset")?.querySelector("legend"));
  // A choice chip or radio: the question it answers says more than its option.
  const input = target instanceof HTMLInputElement ? target : null;
  if (input && (input.type === "checkbox" || input.type === "radio") && group) return group;

  const id = target.getAttribute("id");
  if (id) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
    const forLabel = wording(target.ownerDocument.querySelector(`label[for="${escaped}"]`));
    if (forLabel) return forLabel;
  }
  const wrapping = wording(target.closest("label"));
  if (wrapping) return wrapping;
  const aria = tidy(target.getAttribute("aria-label"), MAX_LABEL);
  if (aria) return aria;
  if (group) return group;
  if (input?.type === "file") return "Photos";
  return tidy(target.getAttribute("name"), MAX_LABEL);
}

interface TrackerState {
  id: string;
  started: boolean;
  step: number;
  field: string | null;
  photos: number;
  attempts: number;
  error: string | null;
  sent: boolean;
  /** Something changed since the last report. */
  dirty: boolean;
}

/**
 * The tracker itself, with no React in it (tests drive it directly).
 * Whether this visitor may be counted starts unknown; reports wait until
 * `setAllowed` says (true sends them, false drops them).
 */
export function createFormTracker(
  form: TrackedForm,
  options: {
    path: () => string;
    send?: (event: Record<string, unknown>) => void;
    newId?: () => string;
  },
) {
  const send = options.send ?? sendTrackingEvent;
  const steps = FORM_STEPS[form];
  const s: TrackerState = {
    id: (options.newId ?? newLocalId)(),
    started: false,
    step: 1,
    field: null,
    photos: 0,
    attempts: 0,
    error: null,
    sent: false,
    dirty: false,
  };
  // Whether this visitor may be counted (null: not known yet), and whether a
  // report is waiting for that answer.
  let allowed: boolean | null = null;
  let waiting = false;

  function report() {
    if (!s.started) return;
    if (allowed === null) {
      waiting = true;
      return;
    }
    waiting = false;
    s.dirty = false;
    if (!allowed) return;
    const event: Record<string, unknown> = {
      t: "f",
      id: s.id,
      f: form,
      p: options.path(),
      s: s.step,
      sl: steps[s.step - 1] ?? null,
      ph: s.photos,
      a: s.attempts,
      ok: s.sent,
    };
    if (s.field) event.fl = s.field;
    if (s.error) event.er = s.error;
    send(event);
  }

  return {
    /** The session id (tests). */
    get id() {
      return s.id;
    },
    /** A real tap or keystroke in a form field: starts the record, remembers the field. */
    touched(label: string | null) {
      if (!label) return;
      if (!s.started) {
        s.started = true;
        s.field = label;
        report();
        return;
      }
      if (label !== s.field) {
        s.field = label;
        s.dirty = true;
      }
    },
    /**
     * The form moved to `step` (1-based). Moving forward is something the
     * person did (pressed Next), so it also starts the record.
     */
    setStep(step: number) {
      const next = Math.max(1, Math.min(Math.round(step), steps.length));
      if (next === s.step) return;
      if (next > s.step) s.started = true;
      s.step = next;
      report();
    },
    /** How many photos the person has added (and not removed). */
    setPhotos(count: number) {
      const next = Math.max(0, Math.round(count));
      if (next === s.photos) return;
      s.photos = next;
      if (s.started) s.dirty = true;
    },
    /** The send button was pressed. */
    attempt() {
      s.started = true;
      s.attempts += 1;
      report();
    },
    /** The form showed this error message (our wording, never the person's input). */
    error(message: string) {
      const m = tidy(message, MAX_ERROR);
      if (!m) return;
      s.started = true;
      s.error = m;
      report();
    },
    /** It went through. */
    sent() {
      s.started = true;
      s.sent = true;
      report();
    },
    /** Send what's changed since the last report (leaving, switching away, unmounting). */
    flush() {
      if (s.dirty || waiting) report();
    },
    /** Whether this visitor may be counted; sends what was waiting for the answer. */
    setAllowed(value: boolean | null) {
      allowed = value;
      if (value !== null && waiting) report();
    },
  };
}

export type FormTracker = ReturnType<typeof createFormTracker>;

/**
 * Tracks one seller form. Spread `fieldEvents` on the <form> element(s);
 * pass the current step (1-based) and photo count; call `attempt`, `error`
 * and `sent` from the form's submit handling.
 */
export function useFormTracking(form: TrackedForm, { step = 1, photos = 0 }: { step?: number; photos?: number } = {}) {
  const allowed = useTrackingAllowed();
  const [tracker] = useState(() =>
    createFormTracker(form, {
      path: () => (typeof window === "undefined" ? "/" : window.location.pathname),
    }),
  );

  useEffect(() => tracker.setAllowed(allowed), [allowed, tracker]);

  useEffect(() => tracker.setStep(step), [step, tracker]);
  useEffect(() => tracker.setPhotos(photos), [photos, tracker]);

  // Leaving the page or switching away sends what's changed; so does the
  // form going away (moving to another page of the site).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") tracker.flush();
    };
    const onHide = () => tracker.flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      tracker.flush();
    };
  }, [tracker]);

  const onField = (e: React.SyntheticEvent) => {
    if (!e.nativeEvent.isTrusted) return; // scripted, not a person
    tracker.touched(fieldLabel(e.target));
  };

  return {
    fieldEvents: { onFocusCapture: onField, onChangeCapture: onField, onInputCapture: onField },
    attempt: () => tracker.attempt(),
    error: (message: string) => tracker.error(message),
    sent: () => tracker.sent(),
  };
}
