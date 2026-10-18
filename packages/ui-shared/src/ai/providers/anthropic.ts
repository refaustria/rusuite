// Anthropic Messages API (`POST /v1/messages`, streamed as server-sent events) called from the browser / webview
// with the user's own key: `x-api-key`, `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access:
// true` (Anthropic's opt-in for browser calls: the key is the user's own and stays on their device).
// Structured results use tool use: one strict tool, `tool_choice: auto` (the 5.5 models reject forced tool choice)
// and an instruction to call it; the client validates the input again (`schemas.ts`).

import type { AiEffort, AiMessage, AiProvider, AiRequest, AiTool, Delta, ModelInfo } from "../types";
import { AiError } from "../types";
import { aiFetch, errorFromResponse, markUnsupported, parseToolJson, rejectedParam, sseEvents, unsupportedParams, type FetchLike } from "./http";

/** Optional parameters dropped (and retried once) when a model rejects them with a 400. */
export const ANTHROPIC_OPTIONAL = ["fallbacks", "temperature", "tool_choice", "thinking", "output_config"] as const;

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
];

/** Models that still take `temperature` (Claude 4.7+ and the 5.x models reject sampling parameters). */
export function acceptsTemperature(model: string): boolean {
  return /^claude-(3|instant|2|(opus|sonnet|haiku)-(4-[0-6]|4(?!-)|3))/.test(model);
}

/** Models with Anthropic's server-side refusal fallback (`fallbacks: "default"`). */
export function supportsFallback(model: string): boolean {
  return /^claude-(opus-5(-5)?|sonnet-5-5|fable-5(-1)?)$/.test(model);
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The base id of a model (`claude-opus-4-5-20251101` → `claude-opus-4-5`; the 4.6+ / 5.x ids have no date). */
const baseId = (model: string) => model.replace(/-\d{8}$/, "");

/** Thinking cannot be turned off (`{type:"disabled"}` returns a 400): the lowest setting is effort `low`. */
const ALWAYS_THINKING = new Set(["claude-opus-5-5", "claude-fable-5", "claude-fable-5-1", "claude-mythos-5", "claude-mythos-5-1"]);
/** Thinking off is `{type:"between_tools"}` (`disabled` returns a 400). */
const BETWEEN_TOOLS = new Set(["claude-sonnet-5-5"]);
/** Take `{type:"disabled"}` (at effort high or below, which is all this setting uses). */
const DISABLEABLE = new Set(["claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"]);

/** Models with adaptive thinking and `output_config.effort` (Claude 4.6+ and the 5.x family). */
export function supportsEffort(model: string): boolean {
  const id = baseId(model);
  return ALWAYS_THINKING.has(id) || BETWEEN_TOOLS.has(id) || DISABLEABLE.has(id);
}

/**
 * The request fields for a reasoning effort (docs/ai-api-notes.md §4):
 * - low / medium / high → `thinking: {type: "adaptive", display: "summarized"}` (the summary is streamed to the
 *   panel; the 5.x default `display` is "omitted") and `output_config: {effort}`;
 * - off → `{type: "between_tools"}` on Sonnet 5.5, `{type: "disabled"}` where accepted, and effort `low` on the
 *   models whose thinking cannot be disabled (Opus 5.5, Fable);
 * - other models (Claude 3.x, 4.0–4.5, unknown ids): nothing – their defaults apply.
 */
export function reasoningParams(model: string, effort: AiEffort | undefined): { thinking?: Record<string, unknown>; output_config?: Record<string, unknown> } {
  if (!effort || !supportsEffort(model)) return {};
  const id = baseId(model);
  if (effort !== "off") return { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } };
  if (BETWEEN_TOOLS.has(id)) return { thinking: { type: "between_tools" } };
  if (ALWAYS_THINKING.has(id)) return { output_config: { effort: "low" } };
  return { thinking: { type: "disabled" } };
}

