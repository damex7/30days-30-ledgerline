import { useId } from "react";
import { formatNaira, formatNairaCompact } from "@/lib/money";

// Horizontal bar chart drawn as inline SVG (no chart library). Horizontal
// because the labels are product and customer names, which are long.
// Accessible by construction:
//   * role="img" with a title and a description naming the biggest value;
//   * every bar has a direct value label and a <title> tooltip;
//   * the gold fill carries a hatch pattern, so it reads in print, in forced
//     colours and without colour vision;
//   * the same numbers are always available as a real table below it.

export interface BarDatum {
  label: string;
  valueKobo: number;
  /** Extra text for the table, like "12 cartons". */
  note?: string;
}

export function BarChart({ title, data, valueHeader = "Amount" }: { title: string; data: BarDatum[]; valueHeader?: string }) {
  const id = useId().replace(/:/g, "");
  if (data.length === 0) return <p className="text-ink-2">Nothing to chart for this period.</p>;
  const max = Math.max(...data.map((d) => d.valueKobo), 1);
  const rowH = 34;
  const labelW = 0; // labels sit above each bar, so long names never collide
  const width = 600;
  const barMax = width - 110;
  const height = data.length * (rowH + 14) + 4;
  const top = data[0]!;

  return (
    <figure className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>
          {`${data.length} bars. Largest: ${top.label}, ${formatNaira(top.valueKobo)}. Full numbers in the table below.`}
        </desc>
        <defs>
          <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--gold)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--on-gold)" strokeOpacity="0.28" strokeWidth="2" />
          </pattern>
        </defs>
        {data.map((d, i) => {
          const y = i * (rowH + 14);
          const w = Math.max(3, (d.valueKobo / max) * barMax);
          return (
            <g key={d.label + i}>
              <title>{`${d.label}: ${formatNaira(d.valueKobo)}${d.note ? ` (${d.note})` : ""}`}</title>
              <text x={labelW} y={y + 13} fontSize="14" fill="var(--ink)">
                {d.label.length > 60 ? `${d.label.slice(0, 58)}…` : d.label}
              </text>
              <rect x={labelW} y={y + 19} width={w} height={rowH - 18} rx="4" fill={`url(#${id}-hatch)`} stroke="var(--gold)" />
              <text x={labelW + w + 8} y={y + 32} fontSize="14" fontWeight="600" fill="var(--ink)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNairaCompact(d.valueKobo)}
              </text>
            </g>
          );
        })}
      </svg>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Show as a table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b-2 border-ink text-left">
            <tr>
              <th scope="col" className="py-1 pr-3">Name</th>
              <th scope="col" className="num py-1">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label + i} className="border-b border-line">
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  {d.label}
                  {d.note ? <span className="text-ink-2"> · {d.note}</span> : null}
                </th>
                <td className="num py-1">{formatNaira(d.valueKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
