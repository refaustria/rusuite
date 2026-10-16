// Anthropic Messages API (`POST /v1/messages`, streamed as server-sent events) called from the browser / webview
// with the user's own key: `x-api-key`, `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access:
// true` (Anthropic's opt-in for browser calls: the key is the user's own and stays on their device).
// Structured results use tool use: one strict tool, `tool_choice: auto` (the 5.5 models reject forced tool choice)
// and an instruction to call it; the client validates the input again (`schemas.ts`).

import type { AiProvider, AiRequest, AiTool, Delta, ModelInfo } from "../types";
import { AiError } from "../types";
import { aiFetch, errorFromResponse, parseToolJson, sseEvents, type FetchLike } from "./http";

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

export function anthropicBody(req: AiRequest, official: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (req.temperature !== undefined && acceptsTemperature(req.model)) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t: AiTool) => ({ name: t.name, description: t.description, input_schema: t.schema, strict: true }));
    body.tool_choice = { type: "auto" };
  }
  if (official && supportsFallback(req.model)) body.fallbacks = "default";
  return body;
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
        const u = m.usage ?? {};
        const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        yield { type: "usage", inputTokens: input, outputTokens: u.output_tokens ?? 0 };
        break;
      }
      case "content_block_start": {
        const b = d.content_block ?? {};
        blocks.set(d.index, { type: b.type, id: b.id, name: b.name, json: "" });
        if (b.type === "text" && b.text) yield { type: "text", text: b.text };
        break;
      }
      case "content_block_delta": {
        const delta = d.delta ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string") yield { type: "text", text: delta.text };
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
        if (d.usage && typeof d.usage.output_tokens === "number") yield { type: "usage", outputTokens: d.usage.output_tokens };
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
    const body = anthropicBody(req, this.official);
    const headers = this.headers({ "content-type": "application/json", accept: "text/event-stream" });
    if (body.fallbacks) headers["anthropic-beta"] = FALLBACK_BETA;
    const res = await aiFetch(
      `${this.base}/v1/messages`,
      { method: "POST", headers, body: JSON.stringify(body), signal: req.signal ?? null },
      this.fetchImpl,
    );
    if (!res.ok) throw await errorFromResponse(res, this.name);
    if (!res.body) throw new AiError("badResponse", "Anthropic sent no answer");
    yield* anthropicDeltas(sseEvents(res.body, req.signal));
  }
}
