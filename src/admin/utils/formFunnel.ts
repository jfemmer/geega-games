import type { FormFunnel, NamedValue } from "../types";

// Turns admin_form_funnel()'s counts ("how many starts got no further than
// step N") into the funnel the Overview draws: how many people reached each
// stage, and where the most people stopped.

/** How many starts reached `step` or beyond. */
function reached(funnel: FormFunnel, step: number): number {
  return funnel.stoppedAt.filter((s) => s.step >= step).reduce((sum, s) => sum + s.sessions, 0);
}

/**
 * Started → each later step → pressed send → sent. Step 1 is the same as
 * "started", so it isn't repeated. `stepNames` are the form's steps in order.
 */
export function funnelStages(funnel: FormFunnel, stepNames: readonly string[]): NamedValue[] {
  const stages: NamedValue[] = [{ label: "Started", value: funnel.started }];
  stepNames.forEach((name, i) => {
    if (i === 0) return;
    stages.push({ label: `Step ${i + 1}: ${name}`, value: reached(funnel, i + 1) });
  });
  stages.push({ label: "Pressed send", value: funnel.attempted });
  stages.push({ label: "Sent", value: funnel.sent });
  return stages;
}

/**
 * The stage where the most people stopped, in words — "8 of 14 stopped at
 * Step 2: Where to send your offer" — or null with nothing to say.
 */
export function biggestDropOff(funnel: FormFunnel, stepNames: readonly string[]): string | null {
  if (funnel.started === 0) return null;
  const notSent = funnel.started - funnel.sent;
  if (notSent === 0) return `All ${funnel.started} sent.`;

  // People who stopped on each step without pressing send; then people who
  // pressed send but it didn't go through (an error, or they gave up).
  const candidates: { label: string; count: number }[] = [];
  const lastStep = stepNames.length;
  for (const { step, sessions } of funnel.stoppedAt) {
    // On the last step, only those who never pressed send stopped "there".
    const count = step === lastStep ? Math.max(0, sessions - funnel.attempted) : sessions;
    // A one-page form has no steps to name: they stopped before pressing send.
    const label = lastStep <= 1 ? "before pressing send" : `at Step ${step}: ${stepNames[step - 1] ?? "?"}`;
    if (count > 0) candidates.push({ label, count });
  }
  const pressedNotSent = funnel.attempted - funnel.sent;
  if (pressedNotSent > 0) candidates.push({ label: "after pressing send", count: pressedNotSent });
  if (candidates.length === 0) return null;

  const top = candidates.reduce((a, b) => (b.count > a.count ? b : a));
  return `Most stop ${top.label}: ${top.count} of ${funnel.started} start${funnel.started === 1 ? "" : "s"}.`;
}
