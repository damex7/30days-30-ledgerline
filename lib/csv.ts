// Tiny CSV writer (RFC 4180 quoting). Two safety details:
//  * money columns (ending in _kobo) are written as naira with 2 decimals,
//    computed with integer maths, so spreadsheets show 1250.50, not 125050;
//  * cells starting with = + - @ are prefixed with ' so a customer named
//    "=HYPERLINK(...)" can't become a live formula in Excel (CSV injection).

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function naira(kobo: unknown): string {
  const n = Number(kobo);
  if (!Number.isSafeInteger(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const header = cols.map((c) => cell(c.endsWith("_kobo") ? `${c.slice(0, -5)}_ngn` : c)).join(",");
  const body = rows.map((r) => cols.map((c) => (c.endsWith("_kobo") ? naira(r[c]) : cell(r[c]))).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
