// A scripted AI provider for the assistant tests (P8-37): the Anthropic Messages API (`POST /v1/messages`, streamed
// as server-sent events, tool use) and `GET /v1/models`, with CORS for the app's origin. The answer depends on the
// request: a structured action's tool gets a scripted tool call, a text action a scripted text. Every request is
// logged (path, origin, headers, body) so tests can assert who contacted it and what was sent.

import http from "node:http";

export interface AiMockRequest {
  method: string;
  path: string;
  origin: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> | null;
}

/** A scripted answer: plain text, or a tool call with this input. */
export type AiMockAnswer = { text: string } | { tool: string; input: unknown };

/** A message's text (a string, or the text blocks of a content array). */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((b: { type?: string; text?: string }) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("\n\n");
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export class AiMockServer {
  readonly log: AiMockRequest[] = [];
  /** Answers by tool name (structured actions). */
  readonly tools = new Map<string, unknown>();
  /** Answers for text requests: the first whose pattern matches the user message wins. */
  readonly texts: { match: RegExp; text: string }[] = [];
  /** The reasoning summary streamed when a request asks for adaptive thinking with a summary. */
  thinkingText = "Mock reasoning: reading the selection first.";
  /** Prompt-cache entries (the texts of blocks marked `cache_control`), like the API's 5-minute cache. */
  readonly cache = new Set<string>();
  private server: http.Server | null = null;

  constructor(
    readonly port: number,
    private readonly allowOrigin: string,
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  reset(): void {
    this.log.length = 0;
    this.tools.clear();
    this.texts.length = 0;
    this.cache.clear();
  }

  /**
   * The input usage of a request, as the Messages API reports it: system blocks marked `cache_control` are written
   * to the cache the first time (`cache_creation_input_tokens`) and read from it afterwards
   * (`cache_read_input_tokens`); about four characters per token.
   */
  usageOf(body: Record<string, unknown>): { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } {
    let write = 0;
    let read = 0;
    const system = Array.isArray(body.system) ? (body.system as { text?: string; cache_control?: unknown }[]) : [];
    for (const b of system) {
      if (!b.cache_control || typeof b.text !== "string") continue;
      const tokens = Math.max(1, Math.ceil(b.text.length / 4));
      if (this.cache.has(b.text)) read += tokens;
      else {
        this.cache.add(b.text);
        write += tokens;
      }
    }
    return { input_tokens: 321, cache_creation_input_tokens: write, cache_read_input_tokens: read };
  }

  /** Requests other than CORS preflights. */
  get calls(): AiMockRequest[] {
    return this.log.filter((r) => r.method !== "OPTIONS");
  }

  private answer(body: Record<string, unknown>): AiMockAnswer {
    const tools = (body.tools as { name: string }[] | undefined) ?? [];
    const tool = tools[0]?.name;
    if (tool && this.tools.has(tool)) return { tool, input: this.tools.get(tool) };
    const messages = (body.messages as { content: unknown }[] | undefined) ?? [];
    const last = messageText(messages[messages.length - 1]?.content);
    return { text: this.texts.find((t) => t.match.test(last))?.text ?? "Mock answer." };
  }

  private stream(res: http.ServerResponse, body: Record<string, unknown>, a: AiMockAnswer): void {
    const model = String(body.model);
    res.writeHead(200, { ...this.cors(), "content-type": "text/event-stream", "cache-control": "no-cache" });
    const out: string[] = [sse("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], usage: { ...this.usageOf(body), output_tokens: 1 } } })];
    // Adaptive thinking with `display: "summarized"`: a thinking block (summary deltas + signature) comes first.
    const thinking = body.thinking as { type?: string; display?: string } | undefined;
    let index = 0;
    if (thinking?.type === "adaptive" && thinking.display === "summarized") {
      out.push(sse("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } }));
      for (const piece of this.thinkingText.match(/.{1,12}/gs) ?? []) out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: piece } }));
      out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "EqMockSignature" } }));
      out.push(sse("content_block_stop", { type: "content_block_stop", index }));
      index++;
    }
    if ("text" in a) {
      out.push(sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }));
      for (const piece of a.text.match(/.{1,8}/gs) ?? []) out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } }));
      out.push(sse("content_block_stop", { type: "content_block_stop", index }));
      out.push(sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } }));
    } else {
      const json = JSON.stringify(a.input);
      out.push(sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: "toolu_mock", name: a.tool, input: {} } }));
      for (const piece of json.match(/.{1,20}/gs) ?? []) out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: piece } }));
      out.push(sse("content_block_stop", { type: "content_block_stop", index }));
      out.push(sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 64 } }));
    }
    out.push(sse("message_stop", { type: "message_stop" }));
    // Streamed in pieces, as a real provider does.
    let i = 0;
    const next = () => {
      if (i >= out.length) return void res.end();
      res.write(out[i++]);
      setTimeout(next, 5);
    };
    next();
  }

  private cors(): Record<string, string> {
    return {
      "access-control-allow-origin": this.allowOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, anthropic-beta, content-type, accept, authorization",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> | null = null;
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        } catch {
          body = null;
        }
        const path = (req.url ?? "/").split("?")[0]!;
        this.log.push({ method: req.method ?? "", path, origin: req.headers.origin, headers: req.headers, body });
        if (req.method === "OPTIONS") return void res.writeHead(204, this.cors()).end();
        if (req.headers["x-api-key"] !== "sk-ant-test-key") {
          res.writeHead(401, { ...this.cors(), "content-type": "application/json" });
          return void res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
        }
        if (req.method === "GET" && path === "/v1/models") {
          res.writeHead(200, { ...this.cors(), "content-type": "application/json" });
          return void res.end(
            JSON.stringify({
              data: [
                { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
                { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
                { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" },
              ],
              has_more: false,
            }),
          );
        }
        if (req.method === "POST" && path === "/v1/messages" && body) return this.stream(res, body, this.answer(body));
        res.writeHead(404, this.cors()).end();
      });
    });
    return new Promise((resolve) => this.server!.listen(this.port, "127.0.0.1", () => resolve()));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
