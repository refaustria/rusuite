import { describe, expect, it } from "vitest";
import anthropicText from "./fixtures/anthropic-text.sse?raw";
import anthropicTool from "./fixtures/anthropic-tool.sse?raw";
import anthropicError from "./fixtures/anthropic-error.sse?raw";
import anthropicRefusal from "./fixtures/anthropic-refusal.sse?raw";
import openaiText from "./fixtures/openai-text.sse?raw";
import openaiJson from "./fixtures/openai-json.sse?raw";
import { AnthropicProvider, acceptsTemperature, anthropicBody } from "./anthropic";
import { OpenAiCompatibleProvider, normalizeOpenAiBase, openAiBody } from "./openai";
import { noteAiCspViolation, retryAfterSeconds, sseEvents, type FetchLike } from "./http";
import { AiError, type AiRequest, type Delta } from "../types";
import { FORMULA_TOOL, SLIDES_TOOL } from "../schemas";

/** A body streamed in small, uneven chunks (events split across reads). */
function chunked(text: string, size = 17): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

function fakeFetch(reply: { status?: number; body?: string; headers?: Record<string, string> } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(reply.status && reply.status >= 400 ? (reply.body ?? "") : chunked(reply.body ?? ""), { status: reply.status ?? 200, headers: reply.headers });
  };
  return { f, calls };
}

const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  model: "claude-sonnet-5-5",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 100,
  temperature: 0.5,
  stream: true,
  ...over,
});

async function collect(it: AsyncIterable<Delta>): Promise<Delta[]> {
  const out: Delta[] = [];
  for await (const d of it) out.push(d);
  return out;
}

const text = (ds: Delta[]) => ds.flatMap((d) => (d.type === "text" ? [d.text] : [])).join("");

describe("SSE parsing", () => {
  it("splits events across chunk boundaries, ignores comments, keeps multi-line data", async () => {
    const evs = [];
    for await (const e of sseEvents(chunked(": keep-alive\n\nevent: a\ndata: 1\ndata: 2\n\r\ndata: x", 3))) evs.push(e);
    expect(evs).toEqual([
      { event: "a", data: "1\n2" },
      { event: "message", data: "x" },
    ]);
  });

  it("retry-after: seconds or an HTTP date", () => {
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThanOrEqual(4);
    expect(retryAfterSeconds(null)).toBeNull();
  });
});

