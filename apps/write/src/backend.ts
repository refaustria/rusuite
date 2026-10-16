// Typed wrapper over `Backend.dispatch` for Write (ADR 0005 §4, ADR 0007 §7).
// Every reply is checked against the `Response` union before use.

import type { Backend } from "@rusuite/ui-shared";
import type { Envelope } from "../../../packages/ui-shared/src/generated/Envelope";
import type { Document } from "./generated/Document";
import type { FindQuery } from "./generated/FindQuery";
import type { Request } from "./generated/Request";
import type { ResponseBody } from "./generated/ResponseBody";
import type { WriteCommand } from "./generated/WriteCommand";
import type { WritePatch } from "./generated/WritePatch";

export type WriteBackend = Backend<Request, ResponseBody>;
export type PatchEnvelope = Envelope<WritePatch>;

/**
 * A failed call. `code` is the backend's `DispatchError.code`, or
 * `transport` (the backend threw) / `bad_response` (malformed reply).
 */
export class WriteApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WriteApiError";
  }
}

export type BodyOf<T extends ResponseBody["type"]> = Extract<ResponseBody, { type: T }>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks the shape of a reply and returns its body of the expected type. */
export function parseResponse<T extends ResponseBody["type"]>(raw: unknown, expected: T): BodyOf<T> {
  if (!isObject(raw)) throw new WriteApiError("bad_response", `reply is not an object: ${JSON.stringify(raw)}`);
  const keys = Object.keys(raw);
  if (keys.length === 1 && keys[0] === "err") {
    const err = raw.err;
    if (isObject(err) && typeof err.code === "string" && typeof err.message === "string") {
      throw new WriteApiError(err.code, err.message);
    }
    throw new WriteApiError("bad_response", `malformed error reply: ${JSON.stringify(raw)}`);
  }
  if (keys.length !== 1 || keys[0] !== "ok" || !isObject(raw.ok)) {
    throw new WriteApiError("bad_response", `reply is neither ok nor err: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  const body = raw.ok;
  if (body.type !== expected) {
    throw new WriteApiError("bad_response", `expected a "${expected}" reply, got "${String(body.type)}"`);
  }
  const shapes: Record<ResponseBody["type"], Record<string, string>> = {
    patch: { envelope: "object" },
    document: { doc: "object", envelope: "object" },
    opened: { doc: "object", warnings: "array", envelope: "object" },
    saved: { bytesBase64: "string", suggestedName: "string" },
    media: { contentType: "string", bytesBase64: "string" },
    documentState: { dirty: "boolean", revision: "number" },
    recoverySnapshot: { json: "string", revision: "number", dirty: "boolean" },
    blockIds: { ids: "array" },
    findMatches: { matches: "array", revision: "number" },
  };
  for (const [field, kind] of Object.entries(shapes[expected])) {
    const value = body[field];
    const ok = kind === "object" ? isObject(value) : kind === "array" ? Array.isArray(value) : typeof value === kind;
    if (!ok) {
      throw new WriteApiError("bad_response", `"${expected}" reply lacks "${field}"`);
    }
  }
  if (expected === "patch" || expected === "document" || expected === "opened") {
    const env = body.envelope as Record<string, unknown>;
    if (typeof env.revision !== "number" || !isObject(env.patch)) {
      throw new WriteApiError("bad_response", "patch envelope lacks revision/patch");
    }
  }
  return body as BodyOf<T>;
}

export type EditRequest = Extract<Request, { type: "apply" | "undo" | "redo" }>;

/** One method per `Request` kind. */
export class WriteApi {
  constructor(readonly backend: WriteBackend) {}

  private async call<T extends ResponseBody["type"]>(request: Request, expected: T): Promise<BodyOf<T>> {
    let raw: unknown;
    try {
      raw = await this.backend.dispatch(request);
    } catch (e) {
      throw new WriteApiError("transport", e instanceof Error ? e.message : String(e));
    }
    return parseResponse(raw, expected);
  }

  /** `apply`, `undo` or `redo` → the patch envelope. */
  async send(request: EditRequest): Promise<PatchEnvelope> {
    return (await this.call(request, "patch")).envelope;
  }

  apply(command: WriteCommand): Promise<PatchEnvelope> {
    return this.send({ type: "apply", command });
  }

  undo(): Promise<PatchEnvelope> {
    return this.send({ type: "undo" });
  }

  redo(): Promise<PatchEnvelope> {
    return this.send({ type: "redo" });
  }

  newDocument(): Promise<BodyOf<"document">> {
    return this.call({ type: "newDocument" }, "document");
  }

  load(document: Document): Promise<BodyOf<"document">> {
    return this.call({ type: "load", document }, "document");
  }

  getDocument(): Promise<BodyOf<"document">> {
    return this.call({ type: "getDocument" }, "document");
  }

  /** Replaces the document by a `.docx` file → document, reader warnings and envelope. */
  openDocx(bytesBase64: string, name: string): Promise<BodyOf<"opened">> {
    return this.call({ type: "openDocx", bytesBase64, name }, "opened");
  }

  /** The document as `.docx` (base64) plus the file name to offer. */
  saveDocx(stamp: { modified?: string; user?: string; pages?: number } = {}): Promise<BodyOf<"saved">> {
    return this.call({ type: "saveDocx", ...stamp }, "saved");
  }

  getMedia(id: number): Promise<BodyOf<"media">> {
    return this.call({ type: "getMedia", id }, "media");
  }

  documentState(): Promise<BodyOf<"documentState">> {
    return this.call({ type: "documentState" }, "documentState");
  }

  /** The whole document for crash recovery (P5-3). */
  recoverySnapshot(): Promise<BodyOf<"recoverySnapshot">> {
    return this.call({ type: "recoverySnapshot" }, "recoverySnapshot");
  }

  /** Replaces the document by a `recoverySnapshot` JSON (dirty; `name` = file name). */
  restoreRecovery(json: string, name: string | null): Promise<BodyOf<"document">> {
    return this.call({ type: "restoreRecovery", json, name: name ?? undefined }, "document");
  }

  /** The paragraphs using style `id` (Select All N Instances). */
  blocksWithStyle(id: string): Promise<BodyOf<"blockIds">> {
    return this.call({ type: "blocksWithStyle", id }, "blockIds");
  }

  /** Matches of a search with formatting / wildcards (body paragraphs). */
  find(query: FindQuery): Promise<BodyOf<"findMatches">> {
    return this.call({ type: "find", query }, "findMatches");
  }

  /** The author of new comments for this document (not an edit). */
  setUser(name: string, initials?: string): Promise<BodyOf<"documentState">> {
    return this.call({ type: "setUser", name, initials: initials || undefined }, "documentState");
  }

  markSaved(name?: string): Promise<BodyOf<"documentState">> {
    return this.call({ type: "markSaved", name: name ?? null }, "documentState");
  }
}
