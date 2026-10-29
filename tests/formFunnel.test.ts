// The admin Overview's "Seller forms: where people stop" (src/admin/utils/formFunnel.ts).

import { describe, expect, it } from "vitest";
import { biggestDropOff, funnelStages } from "../src/admin/utils/formFunnel";
import { FORM_STEPS } from "../src/store/lib/formSteps";
import type { FormFunnel } from "../src/admin/types";

const quick = (over: Partial<FormFunnel> = {}): FormFunnel => ({
  form: "quick_quote",
  started: 14,
  attempted: 6,
  sent: 4,
  // 6 stopped on step 1; 8 reached step 2 (6 of them pressed send).
  stoppedAt: [
    { step: 1, sessions: 6 },
    { step: 2, sessions: 8 },
  ],
  ...over,
});

describe("seller form funnel", () => {
  it("counts how many people reached each stage", () => {
    expect(funnelStages(quick(), FORM_STEPS.quick_quote)).toEqual([
      { label: "Started", value: 14 },
      { label: "Step 2: Where to send your offer", value: 8 },
      { label: "Pressed send", value: 6 },
      { label: "Sent", value: 4 },
    ]);
  });

  it("gives the four-step form one bar per later step", () => {
    const sell: FormFunnel = {
      form: "sell",
      started: 5,
      attempted: 1,
      sent: 1,
      stoppedAt: [
        { step: 1, sessions: 3 },
        { step: 3, sessions: 1 },
        { step: 4, sessions: 1 },
      ],
    };
    expect(funnelStages(sell, FORM_STEPS.sell).map((s) => s.value)).toEqual([5, 2, 2, 1, 1, 1]);
  });

  it("names the step where the most people stopped", () => {
    expect(biggestDropOff(quick(), FORM_STEPS.quick_quote)).toBe(
      "Most stop at Step 1: What you're selling: 6 of 14 starts.",
    );
    // Lots of people reach step 2 but never press send.
    expect(
      biggestDropOff(
        quick({ attempted: 1, sent: 1, stoppedAt: [{ step: 1, sessions: 2 }, { step: 2, sessions: 12 }] }),
        FORM_STEPS.quick_quote,
      ),
    ).toBe("Most stop at Step 2: Where to send your offer: 11 of 14 starts.");
    // Pressing send and not getting through (errors) is called out too.
    expect(
      biggestDropOff(
        quick({ started: 4, attempted: 4, sent: 1, stoppedAt: [{ step: 2, sessions: 4 }] }),
        FORM_STEPS.quick_quote,
      ),
    ).toBe("Most stop after pressing send: 3 of 4 starts.");
  });

  it("says 'before pressing send' for the one-page partner-store form", () => {
    const referral: FormFunnel = { form: "referral", started: 3, attempted: 2, sent: 2, stoppedAt: [{ step: 1, sessions: 3 }] };
    expect(biggestDropOff(referral, FORM_STEPS.referral)).toBe("Most stop before pressing send: 1 of 3 starts.");
    expect(funnelStages(referral, FORM_STEPS.referral).map((s) => s.label)).toEqual(["Started", "Pressed send", "Sent"]);
  });

  it("says when everyone sent, and says nothing with no starts", () => {
    expect(biggestDropOff(quick({ started: 2, attempted: 2, sent: 2, stoppedAt: [{ step: 2, sessions: 2 }] }), FORM_STEPS.quick_quote)).toBe(
      "All 2 sent.",
    );
    expect(biggestDropOff(quick({ started: 0, attempted: 0, sent: 0, stoppedAt: [] }), FORM_STEPS.quick_quote)).toBeNull();
  });
});
