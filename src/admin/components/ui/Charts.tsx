import { useId } from "react";
import type { NamedValue, TimeSeriesPoint } from "../../types";

/* ------------------------------ Line chart ------------------------------ */

interface LineChartProps {
  data: TimeSeriesPoint[];
  height?: number;
  /** Formats a point value for the accessible summary + tooltips. */
  format?: (value: number) => string;
  summaryLabel: string;
  color?: string;
}

export function LineChart({
  data,
  height = 200,
  format = (v) => String(v),
  summaryLabel,
  color = "var(--gg-brand)",
}: LineChartProps) {
  const gradId = useId();
  if (data.length === 0) {
    return <ChartEmpty />;
  }
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 22, left: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;

  const x = (i: number) => pad.left + (i / (data.length - 1 || 1)) * innerW;
  const y = (v: number) => pad.top + innerH - ((v - min) / span) * innerH;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `${linePath} L ${x(data.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} ` +
    `L ${x(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  const total = data.reduce((a, d) => a + d.value, 0);
  const first = data[0].value;
  const last = data[data.length - 1].value;

  return (
    <figure className="gg-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="gg-chart__svg"
        role="img"
        aria-label={`${summaryLabel}. ${data.length} points, total ${format(
          total,
        )}, from ${format(first)} to ${format(last)}.`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(d.value)}
            r={2.5}
            fill={color}
            opacity={i === data.length - 1 ? 1 : 0}
          >
            <title>
              {d.date}: {format(d.value)}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption className="gg-visually-hidden">
        {summaryLabel}: total {format(total)} across {data.length} days.
      </figcaption>
    </figure>
  );
}

/* ------------------------------ Bar chart ------------------------------ */

export function BarChart({
  data,
  format = (v) => String(v),
  summaryLabel,
  color = "var(--gg-brand)",
}: {
  data: NamedValue[];
  format?: (value: number) => string;
  summaryLabel: string;
  color?: string;
}) {
  if (data.length === 0) return <ChartEmpty />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div
      className="gg-barchart"
      role="img"
      aria-label={`${summaryLabel}: ${data
        .map((d) => `${d.label} ${format(d.value)}`)
        .join(", ")}.`}
    >
      {data.map((d) => (
        <div className="gg-barchart__row" key={d.label}>
          <span className="gg-barchart__label" title={d.label}>
            {d.label}
          </span>
          <span className="gg-barchart__track">
            <span
              className="gg-barchart__fill"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: color,
              }}
            />
          </span>
          <span className="gg-barchart__value">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Donut ------------------------------ */

const DONUT_COLORS = [
  "var(--gg-brand)",
  "var(--gg-gold)",
  "var(--gg-info)",
  "var(--gg-brand-deep)",
  "var(--gg-violet-grey)",
];

export function Donut({
  data,
  summaryLabel,
  unit = "",
}: {
  data: NamedValue[];
  summaryLabel: string;
  unit?: string;
}) {
  if (data.length === 0) return <ChartEmpty />;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  // Precompute each segment's dash length and cumulative offset without
  // mutating a variable during render.
  const segments = data.reduce<
    { d: NamedValue; dash: number; offset: number }[]
  >((acc, d) => {
    const dash = (d.value / total) * circ;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    acc.push({ d, dash, offset });
    return acc;
  }, []);
  return (
    <div className="gg-donut">
      <svg
        viewBox="0 0 140 140"
        className="gg-donut__svg"
        role="img"
        aria-label={`${summaryLabel}: ${data
          .map((d) => `${d.label} ${Math.round((d.value / total) * 100)}%`)
          .join(", ")}.`}
      >
        <g transform="translate(70,70) rotate(-90)">
          {segments.map(({ d, dash, offset }, i) => (
            <circle
              key={d.label}
              r={radius}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={16}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
            >
              <title>
                {d.label}: {Math.round((d.value / total) * 100)}%
              </title>
            </circle>
          ))}
        </g>
      </svg>
      <ul className="gg-donut__legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <span
              className="gg-donut__swatch"
              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="gg-donut__legend-label">{d.label}</span>
            <span className="gg-donut__legend-value">
              {Math.round((d.value / total) * 100)}%{unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="gg-chart-empty">
      <p>No data for this period yet.</p>
    </div>
  );
}
