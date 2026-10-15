import type { Backend } from "@rusuite/ui-shared";

// Placeholder wire types until the real ones are generated with a later task.
export type ShowRequest = { type: "ping" };
export type ShowResponseBody = { type: "pong" };

export type ShowBackend = Backend<ShowRequest, ShowResponseBody>;

/** Sends `{"type":"ping"}` to the core; true when it answers `pong`. */
export async function pingCore(backend: ShowBackend): Promise<boolean> {
  const reply = await backend.dispatch({ type: "ping" });
  return "ok" in reply && reply.ok.type === "pong";
}
