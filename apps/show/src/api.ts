// Typed wrapper over `Backend.dispatch` for Show: one method per
// `Request` kind; every reply is checked against the `Response` union.

import type { Envelope } from "../../../packages/ui-shared/src/generated/Envelope";
import type { ShowBackend } from "./backend";
import type { Presentation } from "./generated/Presentation";
import type { Request } from "./generated/Request";
import type { ResponseBody } from "./generated/ResponseBody";
import type { ShowCommand } from "./generated/ShowCommand";
import type { ShowPatch } from "./generated/ShowPatch";

export type PatchEnvelope = Envelope<ShowPatch>;

/**
 * A failed call. `code` is the backend's `DispatchError.code`, or
 * `transport` (the backend threw) / `bad_response` (malformed reply).
 */
export class ShowApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ShowApiError";
  }
}

/**
 * Reply bodies of the file requests that arrive with P4-7 (not yet in the
 * generated `ResponseBody`); shaped like Write's `opened`/`saved`.
 */
export type FileBody =
  | { type: "opened"; presentation?: Presentation; warnings?: string[]; envelope?: PatchEnvelope }
  | { type: "saved"; bytesBase64: string; suggestedName: string };

type AnyBody = ResponseBody | FileBody;
export type BodyOf<T extends AnyBody["type"]> = Extract<AnyBody, { type: T }>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const SHAPES: Record<AnyBody["type"], Record<string, string>> = {
  patch: { envelope: "object" },
  presentation: { presentation: "object", envelope: "object" },
  media: { contentType: "string", bytesBase64: "string" },
  documentState: { dirty: "boolean", revision: "number" },
  opened: {},
  saved: { bytesBase64: "string", suggestedName: "string" },
};

/** Checks the shape of a reply and returns its body of the expected type. */
export function parseResponse<T extends AnyBody["type"]>(raw: unknown, expected: T): BodyOf<T> {
  if (!isObject(raw)) throw new ShowApiError("bad_response", `reply is not an object: ${JSON.stringify(raw)}`);
  const keys = Object.keys(raw);
  if (keys.length === 1 && keys[0] === "err") {
    const err = raw.err;
    if (isObject(err) && typeof err.code === "string" && typeof err.message === "string") {
      throw new ShowApiError(err.code, err.message);
    }
    throw new ShowApiError("bad_response", `malformed error reply: ${JSON.stringify(raw)}`);
  }
  if (keys.length !== 1 || keys[0] !== "ok" || !isObject(raw.ok)) {
    throw new ShowApiError("bad_response", `reply is neither ok nor err: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  const body = raw.ok;
  if (body.type !== expected) {
    throw new ShowApiError("bad_response", `expected a "${expected}" reply, got "${String(body.type)}"`);
  }
  for (const [field, kind] of Object.entries(SHAPES[expected])) {
    const value = body[field];
    const ok = kind === "object" ? isObject(value) : typeof value === kind;
    if (!ok) throw new ShowApiError("bad_response", `"${expected}" reply lacks "${field}"`);
  }
  if (expected === "patch" || expected === "presentation") {
    const env = body.envelope as Record<string, unknown>;
    if (typeof env.revision !== "number" || !isObject(env.patch)) {
      throw new ShowApiError("bad_response", "patch envelope lacks revision/patch");
    }
  }
  return body as BodyOf<T>;
}

/** The P4-7 file requests (not yet in the generated `Request`). */
type FileRequest = { type: "openPptx"; bytesBase64: string; name: string } | { type: "savePptx" };

/** One method per `Request` kind. */
export class ShowApi {
  /** Number of `apply` requests sent (for diagnostics). */
  commandCount = 0;

  constructor(readonly backend: ShowBackend) {}

  private async call<T extends AnyBody["type"]>(request: Request | FileRequest, expected: T): Promise<BodyOf<T>> {
    let raw: unknown;
    try {
      raw = await this.backend.dispatch(request as Request);
    } catch (e) {
      throw new ShowApiError("transport", e instanceof Error ? e.message : String(e));
    }
    return parseResponse(raw, expected);
  }

  async apply(command: ShowCommand): Promise<PatchEnvelope> {
    this.commandCount++;
    return (await this.call({ type: "apply", command }, "patch")).envelope;
  }

  async undo(): Promise<PatchEnvelope> {
    return (await this.call({ type: "undo" }, "patch")).envelope;
  }

  async redo(): Promise<PatchEnvelope> {
    return (await this.call({ type: "redo" }, "patch")).envelope;
  }

  load(presentation: Presentation): Promise<BodyOf<"presentation">> {
    return this.call({ type: "load", presentation }, "presentation");
  }

  getPresentation(): Promise<BodyOf<"presentation">> {
    return this.call({ type: "getPresentation" }, "presentation");
  }

  newPresentation(): Promise<BodyOf<"presentation">> {
    return this.call({ type: "newPresentation" }, "presentation");
  }

  getMedia(id: number): Promise<BodyOf<"media">> {
    return this.call({ type: "getMedia", id }, "media");
  }

  documentState(): Promise<BodyOf<"documentState">> {
    return this.call({ type: "documentState" }, "documentState");
  }

  markSaved(name?: string): Promise<BodyOf<"documentState">> {
    return this.call(name === undefined ? { type: "markSaved" } : { type: "markSaved", name }, "documentState");
  }

  /** Replaces the presentation by a `.pptx` file (P4-7). */
  openPptx(bytesBase64: string, name: string): Promise<BodyOf<"opened">> {
    return this.call({ type: "openPptx", bytesBase64, name }, "opened");
  }

  /** The presentation as `.pptx` (P4-7); does not mark it saved. */
  savePptx(): Promise<BodyOf<"saved">> {
    return this.call({ type: "savePptx" }, "saved");
  }
}