/** A message's content: a string, or image blocks (base64) followed by the text blocks. */
export function anthropicContent(m: AiMessage): string | Record<string, unknown>[] {
  if (typeof m.content === "string") return m.content;
  return m.content.map((p) =>
    p.type === "image"
      ? { type: "image", source: { type: "base64", media_type: p.image.mediaType, data: p.image.data } }
      : { type: "text", text: p.text },
  );
}

/**
 * The system prompt: a plain string, or – with the whole document – two text blocks, the document first and marked
 * `cache_control: { type: "ephemeral" }` (5-minute cache, refreshed on every hit), then the instructions. The
 * document comes first so that actions with other instructions still share its cached prefix (tools come before
 * the system prompt, so structured actions only share it among themselves). Below the model's minimum (512 tokens
 * on the 5.x models) the API silently caches nothing.
 */
export function anthropicSystem(req: AiRequest): string | Record<string, unknown>[] {
  if (!req.documentContext) return req.system;
  return [
    { type: "text", text: req.documentContext, cache_control: { type: "ephemeral" } },
    { type: "text", text: req.system },
  ];
}

export function anthropicBody(req: AiRequest, official: boolean, skip: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: anthropicSystem(req),
    messages: req.messages.map((m) => ({ role: m.role, content: anthropicContent(m) })),
    stream: true,
  };
  const reasoning = reasoningParams(req.model, req.effort);
  Object.assign(body, reasoning);
  // Thinking requires the default temperature on the models that still take one.
  const thinking = (reasoning.thinking?.type ?? "") === "adaptive";
  if (req.temperature !== undefined && acceptsTemperature(req.model) && !thinking) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t: AiTool) => ({ name: t.name, description: t.description, input_schema: t.schema, strict: true }));
    body.tool_choice = { type: "auto" };
  }
  if (official && supportsFallback(req.model)) body.fallbacks = "default";
  for (const p of skip) delete body[p];
  return body;
}

/**
 * A Messages API `usage` object → a usage delta. `message_start` carries the input side (`input_tokens` = the
 * uncached part, `cache_read_input_tokens`, `cache_creation_input_tokens`); `message_delta` the cumulative
 * `output_tokens` (and, on newer API versions, the input fields again – then they replace the earlier ones).
 */
export function usageDelta(u: Record<string, unknown>, start: boolean): Delta {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const plain = n(u.input_tokens);
  const read = n(u.cache_read_input_tokens);
  const write = n(u.cache_creation_input_tokens);
  const out: Delta & { type: "usage" } = { type: "usage" };
  if (start || plain !== undefined || read !== undefined || write !== undefined) {
    if (start || plain !== undefined) out.inputTokens = (plain ?? 0) + (read ?? 0) + (write ?? 0);
    if (start || read !== undefined) out.cacheReadTokens = read ?? 0;
    if (start || write !== undefined) out.cacheWriteTokens = write ?? 0;
  }
  const o = n(u.output_tokens);
  if (o !== undefined || start) out.outputTokens = o ?? 0;
  return out;
}

interface Block {
  type: string;
  id?: string;
  name?: string;
  json: string;
}

