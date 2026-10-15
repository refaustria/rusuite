import type { Backend } from "@rusuite/ui-shared";

// Placeholder wire types until the real ones are generated with P3-4.
export type WriteRequest = { type: "ping" };
export type WriteResponseBody = { type: "pong" };

export type WriteBackend = Backend<WriteRequest, WriteResponseBody>;

/** Sends `{"type":"ping"}` to the core; true when it answers `pong`. */
export async function pingCore(backend: WriteBackend): Promise<boolean> {
  const reply = await backend.dispatch({ type: "ping" });
  return "ok" in reply && reply.ok.type === "pong";
}
