// "Share on WhatsApp": a wa.me link that opens WhatsApp with the message
// typed in. The person presses send themselves; the app never messages
// customers on its own.

/** Nigerian numbers: 0803... becomes 234803...; +234... stays. */
export function waNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) digits = `234${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(number: string | null | undefined, message: string): string {
  const n = waNumber(number);
  const text = encodeURIComponent(message);
  return n ? `https://wa.me/${n}?text=${text}` : `https://wa.me/?text=${text}`;
}
