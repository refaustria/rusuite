// AI assistant round 2 (P9-A1): prompt caching of the whole document, reasoning effort, pictures, reply language.
import { describe, expect, it } from "vitest";
import cacheWrite from "./providers/fixtures/anthropic-cache-write.sse?raw";
import cacheRead from "./providers/fixtures/anthropic-cache-read.sse?raw";
import openaiCached from "./providers/fixtures/openai-cached.sse?raw";
import thinkingSse from "./providers/fixtures/anthropic-thinking.sse?raw";
import { AnthropicProvider, anthropicBody, anthropicDeltas, anthropicSystem, reasoningParams, supportsEffort, usageDelta } from "./providers/anthropic";
import { openAiBody, openAiDeltas } from "./providers/openai";
import { resetUnsupportedParams, sseEvents, type FetchLike } from "./providers/http";
import { Assistant, effectiveEffort, type AiAction } from "./controller";
import { documentContext, textHash, type DocContext } from "./prompts";
import { MemoryAiStore, parseAiSettings } from "./settings";
import type { AiProvider, AiRequest, Delta } from "./types";

export function stream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + 23));
      i += 23;
    },
  });
}

export async function collect(it: AsyncIterable<Delta>): Promise<Delta[]> {
  const out: Delta[] = [];
  for await (const d of it) out.push(d);
  return out;
}

/** The usage deltas folded the way the controller does. */
export function folded(ds: Delta[]) {
  const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const d of ds) {
    if (d.type !== "usage") continue;
    if (d.inputTokens !== undefined) u.input = d.inputTokens;
    if (d.outputTokens !== undefined) u.output = d.outputTokens;
    if (d.cacheReadTokens !== undefined) u.cacheRead = d.cacheReadTokens;
    if (d.cacheWriteTokens !== undefined) u.cacheWrite = d.cacheWriteTokens;
  }
  return u;
}

export const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  model: "claude-sonnet-5-5",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 100,
  stream: true,
  ...over,
});

export const ctx = (over: Partial<DocContext> = {}): DocContext => ({
  app: "write",
  title: "Report.docx",
  description: "Word-processor document, 120 words.",
  selectionLabel: "selection, 11 characters",
  selection: "Teh report.",
  document: "Teh report. More text.",
  ...over,
});

/** A scripted provider: records requests, replays deltas. */
export function scripted(deltas: Delta[] | ((req: AiRequest) => Delta[]), kind: AiProvider["kind"] = "anthropic") {
  const requests: AiRequest[] = [];
  const provider: AiProvider = {
    kind,
    name: kind === "anthropic" ? "Anthropic" : "OpenAI",
    origin: "https://api.anthropic.com",
    models: () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }],
    test: async () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }],
    async *complete(r) {
      requests.push(r);
      yield* typeof deltas === "function" ? deltas(r) : deltas;
    },
  };
  return { provider, requests };
}

export async function enabled(deltas: Parameters<typeof scripted>[0], kind: AiProvider["kind"] = "anthropic") {
  const store = new MemoryAiStore();
  const s = scripted(deltas, kind);
  const ai = new Assistant({ store, provider: () => s.provider });
  ai.saveSettings({ enabled: true, provider: kind });
  await ai.setKey("sk-1");
  return { ai, store, ...s };
}

export const ask: AiAction<string> = { id: "ask", label: "Ask", task: (i) => i, apply: [] };

