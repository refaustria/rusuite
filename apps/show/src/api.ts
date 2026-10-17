// Typed wrapper over `Backend.dispatch` for Show: one method per
// `Request` kind; every reply is checked against the `Response` union.

import type { ViewState } from "./generated/ViewState";
import type { ViewKind } from "./generated/ViewKind";
import type { Envelope } from "../../../packages/ui-shared/src/generated/Envelope";
import type { ShowBackend } from "./backend";
import type { BuiltinTheme } from "./generated/BuiltinTheme";
import type { PathQuery } from "./generated/PathQuery";
import type { Presentation } from "./generated/Presentation";
import type { Request } from "./generated/Request";
import type { ResponseBody } from "./generated/ResponseBody";
import type { ShowCommand } from "./generated/ShowCommand";
import type { ShapePaths } from "./generated/ShapePaths";
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

export type BodyOf<T extends ResponseBody["type"]> = Extract<ResponseBody, { type: T }>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const SHAPES: Record<ResponseBody["type"], Record<string, string>> = {
  patch: { envelope: "object" },
  presentation: { presentation: "object", envelope: "object" },
  media: { contentType: "string", bytesBase64: "string" },
  documentState: { dirty: "boolean", revision: "number" },
  recoverySnapshot: { json: "string", revision: "number", dirty: "boolean" },
  opened: { presentation: "object", envelope: "object" },
  saved: { bytesBase64: "string", suggestedName: "string" },
  shapePaths: {},
  themes: {},
  peeked: { presentation: "object" },
};

/** Checks the shape of a reply and returns its body of the expected type. */
export function parseResponse<T extends ResponseBody["type"]>(raw: unknown, expected: T): BodyOf<T> {
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

/** One method per `Request` kind. */
export class ShowApi {
  /** Number of `apply` requests sent (for diagnostics). */
  commandCount = 0;

  constructor(readonly backend: ShowBackend) {}

  private async call<T extends ResponseBody["type"]>(request: Request, expected: T): Promise<BodyOf<T>> {
    let raw: unknown;
    try {
      raw = await this.backend.dispatch(request);
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

  /** Replaces the presentation by a `recoverySnapshot` JSON (crash recovery, P5-3; dirty). */
  restoreRecovery(json: string, name: string | null): Promise<BodyOf<"presentation">> {
    return this.call({ type: "restoreRecovery", json, name: name ?? undefined }, "presentation");
  }

  markSaved(name?: string): Promise<BodyOf<"documentState">> {
    return this.call(name === undefined ? { type: "markSaved" } : { type: "markSaved", name }, "documentState");
  }

  /** Replaces the presentation by a `.pptx` file. */
  openPptx(bytesBase64: string, name: string): Promise<BodyOf<"opened">> {
    return this.call({ type: "openPptx", bytesBase64, name }, "opened");
  }

  /** Outlines and connection sites of shapes (P8-14), one entry per query. */
  async shapePaths(queries: PathQuery[]): Promise<ShapePaths[]> {
    const body = await this.call({ type: "shapePaths", queries }, "shapePaths");
    if (!Array.isArray(body.shapes) || body.shapes.length !== queries.length) {
      throw new ShowApiError("bad_response", "shapePaths reply has the wrong number of entries");
    }
    return body.shapes;
  }

  /** The built-in themes in gallery order (Design › Themes). */
  async getThemes(): Promise<BuiltinTheme[]> {
    const body = await this.call({ type: "getThemes" }, "themes");
    if (!Array.isArray(body.themes)) throw new ShowApiError("bad_response", "themes reply lacks themes");
    return body.themes;
  }

  /** Reads another `.pptx` without opening it (Reuse Slides). */
  peekPresentation(bytesBase64: string): Promise<BodyOf<"peeked">> {
    return this.call({ type: "peekPresentation", bytesBase64 }, "peeked");
  }

  /** The presentation as `.pptx` with the view it is shown in as `lastView` and the window state (zoom, panes; no undo step); does not mark it saved. */
  savePptx(lastView?: ViewKind, viewState?: ViewState): Promise<BodyOf<"saved">> {
    return this.call({ type: "savePptx", ...(lastView ? { lastView } : {}), ...(viewState ? { viewState } : {}) }, "saved");
  }
}
