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

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export class AiMockServer {
  readonly log: AiMockRequest[] = [];
  /** Answers by tool name (structured actions). */
  readonly tools = new Map<string, unknown>();
  /** Answers for text requests: the first whose pattern matches the user message wins. */
  readonly texts: { match: RegExp; text: string }[] = [];
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
  }

  /** Requests other than CORS preflights. */
  get calls(): AiMockRequest[] {
    return this.log.filter((r) => r.method !== "OPTIONS");
  }

  private answer(body: Record<string, unknown>): AiMockAnswer {
    const tools = (body.tools as { name: string }[] | undefined) ?? [];
    const tool = tools[0]?.name;
    if (tool && this.tools.has(tool)) return { tool, input: this.tools.get(tool) };
    const messages = (body.messages as { content: string }[] | undefined) ?? [];
    const last = messages[messages.length - 1]?.content ?? "";
    return { text: this.texts.find((t) => t.match.test(last))?.text ?? "Mock answer." };
  }

  private stream(res: http.ServerResponse, model: string, a: AiMockAnswer): void {
    res.writeHead(200, { ...this.cors(), "content-type": "text/event-stream", "cache-control": "no-cache" });
    const out: string[] = [sse("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 321, output_tokens: 1 } } })];
    if ("text" in a) {
      out.push(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
      for (const piece of a.text.match(/.{1,8}/gs) ?? []) out.push(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }));
      out.push(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
      out.push(sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } }));
    } else {
      const json = JSON.stringify(a.input);
      out.push(sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_mock", name: a.tool, input: {} } }));
      for (const piece of json.match(/.{1,20}/gs) ?? []) out.push(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: piece } }));
      out.push(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
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
        if (req.method === "POST" && path === "/v1/messages" && body) return this.stream(res, String(body.model), this.answer(body));
        res.writeHead(404, this.cors()).end();
      });
    });
    return new Promise((resolve) => this.server!.listen(this.port, "127.0.0.1", () => resolve()));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