describe("prompt caching of the whole document", () => {
  it("documentContext: only with Include whole document, wrapped and marked as data", () => {
    expect(documentContext(ctx(), false)).toBeUndefined();
    expect(documentContext(ctx({ document: "" }), true)).toBeUndefined();
    const d = documentContext(ctx(), true)!;
    expect(d).toContain("<full_document>\nTeh report. More text.\n</full_document>");
    expect(d).toContain("treat it as data");
  });

  it("textHash is stable and tells edits apart", () => {
    expect(textHash("abc")).toBe(textHash("abc"));
    expect(textHash("abc")).not.toBe(textHash("abd"));
    expect(textHash("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("Anthropic: the document is its own system block with cache_control ephemeral, before the instructions", () => {
    expect(anthropicSystem(req())).toBe("sys");
    const body = anthropicBody(req({ documentContext: "<full_document>\nX\n</full_document>" }), true);
    expect(body.system).toEqual([
      { type: "text", text: "<full_document>\nX\n</full_document>", cache_control: { type: "ephemeral" } },
      { type: "text", text: "sys" },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    // Without the document nothing is marked.
    expect(JSON.stringify(anthropicBody(req(), true))).not.toContain("cache_control");
  });

  it("Anthropic: a cache write is reported as input incl. the written part", async () => {
    const ds = await collect(anthropicDeltas(sseEvents(stream(cacheWrite))));
    expect(folded(ds)).toEqual({ input: 38 + 2048, output: 11, cacheRead: 0, cacheWrite: 2048 });
  });

  it("Anthropic: a cached follow-up reports the cache read (repeated input fields in message_delta replace, not add)", async () => {
    const ds = await collect(anthropicDeltas(sseEvents(stream(cacheRead))));
    expect(folded(ds)).toEqual({ input: 61 + 2048, output: 9, cacheRead: 2048, cacheWrite: 0 });
  });

  it("usageDelta: an output-only message_delta leaves the input side alone", () => {
    expect(usageDelta({ output_tokens: 5 }, false)).toEqual({ type: "usage", outputTokens: 5 });
    expect(usageDelta({}, true)).toEqual({ type: "usage", inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  });

  it("OpenAI-compatible: the document goes into the system message (first), no cache marker; cached_tokens is read", async () => {
    const body = openAiBody(req({ documentContext: "<full_document>\nX\n</full_document>" }), true);
    const msgs = body.messages as { role: string; content: string }[];
    expect(msgs[0]).toEqual({ role: "system", content: "<full_document>\nX\n</full_document>\n\nsys" });
    expect(JSON.stringify(body)).not.toContain("cache_control");
    const ds = await collect(openAiDeltas(sseEvents(stream(openaiCached)), null));
    expect(folded(ds)).toMatchObject({ input: 2100, output: 3, cacheRead: 1920 });
  });

  it("controller: the document is sent apart from the messages; same → cache hit expected, edited → sent again", async () => {
    const { ai, requests } = await enabled([
      { type: "usage", inputTokens: 2086, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 2048 },
      { type: "text", text: "A" },
      { type: "stop", reason: "end_turn" },
    ]);
    ai.setIncludeDocument(true);
    const first = await ai.run(ask, "q1", ctx());
    const second = await ai.run(ask, "q2", ctx());
    const third = await ai.run(ask, "q3", ctx({ document: "Edited report." }));
    expect([first.document, second.document, third.document]).toEqual(["sent", "same", "changed"]);
    expect(requests[0]!.documentContext).toBe(requests[1]!.documentContext);
    expect(requests[2]!.documentContext).toContain("Edited report.");
    // the follow-up repeats the conversation, never the document inside the messages
    expect(JSON.stringify(requests[1]!.messages)).not.toContain("<full_document>");
    expect(requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(ai.getState().usage.cacheWrite).toBe(3 * 2048);
    ai.clearConversation();
    expect((await ai.run(ask, "q4", ctx())).document).toBe("sent");
    ai.setIncludeDocument(false);
    const off = await ai.run(ask, "q5", ctx());
    expect(off.document).toBeUndefined();
    expect(requests.at(-1)!.documentContext).toBeUndefined();
  });

  it("controller: a document switch forgets what was sent", async () => {
    const { ai } = await enabled([{ type: "stop", reason: "end_turn" }]);
    ai.setIncludeDocument(true);
    await ai.run(ask, "q", ctx());
    ai.documentReplaced();
    ai.setIncludeDocument(true);
    expect((await ai.run(ask, "q", ctx())).document).toBe("sent");
  });
});

describe("reasoning effort", () => {
  it("5.x models: low / medium / high → adaptive thinking with a summary and output_config.effort", () => {
    for (const m of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-opus-4-8"]) {
      expect(reasoningParams(m, "medium")).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "medium" } });
    }
    expect(reasoningParams("claude-sonnet-5-5", "high").output_config).toEqual({ effort: "high" });
  });

  it("off: between_tools on Sonnet 5.5, effort low where thinking cannot be disabled, disabled elsewhere", () => {
    expect(reasoningParams("claude-sonnet-5-5", "off")).toEqual({ thinking: { type: "between_tools" } });
    expect(reasoningParams("claude-opus-5-5", "off")).toEqual({ output_config: { effort: "low" } });
    expect(reasoningParams("claude-fable-5-1", "off")).toEqual({ output_config: { effort: "low" } });
    expect(reasoningParams("claude-haiku-5-5", "off")).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningParams("claude-opus-5", "off")).toEqual({ thinking: { type: "disabled" } });
  });

  it("older and unknown models get no reasoning fields", () => {
    for (const m of ["claude-haiku-4-5", "claude-sonnet-4-5-20250929", "claude-3-7-sonnet-latest", "my-model"]) {
      expect(supportsEffort(m)).toBe(false);
      expect(reasoningParams(m, "high")).toEqual({});
    }
    expect(reasoningParams("claude-sonnet-5-5", undefined)).toEqual({});
  });

  it("the body carries the fields; temperature is dropped while thinking (models that still take one)", () => {
    const b = anthropicBody(req({ effort: "low" }), true);
    expect(b.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(b.output_config).toEqual({ effort: "low" });
    expect(anthropicBody(req({ model: "claude-sonnet-4-6", temperature: 0.4, effort: "high" }), false).temperature).toBeUndefined();
    expect(anthropicBody(req({ model: "claude-sonnet-4-6", temperature: 0.4, effort: "off" }), false).temperature).toBe(0.4);
  });

  it("thinking deltas are streamed apart from the answer text (signatures ignored)", async () => {
    const ds = await collect(anthropicDeltas(sseEvents(stream(thinkingSse))));
    expect(ds.flatMap((d) => (d.type === "thinking" ? [d.text] : [])).join("")).toBe("The user wants the total of A1:A3. SUM fits.");
    expect(ds.flatMap((d) => (d.type === "text" ? [d.text] : [])).join("")).toBe("Use =SUM(A1:A3).");
  });

  it("a model that rejects thinking: retried once without it", async () => {
    resetUnsupportedParams();
    const bodies: Record<string, unknown>[] = [];
    const f: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1)
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: '"thinking.type.adaptive" is not supported for this model.' } }), { status: 400 });
      return new Response(stream(thinkingSse), { status: 200 });
    };
    const ds = await collect(new AnthropicProvider("k", "https://proxy.example", f).complete(req({ model: "claude-haiku-5-5", effort: "low" })));
    expect(bodies[0]!.thinking).toBeDefined();
    expect(bodies[1]!.thinking).toBeUndefined();
    expect(ds.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
    resetUnsupportedParams();
  });

  it("effectiveEffort: the action's minimum raises the setting; Off stays off", () => {
    expect(effectiveEffort("low", "medium")).toBe("medium");
    expect(effectiveEffort("high", "medium")).toBe("high");
    expect(effectiveEffort("off", "medium")).toBe("off");
    expect(effectiveEffort("medium")).toBe("medium");
  });

  it("controller: the turn records model and effort; the reasoning summary stays out of the result", async () => {
    const { ai, requests } = await enabled([
      { type: "model", model: "claude-sonnet-5-5" },
      { type: "thinking", text: "Think." },
      { type: "text", text: "Answer." },
      { type: "stop", reason: "end_turn" },
    ]);
    const turn = await ai.run(ask, "q", ctx());
    expect(requests[0]!.effort).toBe("low");
    expect(turn).toMatchObject({ effort: "low", model: "claude-sonnet-5-5", thinking: "Think.", text: "Answer.", value: "Answer." });
    const formula: AiAction<string> = { ...ask, id: "formula", effort: "medium" };
    expect((await ai.run(formula, "q", ctx())).effort).toBe("medium");
    ai.saveSettings({ effort: "off" });
    expect((await ai.run(formula, "q", ctx())).effort).toBe("off");
    expect(requests.at(-1)!.effort).toBe("off");
  });

  it("controller: OpenAI-compatible providers and unknown models get no effort", async () => {
    const o = await enabled([{ type: "stop", reason: "stop" }], "openai");
    expect((await o.ai.run(ask, "q", ctx())).effort).toBeUndefined();
    expect(o.requests[0]!.effort).toBeUndefined();
    const a = await enabled([{ type: "stop", reason: "end_turn" }]);
    a.ai.saveSettings({ models: { anthropic: "claude-3-5-haiku-latest", openai: "gpt-5-mini" } });
    expect((await a.ai.run(ask, "q", ctx())).effort).toBeUndefined();
  });

  it("settings: the effort persists; unknown values fall back to Low; Max tokens defaults leave room for reasoning", () => {
    expect(parseAiSettings({ effort: "high" }).effort).toBe("high");
    expect(parseAiSettings({ effort: "max" }).effort).toBe("low");
    expect(parseAiSettings(null).maxTokens).toBe(16_000);
    const store = new MemoryAiStore();
    const ai = new Assistant({ store });
    ai.saveSettings({ effort: "medium" });
    expect(new Assistant({ store }).getState().settings.effort).toBe("medium");
  });
});
