import { US_REGIONS, usStateCode, type UsRegionGroup } from "../lib/usAddress";

// The State dropdown for a shipping address. It lists every place we ship
// (src/store/lib/usAddress.ts) and nothing else, so an address can't be given
// a state we don't deliver to. The value is the USPS code ("MO").

const GROUPS: { group: UsRegionGroup; label: string }[] = [
  { group: "state", label: "States" },
  { group: "territory", label: "US territories" },
  { group: "military", label: "Military (APO/FPO/DPO)" },
];

export function UsStateSelect({
  id,
  value,
  onChange,
  autoComplete = "address-level1",
  invalid = false,
  describedBy,
}: {
  id: string;
  /** A state code or name; anything else shows as nothing chosen. */
  value: string | null | undefined;
  /** Called with the USPS code, or "" when the choice is cleared. */
  onChange: (code: string) => void;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      className="gg-state-select"
      value={usStateCode(value) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      <option value="">Choose a state…</option>
      {GROUPS.map(({ group, label }) => (
        <optgroup key={group} label={label}>
          {US_REGIONS.filter((region) => region.group === group).map((region) => (
            <option key={region.code} value={region.code}>
              {group === "military" ? `${region.name} (${region.code})` : region.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
