// AI assistant round 2 (P9-A1): prompt caching of the whole document, reasoning effort, pictures, reply language.
import { describe, expect, it } from "vitest";
import cacheWrite from "./providers/fixtures/anthropic-cache-write.sse?raw";
import cacheRead from "./providers/fixtures/anthropic-cache-read.sse?raw";
import openaiCached from "./providers/fixtures/openai-cached.sse?raw";
import { anthropicBody, anthropicDeltas, anthropicSystem, usageDelta } from "./providers/anthropic";
import { openAiBody, openAiDeltas } from "./providers/openai";
import { sseEvents } from "./providers/http";
import { Assistant, type AiAction } from "./controller";
import { documentContext, textHash, type DocContext } from "./prompts";
import { MemoryAiStore } from "./settings";
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
