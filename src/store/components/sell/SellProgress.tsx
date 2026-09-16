const STEPS = ["What you're selling", "Collection details", "Your info", "Review & submit"];

export function SellProgress({ step }: { step: number }) {
  return (
    <ol className="gg-progress" aria-label="Submission progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`gg-progress-step ${i < step ? "gg-done" : ""} ${i === step ? "gg-current" : ""}`}
          aria-current={i === step ? "step" : undefined}
        >
          <span className="gg-progress-dot" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}
