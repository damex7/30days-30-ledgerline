import { getApiContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { askRequestSchema } from "@/lib/ai/schemas";
import { ask, type AskEvent } from "@/lib/ai/runner";
import { errorResponse } from "@/lib/http";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { logError } from "@/lib/log";

// POST /api/assistant/ask  { question, clientRequestId }
// Streams newline-delimited JSON events: run, tool, text, done | error.
// The browser's Stop button aborts the request; request.signal then aborts
// the model call, and the run is still finished and logged as "interrupted"
// (we keep draining the generator after the client has gone).

export async function POST(request: Request) {
  let ctx;
  let input;
  try {
    ctx = await getApiContext();
    if (!can(ctx.role, "ai.ask")) throw new ForbiddenError();
    const body: unknown = await request.json().catch(() => null);
    const parsed = askRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid question.");
    input = parsed.data;
  } catch (error) {
    return errorResponse(error);
  }

  const encoder = new TextEncoder();
  const events = ask(ctx, input, { signal: request.signal, businessName: ctx.workspace.name });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AskEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        for await (const event of events) send(event);
      } catch (error) {
        logError("ask stream failed", error);
        send({ type: "error", status: "error", message: "Something went wrong. Please try again." });
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            // already closed by the client going away
          }
        }
      }
    },
    cancel() {
      // The client went away (Stop or navigation). The generator keeps
      // running to its end so the run is logged; request.signal aborts the model.
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
