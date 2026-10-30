// Money is integer kobo everywhere (₦1 = 100 kobo). Integers add, subtract
// and compare exactly; binary floats don't (0.1 + 0.2 !== 0.3), and a
// rounding error on an invoice is a real person's real money. Naira with
// decimals only exist at the edges: parsing what someone typed, and
// formatting for display. Both live here and nowhere else.

/** Largest amount we accept in one field: ₦10 billion. */
export const MAX_KOBO = 1_000_000_000_000;

export type ParseResult = { ok: true; kobo: number } | { ok: false; error: string };

const GROUPED = /^\d{1,3}(,\d{3})+$/; // 1,250 or 12,500,000
const PLAIN = /^\d+$/;

/**
 * Parses what a person typed ("₦1,250.50", "2000", "NGN 15,000") into kobo.
 * Strict on purpose: "1,25,0", "12.345", "-5", "1e3" and "2k" are errors, not
 * guesses, because a guessed amount on an invoice is worse than a message.
 */
export function parseNaira(input: string): ParseResult {
  let text = input.trim().replace(/\s+/g, " ");
  if (!text) return { ok: false, error: "Enter an amount." };
  text = text.replace(/^(₦|NGN|N)\s?/i, "");
  if (text.startsWith("-") || text.startsWith("−")) return { ok: false, error: "Amounts can't be negative." };

  const match = /^([\d,]+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    if (/^[\d,]+\.\d{3,}$/.test(text)) return { ok: false, error: "Use at most 2 decimal places (kobo)." };
    return { ok: false, error: "Enter an amount like 1,250 or 1250.50." };
  }
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (!(PLAIN.test(whole) || GROUPED.test(whole))) {
    return { ok: false, error: "Check the commas: use 1,250,000 or 1250000." };
  }
  const naira = Number(whole.replaceAll(",", ""));
  const kobo = naira * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(kobo) || kobo > MAX_KOBO) return { ok: false, error: "That amount is too large." };
  return { ok: true, kobo };
}

const grouping = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** 125050 -> "₦1,250.50"; -500 -> "−₦5.00". Uses integer maths only. */
export function formatNaira(kobo: number, options: { showKobo?: boolean } = {}): string {
  if (!Number.isSafeInteger(kobo)) throw new Error(`formatNaira expects integer kobo, got ${kobo}`);
  const sign = kobo < 0 ? "−" : "";
  const abs = Math.abs(kobo);
  const naira = Math.trunc(abs / 100);
  const rest = abs % 100;
  const showKobo = options.showKobo ?? true;
  const fraction = showKobo ? `.${String(rest).padStart(2, "0")}` : "";
  return `${sign}₦${grouping.format(naira)}${fraction}`;
}

/** For form inputs: 125050 -> "1250.50", 200000 -> "2000". */
export function koboToInput(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  const rest = kobo % 100;
  return rest === 0 ? String(naira) : `${naira}.${String(rest).padStart(2, "0")}`;
}

/** Chart labels: 1_520_000_00 -> "₦1.5m", 85_000_00 -> "₦85k". Display only. */
export function formatNairaCompact(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  const abs = Math.abs(naira);
  const sign = naira < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}₦${trimZero((abs / 1_000_000).toFixed(1))}m`;
  if (abs >= 1_000) return `${sign}₦${trimZero((abs / 1_000).toFixed(1))}k`;
  return `${sign}₦${abs}`;
}

const trimZero = (s: string) => s.replace(/\.0$/, "");

/** Sum without ever leaving integers (throws if a value isn't one). */
export function sumKobo(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new Error(`sumKobo expects integers, got ${v}`);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new Error("sumKobo overflowed");
  return total;
}
