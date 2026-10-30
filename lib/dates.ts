// Calendar dates for a Nigerian business. Lagos is UTC+1 all year (no
// daylight saving), so "today" and "this week" are computed in that zone,
// not the server's (Vercel runs in UTC, where 00:30 in Lagos is yesterday).
// Dates travel as "YYYY-MM-DD" strings: a date has no time or zone to get wrong.

export const TIME_ZONE = "Africa/Lagos";
const OFFSET_MS = 60 * 60 * 1000;

export type IsoDate = string; // "2026-10-30"

export function todayInLagos(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Monday-based week start. */
export function startOfWeek(date: IsoDate): IsoDate {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const d = new Date(`${startOfMonth(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Inclusive date range. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

export const RANGE_PRESETS = ["today", "this_week", "this_month", "last_month", "last_7_days", "last_30_days"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export function resolvePreset(preset: RangePreset, today: IsoDate = todayInLagos()): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today, label: `today (${formatDate(today)})` };
    case "this_week":
      return { from: startOfWeek(today), to: today, label: `this week (${formatDate(startOfWeek(today))} – ${formatDate(today)})` };
    case "this_month":
      return { from: startOfMonth(today), to: today, label: `this month (${formatDate(startOfMonth(today))} – ${formatDate(today)})` };
    case "last_month": {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end, label: `last month (${formatDate(startOfMonth(end))} – ${formatDate(end)})` };
    }
    case "last_7_days":
      return { from: addDays(today, -6), to: today, label: `the last 7 days (${formatDate(addDays(today, -6))} – ${formatDate(today)})` };
    case "last_30_days":
      return { from: addDays(today, -29), to: today, label: `the last 30 days (${formatDate(addDays(today, -29))} – ${formatDate(today)})` };
  }
}

const dateFormat = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

/** "2026-10-30" -> "30 Oct 2026". */
export function formatDate(date: IsoDate): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** A timestamp's calendar date in Lagos. */
export function lagosDateOf(date: Date): IsoDate {
  return todayInLagos(date);
}
