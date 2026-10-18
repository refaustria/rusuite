// OpenAI-compatible chat completions (`POST <base>/chat/completions`, `stream: true`): OpenAI itself and local or
// self-hosted servers (Ollama, LM Studio, vLLM, llama.cpp) at a base URL the user enters. Structured results use the
// JSON-schema response format (`response_format: { type: "json_schema" }`), which these servers support; the answer
// text is then parsed as the action's result. The key is optional (local servers usually need none).

import type { AiEffort, AiMessage, AiProvider, AiRequest, Delta, ModelInfo } from "../types";
import { AiError } from "../types";
import { aiFetch, errorFromResponse, markUnsupported, parseToolJson, rejectedParam, sseEvents, unsupportedParams, type FetchLike } from "./http";

/** Optional parameters dropped (and retried once) when a server rejects them with a 400. */
export const OPENAI_OPTIONAL = ["temperature", "stream_options", "reasoning_effort"] as const;

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "gpt-5-mini";
export const OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-5-mini", name: "gpt-5-mini" },
  { id: "gpt-5", name: "gpt-5" },
  { id: "llama3.2", name: "llama3.2 (Ollama)" },
];

/** `http://localhost:11434` → `http://localhost:11434/v1`; a URL with a path is kept (no trailing slash). */
export function normalizeOpenAiBase(url: string): string {
  const raw = (url || OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new AiError("invalid", "The base URL must start with https:// or http://");
  return u.pathname === "/" || u.pathname === "" ? `${u.origin}/v1` : raw;
}

/** OpenAI's reasoning models take no `temperature`. */
const reasoningModel = (model: string) => /^(o\d|gpt-5)/.test(model);

/**
 * The Reasoning setting as `reasoning_effort`: low / medium / high as they are; "Off" is `minimal` on OpenAI itself
 * (the gpt-5 family) and `none` on local servers (Ollama and LM Studio take `none` to turn thinking off). A server
 * that rejects the value drops it with the usual retry (`OPENAI_OPTIONAL`).
 */
export function openAiReasoningEffort(effort: AiEffort, official: boolean): string {
  return effort === "off" ? (official ? "minimal" : "none") : effort;
}

/** A message's content: a string, or `image_url` parts (data URLs) followed by the text parts. */
export function openAiContent(m: AiMessage): string | Record<string, unknown>[] {
  if (typeof m.content === "string") return m.content;
  return m.content.map((p) =>
    p.type === "image" ? { type: "image_url", image_url: { url: `data:${p.image.mediaType};base64,${p.image.data}` } } : { type: "text", text: p.text },
  );
}

/**
 * The system message: the whole document when it is sent (first, so that identical prefixes repeat), then the
 * instructions. No cache marker – the chat
 * completions API has none (OpenAI caches long identical prefixes automatically and reports them as
 * `usage.prompt_tokens_details.cached_tokens`; local servers generally do not cache across requests).
 */
export const openAiSystem = (req: AiRequest): string => (req.documentContext ? `${req.documentContext}\n\n${req.system}` : req.system);

export function openAiBody(req: AiRequest, official: boolean, skip: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [{ role: "system", content: openAiSystem(req) }, ...req.messages.map((m) => ({ role: m.role, content: openAiContent(m) }))],
    stream: true,
    stream_options: { include_usage: true },
  };
  body[official ? "max_completion_tokens" : "max_tokens"] = req.maxTokens;
  if (req.temperature !== undefined && !reasoningModel(req.model)) body.temperature = req.temperature;
  if (req.effort) body.reasoning_effort = openAiReasoningEffort(req.effort, official);
  const tool = req.tools?.[0];
  if (tool) body.response_format = { type: "json_schema", json_schema: { name: tool.name, description: tool.description, schema: tool.schema, strict: true } };
  for (const p of skip) delete body[p];
  return body;
}

/** Deltas of a chat-completions event stream; with `tool`, the whole answer text is that tool's input. */
export async function* openAiDeltas(events: AsyncIterable<{ event: string; data: string }>, tool: string | null): AsyncGenerator<Delta> {
  let stop: string | null = null;
  let json = "";
  let model: string | null = null;
  for await (const ev of events) {
    const data = ev.data.trim();
    if (!data) continue;
    if (data === "[DONE]") break;
    let d: { model?: string; error?: { message?: string } | string; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null; choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[] };
    try {
      d = JSON.parse(data);
    } catch {
      throw new AiError("badResponse", "The provider sent an unreadable stream");
    }
    if (d.error) throw new AiError("server", `Provider error: ${typeof d.error === "string" ? d.error : (d.error.message ?? "unknown")}`);
    if (typeof d.model === "string" && d.model !== model) {
      model = d.model;
      yield { type: "model", model };
    }
    for (const c of d.choices ?? []) {
      const text = c.delta?.content;
      if (text) {
        if (tool) json += text;
        else yield { type: "text", text };
      }
      if (c.finish_reason) stop = c.finish_reason;
    }
    if (d.usage) {
      const cached = d.usage.prompt_tokens_details?.cached_tokens;
      yield { type: "usage", inputTokens: d.usage.prompt_tokens, outputTokens: d.usage.completion_tokens, ...(typeof cached === "number" ? { cacheReadTokens: cached } : {}) };
    }
  }
  if (!stop) throw new AiError("network", "The answer ended early (connection closed)");
  if (tool && stop !== "length") yield { type: "toolUse", id: "json", name: tool, input: parseToolJson(json) };
  yield { type: "stop", reason: stop === "length" ? "max_tokens" : stop === "tool_calls" ? "tool_use" : stop };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind = "openai" as const;
  readonly name: string;
  readonly origin: string;
  private readonly base: string;

  constructor(
    private readonly key: string,
    baseUrl: string = OPENAI_BASE_URL,
    private readonly fetchImpl?: FetchLike,
  ) {
    this.base = normalizeOpenAiBase(baseUrl);
    this.origin = new URL(this.base).origin;
    this.name = this.official ? "OpenAI" : new URL(this.base).host;
  }

  private get official(): boolean {
    return this.origin === new URL(OPENAI_BASE_URL).origin;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.key ? { authorization: `Bearer ${this.key}` } : {}), ...extra };
  }

  models(): ModelInfo[] {
    return OPENAI_MODELS;
  }

  async test(): Promise<ModelInfo[]> {
    const res = await aiFetch(`${this.base}/models`, { method: "GET", headers: this.headers() }, this.fetchImpl);
    if (!res.ok) throw await errorFromResponse(res, this.name);
    const v = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
    return (v.data ?? []).filter((m) => typeof m.id === "string").map((m) => ({ id: m.id as string, name: m.id as string }));
  }

  async *complete(req: AiRequest): AsyncGenerator<Delta> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const body = openAiBody(req, this.official, unsupportedParams(this.origin, req.model));
      res = await aiFetch(
        `${this.base}/chat/completions`,
        {
          method: "POST",
          headers: this.headers({ "content-type": "application/json", accept: "text/event-stream" }),
          body: JSON.stringify(body),
          signal: req.signal ?? null,
        },
        this.fetchImpl,
      );
      if (res.ok) break;
      const err = await errorFromResponse(res, this.name);
      const param = attempt === 0 ? rejectedParam(err, OPENAI_OPTIONAL.filter((p) => p in body)) : null;
      if (!param) throw err;
      markUnsupported(this.origin, req.model, param);
    }
    if (!res.body) throw new AiError("badResponse", `${this.name} sent no answer`);
    yield* openAiDeltas(sseEvents(res.body, req.signal), req.tools?.[0]?.name ?? null);
  }
}