/** Deltas of a Messages API event stream. */
export async function* anthropicDeltas(events: AsyncIterable<{ event: string; data: string }>): AsyncGenerator<Delta> {
  const blocks = new Map<number, Block>();
  let stop: string | null = null;
  for await (const ev of events) {
    if (ev.event === "ping" || !ev.data) continue;
    let d: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      d = JSON.parse(ev.data);
    } catch {
      throw new AiError("badResponse", "The provider sent an unreadable stream");
    }
    switch (d.type ?? ev.event) {
      case "message_start": {
        const m = d.message ?? {};
        if (typeof m.model === "string") yield { type: "model", model: m.model };
        yield usageDelta(m.usage ?? {}, true);
        break;
      }
      case "content_block_start": {
        const b = d.content_block ?? {};
        blocks.set(d.index, { type: b.type, id: b.id, name: b.name, json: "" });
        if (b.type === "text" && b.text) yield { type: "text", text: b.text };
        else if (b.type === "thinking" && b.thinking) yield { type: "thinking", text: b.thinking };
        break;
      }
      case "content_block_delta": {
        const delta = d.delta ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string") yield { type: "text", text: delta.text };
        else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) yield { type: "thinking", text: delta.thinking };
        else if (delta.type === "input_json_delta") {
          const b = blocks.get(d.index);
          if (b) b.json += delta.partial_json ?? "";
        }
        break;
      }
      case "content_block_stop": {
        const b = blocks.get(d.index);
        if (b?.type === "tool_use") yield { type: "toolUse", id: b.id ?? "", name: b.name ?? "", input: parseToolJson(b.json) };
        break;
      }
      case "message_delta": {
        if (d.delta?.stop_reason) stop = d.delta.stop_reason;
        if (d.usage && typeof d.usage === "object") yield usageDelta(d.usage, false);
        break;
      }
      case "message_stop":
        yield { type: "stop", reason: stop ?? "end_turn" };
        return;
      case "error": {
        const e = d.error ?? {};
        const msg = typeof e.message === "string" ? e.message : "stream error";
        if (e.type === "overloaded_error") throw new AiError("overloaded", `Anthropic is overloaded – try again shortly (${msg})`, 529);
        if (e.type === "rate_limit_error") throw new AiError("rateLimit", `Anthropic: rate limit reached (${msg})`, 429);
        if (e.type === "authentication_error") throw new AiError("auth", `Anthropic rejected the API key (${msg})`, 401);
        throw new AiError("server", `Anthropic: ${msg}`);
      }
      default:
        break;
    }
  }
  if (stop) yield { type: "stop", reason: stop };
  else throw new AiError("network", "The answer ended early (connection closed)");
}

export class AnthropicProvider implements AiProvider {
  readonly kind = "anthropic" as const;
  readonly name = "Anthropic";
  readonly origin: string;
  private readonly base: string;

  constructor(
    private readonly key: string,
    baseUrl: string = ANTHROPIC_BASE_URL,
    private readonly fetchImpl?: FetchLike,
  ) {
    this.base = (baseUrl || ANTHROPIC_BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
    this.origin = new URL(this.base).origin;
  }

  private get official(): boolean {
    return this.origin === ANTHROPIC_BASE_URL;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      ...extra,
    };
  }

  models(): ModelInfo[] {
    return ANTHROPIC_MODELS;
  }

  async test(): Promise<ModelInfo[]> {
    const res = await aiFetch(`${this.base}/v1/models?limit=100`, { method: "GET", headers: this.headers() }, this.fetchImpl);
    if (!res.ok) throw await errorFromResponse(res, this.name);
    const v = (await res.json().catch(() => ({}))) as { data?: { id?: unknown; display_name?: unknown }[] };
    return (v.data ?? [])
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id as string, name: typeof m.display_name === "string" ? m.display_name : (m.id as string) }));
  }

  async *complete(req: AiRequest): AsyncGenerator<Delta> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const body = anthropicBody(req, this.official, unsupportedParams(this.origin, req.model));
      const headers = this.headers({ "content-type": "application/json", accept: "text/event-stream" });
      if (body.fallbacks) headers["anthropic-beta"] = FALLBACK_BETA;
      res = await aiFetch(
        `${this.base}/v1/messages`,
        { method: "POST", headers, body: JSON.stringify(body), signal: req.signal ?? null },
        this.fetchImpl,
      );
      if (res.ok) break;
      const err = await errorFromResponse(res, this.name);
      // A model that rejects an optional parameter: retry once without it and remember that for the session.
      const param = attempt === 0 ? rejectedParam(err, ANTHROPIC_OPTIONAL.filter((p) => p in body)) : null;
      if (!param) throw err;
      markUnsupported(this.origin, req.model, param);
    }
    if (!res.body) throw new AiError("badResponse", "Anthropic sent no answer");
    yield* anthropicDeltas(sseEvents(res.body, req.signal));
  }
}