describe("Anthropic adapter", () => {
  it("sends the Messages API request with the browser-access header; streams text, usage and the stop reason", async () => {
    const { f, calls } = fakeFetch({ body: anthropicText });
    const ds = await collect(new AnthropicProvider("sk-ant-test", undefined, f).complete(req()));
    expect(text(ds)).toBe("The report was finished on time.");
    expect(ds).toContainEqual({ type: "model", model: "claude-sonnet-5-5" });
    expect(ds).toContainEqual({ type: "usage", inputTokens: 412, outputTokens: 1 });
    expect(ds).toContainEqual({ type: "usage", outputTokens: 9 });
    expect(ds.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-ant-test");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 100, system: "sys", stream: true, fallbacks: "default" });
    expect(body.temperature).toBeUndefined(); // the 5.x models reject sampling parameters
    expect(h["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(url).not.toContain("sk-ant");
  });

  it("a tool call: strict tool, tool_choice auto, input assembled from the JSON deltas", async () => {
    const { f, calls } = fakeFetch({ body: anthropicTool });
    const ds = await collect(new AnthropicProvider("k", undefined, f).complete(req({ model: "claude-opus-5-5", tools: [FORMULA_TOOL] })));
    expect(ds).toContainEqual({ type: "toolUse", id: "toolu_01", name: "insert_formula", input: { formula: "=SUM(B2:B10)", explanation: "Adds B2 to B10." } });
    expect(ds).toContainEqual({ type: "usage", inputTokens: 1000, outputTokens: 2 });
    expect(ds.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.tools[0]).toMatchObject({ name: "insert_formula", strict: true, input_schema: { type: "object", additionalProperties: false } });
  });

  it("temperature only for models that take it; no fallbacks off the official API or for Haiku", () => {
    expect(acceptsTemperature("claude-haiku-4-5")).toBe(true);
    expect(acceptsTemperature("claude-3-5-sonnet-latest")).toBe(true);
    expect(acceptsTemperature("claude-opus-5-5")).toBe(false);
    expect(acceptsTemperature("claude-opus-4-7")).toBe(false);
    expect(anthropicBody(req({ model: "claude-haiku-4-5" }), true).temperature).toBe(0.5);
    expect(anthropicBody(req({ model: "claude-haiku-5-5" }), true).fallbacks).toBeUndefined();
    expect(anthropicBody(req(), false).fallbacks).toBeUndefined();
  });

  it("an error event mid-stream is an AiError (overloaded)", async () => {
    const { f } = fakeFetch({ body: anthropicError });
    await expect(collect(new AnthropicProvider("k", undefined, f).complete(req()))).rejects.toMatchObject({ kind: "overloaded" });
  });

  it("a refusal ends with stop reason refusal", async () => {
    const { f } = fakeFetch({ body: anthropicRefusal });
    const ds = await collect(new AnthropicProvider("k", undefined, f).complete(req()));
    expect(ds.at(-1)).toEqual({ type: "stop", reason: "refusal" });
  });

  it("maps 401 and 429 (with retry-after) to clear errors without the key", async () => {
    const auth = fakeFetch({ status: 401, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
    const e1 = await collect(new AnthropicProvider("sk-secret", undefined, auth.f).complete(req())).catch((e) => e);
    expect(e1).toBeInstanceOf(AiError);
    expect(e1).toMatchObject({ kind: "auth", status: 401, detail: "invalid x-api-key" });
    expect(String(e1.message)).not.toContain("sk-secret");
    const rate = fakeFetch({ status: 429, body: "{}", headers: { "retry-after": "30" } });
    await expect(collect(new AnthropicProvider("k", undefined, rate.f).complete(req()))).rejects.toMatchObject({ kind: "rateLimit", retryAfter: 30 });
  });

  it("a stream that ends without message_stop is a network error", async () => {
    const cut = anthropicText.slice(0, anthropicText.indexOf("event: message_delta"));
    const { f } = fakeFetch({ body: cut });
    await expect(collect(new AnthropicProvider("k", undefined, f).complete(req()))).rejects.toMatchObject({ kind: "network" });
  });

  it("network failure → cors; after a CSP violation → csp", async () => {
    const { f } = fakeFetch(new TypeError("Failed to fetch"));
    await expect(collect(new AnthropicProvider("k", undefined, f).complete(req()))).rejects.toMatchObject({ kind: "cors", detail: "https://api.anthropic.com" });
    noteAiCspViolation("https://api.anthropic.com", Date.now() + 5000);
    await expect(collect(new AnthropicProvider("k", undefined, f).complete(req()))).rejects.toMatchObject({ kind: "csp" });
  });

  it("Test lists the models (GET /v1/models)", async () => {
    const { f, calls } = fakeFetch({ body: JSON.stringify({ data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: false }) });
    expect(await new AnthropicProvider("k", "http://127.0.0.1:4847/", f).test()).toEqual([{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }]);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4847/v1/models?limit=100");
    expect(calls[0]!.init.method).toBe("GET");
  });
});

describe("OpenAI-compatible adapter", () => {
  it("streams chat-completion deltas and usage; Bearer key; base URL normalized", async () => {
    const { f, calls } = fakeFetch({ body: openaiText });
    const p = new OpenAiCompatibleProvider("sk-o", "https://api.openai.com/v1/", f);
    const ds = await collect(p.complete(req({ model: "gpt-5-mini" })));
    expect(text(ds)).toBe("Hallo Welt.");
    expect(ds).toContainEqual({ type: "usage", inputTokens: 55, outputTokens: 4 });
    expect(ds.at(-1)).toEqual({ type: "stop", reason: "stop" });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-o");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.max_completion_tokens).toBe(100);
    expect(body.temperature).toBeUndefined(); // reasoning model
  });

  it("structured results via the JSON-schema response format; local servers need no key", async () => {
    const { f, calls } = fakeFetch({ body: openaiJson });
    const p = new OpenAiCompatibleProvider("", "http://localhost:11434", f);
    expect(p.name).toBe("localhost:11434");
    const ds = await collect(p.complete(req({ model: "llama3.2", tools: [SLIDES_TOOL] })));
    expect(ds).toContainEqual({ type: "toolUse", id: "json", name: "create_slides", input: { slides: [{ title: "Intro", bullets: ["One", "Two"], notes: "" }] } });
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "create_slides", strict: true } });
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);
  });

  it("normalizes base URLs", () => {
    expect(normalizeOpenAiBase("http://localhost:1234")).toBe("http://localhost:1234/v1");
    expect(normalizeOpenAiBase("https://x.example/openai/v1/")).toBe("https://x.example/openai/v1");
    expect(() => normalizeOpenAiBase("ftp://x")).toThrow(AiError);
    expect(openAiBody(req({ model: "llama3" }), false).stream_options).toEqual({ include_usage: true });
  });
});
