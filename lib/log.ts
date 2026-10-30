// Server logs: event names and ids only. Never log request bodies, customer
// details, amounts from AI tool results, tokens or keys.

export function logInfo(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}

export function logError(event: string, error: unknown, fields: Record<string, string | number | boolean | null> = {}): void {
  const e = error instanceof Error ? { name: error.name, message: error.message.slice(0, 300) } : { message: String(error).slice(0, 300) };
  console.error(JSON.stringify({ level: "error", event, ...fields, error: e }));
}
