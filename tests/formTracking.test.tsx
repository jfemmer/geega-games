// @vitest-environment jsdom
//
// Seller form progress (src/store/lib/formTracking.ts): a start is the first
// real tap or keystroke in a field (or pressing Next); after that the record
// follows the person's furthest step, last field, photos, send attempts,
// errors shown and success — field NAMES only, never what was typed, and
// nothing at all for staff or visitors who opted out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  user: null as null | { app_metadata?: Record<string, unknown> },
  loading: false,
}));
const sent = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("../src/store/lib/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));
vi.mock("../src/store/lib/pageViews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/lib/pageViews")>();
  return { ...actual, sendTrackingEvent: (e: Record<string, unknown>) => sent.push(e) };
});

const { createFormTracker, fieldLabel, useFormTracking, FORM_STEPS } = await import("../src/store/lib/formTracking");

function tracker(send = (e: Record<string, unknown>) => sent.push(e)) {
  const t = createFormTracker("quick_quote", { path: () => "/sell-my-collection", send, newId: () => "id-1" });
  t.setAllowed(true);
  return t;
}

beforeEach(() => {
  sent.length = 0;
  auth.user = null;
  auth.loading = false;
});
afterEach(() => cleanup());

describe("the tracker", () => {
  it("sends nothing until the form is started, then follows steps, attempts, errors and success", () => {
    const t = tracker();
    t.setPhotos(2);
    expect(sent).toHaveLength(0);

    t.touched("What do you have? Pick any that fit.");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: "f", id: "id-1", f: "quick_quote", p: "/sell-my-collection", s: 1, sl: FORM_STEPS.quick_quote[0] });

    t.setStep(2);
    expect(sent.at(-1)).toMatchObject({ s: 2, sl: "Where to send your offer" });

    t.touched("Email");
    t.setPhotos(3);
    const before = sent.length;
    t.flush();
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)).toMatchObject({ fl: "Email", ph: 3 });

    t.attempt();
    t.error("Please confirm you own or are authorized to sell these items.");
    expect(sent.at(-1)).toMatchObject({ a: 1, er: "Please confirm you own or are authorized to sell these items.", ok: false });

    t.attempt();
    t.sent();
    expect(sent.at(-1)).toMatchObject({ a: 2, ok: true });
  });

  it("doesn't resend when nothing changed", () => {
    const t = tracker();
    t.touched("Email");
    t.touched("Email");
    t.flush();
    expect(sent).toHaveLength(1);
  });

  it("counts pressing Next as a start, but not the form opening on step 1", () => {
    const t = tracker();
    t.setStep(1);
    expect(sent).toHaveLength(0);
    t.setStep(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ s: 2 });
  });

  it("waits to learn whether the visitor may be counted, then sends or drops", () => {
    const later: Record<string, unknown>[] = [];
    const t = createFormTracker("sell", { path: () => "/sell", send: (e) => later.push(e) });
    t.touched("Card name");
    expect(later).toHaveLength(0);
    t.setAllowed(true);
    expect(later).toHaveLength(1);

    const dropped: Record<string, unknown>[] = [];
    const staff = createFormTracker("sell", { path: () => "/sell", send: (e) => dropped.push(e) });
    staff.touched("Card name");
    staff.setAllowed(false);
    staff.attempt();
    staff.sent();
    expect(dropped).toHaveLength(0);
  });
});

describe("field names", () => {
  it("uses the field's label or the question a chip answers — never what was typed or picked", () => {
    document.body.innerHTML = `
      <form>
        <fieldset><legend>About how many cards?</legend><label><input type="radio" name="size">Under 100</label></fieldset>
        <label for="em">Email</label><input id="em" value="jane@example.com">
        <label>Notes <textarea>my grandfather's binder</textarea></label>
        <label>Meet up or ship? <select><option>Ship my cards</option></select></label>
        <div aria-hidden="true"><label for="hp">Reference</label><input id="hp"></div>
        <input type="file" id="photos">
        <h3 tabindex="-1">Step 2</h3>
        <button>Next</button>
      </form>`;
    expect(fieldLabel(document.querySelector('input[type="radio"]'))).toBe("About how many cards?");
    expect(fieldLabel(document.getElementById("em"))).toBe("Email");
    expect(fieldLabel(document.querySelector("textarea"))).toBe("Notes");
    expect(fieldLabel(document.querySelector("select"))).toBe("Meet up or ship?");
    expect(fieldLabel(document.getElementById("photos"))).toBe("Photos");
    // The spam trap, a heading the form focuses, and buttons aren't fields.
    expect(fieldLabel(document.getElementById("hp"))).toBeNull();
    expect(fieldLabel(document.querySelector("h3"))).toBeNull();
    expect(fieldLabel(document.querySelector("button"))).toBeNull();
  });
});

function Form() {
  const tracking = useFormTracking("referral");
  return (
    <form {...tracking.fieldEvents}>
      <label htmlFor="first">First name</label>
      <input id="first" />
      <button type="button" onClick={() => tracking.attempt()}>
        Send
      </button>
    </form>
  );
}

describe("the hook", () => {
  it("ignores scripted events — only a real person's taps and keystrokes start a form", () => {
    const { getByLabelText } = render(<Form />);
    fireEvent.focus(getByLabelText("First name"));
    fireEvent.change(getByLabelText("First name"), { target: { value: "Jane" } });
    expect(sent).toHaveLength(0);
  });

  it("reports a send attempt for a visitor who may be counted", () => {
    const { getByText } = render(<Form />);
    act(() => getByText("Send").click());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: "f", f: "referral", s: 1, a: 1, ok: false });
    expect(String(sent[0].id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends nothing for staff", () => {
    auth.user = { app_metadata: { role: "admin" } };
    const { getByText } = render(<Form />);
    act(() => getByText("Send").click());
    expect(sent).toHaveLength(0);
  });

  it("sends what changed when the form goes away", () => {
    const { getByText, unmount } = render(<Form />);
    act(() => getByText("Send").click());
    const before = sent.length;
    unmount();
    // Nothing changed since the attempt: nothing more to send.
    expect(sent).toHaveLength(before);
  });
});
