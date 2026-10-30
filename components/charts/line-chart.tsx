import { useId } from "react";
import { formatNaira, formatNairaCompact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { DayPoint } from "@/lib/services/reports";

// Sales vs payments received, per day: one shared naira axis (never two).
// The series differ by more than colour: sales is a solid gold line with
// round markers; payments is a dashed ink line with square markers. A
// legend names both, each line is labelled at its end, every day has a
// tooltip, and the data table carries every number.

const W = 640;
const H = 240;
const PAD = { top: 16, right: 92, bottom: 30, left: 56 };

export function SalesLineChart({ title, days }: { title: string; days: DayPoint[] }) {
  const id = useId().replace(/:/g, "");
  if (days.length < 2) return <p className="text-ink-2">Not enough days to draw a trend.</p>;

  const max = Math.max(...days.flatMap((d) => [d.salesKobo, d.paymentsKobo]), 1);
  const niceMax = niceCeil(max);
  const x = (i: number) => PAD.left + (i / (days.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / niceMax) * (H - PAD.top - PAD.bottom);
  const path = (pick: (d: DayPoint) => number) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * niceMax);
  const last = days.length - 1;
  const totalSales = days.reduce((s, d) => s + d.salesKobo, 0);
  const totalPaid = days.reduce((s, d) => s + d.paymentsKobo, 0);
  const lastSalesY = y(days[last]!.salesKobo);
  const lastPayY = y(days[last]!.paymentsKobo);
  // Keep the two end labels apart when the lines finish close together.
  const [salesLabelY, payLabelY] = Math.abs(lastSalesY - lastPayY) < 16
    ? lastSalesY <= lastPayY ? [lastSalesY - 8, lastPayY + 10] : [lastSalesY + 10, lastPayY - 8]
    : [lastSalesY, lastPayY];

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
        <li className="flex items-center gap-2">
          <svg width="28" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="28" y2="5" stroke="var(--gold)" strokeWidth="2.5" />
            <circle cx="14" cy="5" r="4" fill="var(--gold)" stroke="var(--page)" strokeWidth="2" />
          </svg>
          Sales (solid line)
        </li>
        <li className="flex items-center gap-2">
          <svg width="28" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="28" y2="5" stroke="var(--ink)" strokeWidth="2" strokeDasharray="5 4" />
            <rect x="10" y="1" width="8" height="8" fill="var(--ink)" stroke="var(--page)" strokeWidth="2" />
          </svg>
          Payments received (dashed line)
        </li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>
          {`From ${formatDate(days[0]!.date)} to ${formatDate(days[last]!.date)}: sales ${formatNaira(totalSales)}, payments received ${formatNaira(totalPaid)}. Daily numbers are in the table below.`}
        </desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-2)">
              {formatNairaCompact(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % 7 === 0 || i === last ? (
            <text key={d.date} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
              {formatDate(d.date).replace(/ \d{4}$/, "")}
            </text>
          ) : null,
        )}
        <path d={path((d) => d.paymentsKobo)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={path((d) => d.salesKobo)} fill="none" stroke="var(--gold)" strokeWidth="2.5" />
        {/* Hover targets: one wide invisible column per day with a tooltip. */}
        {days.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - (W - PAD.left - PAD.right) / (days.length - 1) / 2}
            y={PAD.top}
            width={(W - PAD.left - PAD.right) / (days.length - 1)}
            height={H - PAD.top - PAD.bottom}
            fill="transparent"
          >
            <title>{`${formatDate(d.date)}: sales ${formatNaira(d.salesKobo)}, payments ${formatNaira(d.paymentsKobo)}`}</title>
          </rect>
        ))}
        <circle cx={x(last)} cy={lastSalesY} r="4.5" fill="var(--gold)" stroke="var(--page)" strokeWidth="2" />
        <rect x={x(last) - 4} y={lastPayY - 4} width="8" height="8" fill="var(--ink)" stroke="var(--page)" strokeWidth="2" />
        <text x={x(last) + 10} y={salesLabelY + 4} fontSize="12" fontWeight="600" fill="var(--ink)">
          Sales
        </text>
        <text x={x(last) + 10} y={payLabelY + 4} fontSize="12" fontWeight="600" fill="var(--ink)">
          Payments
        </text>
      </svg>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Show as a table</summary>
        <div className="max-h-80 overflow-y-auto">
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">{title}, day by day</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-1 pr-3">Day</th>
                <th scope="col" className="num py-1 pr-3">Sales</th>
                <th scope="col" className="num py-1">Payments</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{formatDate(d.date)}</th>
                  <td className="num py-1 pr-3">{formatNaira(d.salesKobo)}</td>
                  <td className="num py-1">{formatNaira(d.paymentsKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Rounds an axis maximum up to 1, 2 or 5 x a power of ten (in naira). */
function niceCeil(kobo: number): number {
  const naira = kobo / 100;
  const power = 10 ** Math.floor(Math.log10(naira || 1));
  const step = [1, 2, 5, 10].find((m) => m * power >= naira) ?? 10;
  return step * power * 100;
}
