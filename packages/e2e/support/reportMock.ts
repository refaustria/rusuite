// A mock of the report relay (P8-43) for the e2e suite: `POST /api/report` answers 201 with an issue for the first
// report of an instance and 429 for further ones (as the real relay's 1-per-hour limit); every body is logged.
// The pages post to their own origin (`/api/report`); the spec forwards that route here with `page.route`.

import http from "node:http";

export interface ReportMockRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

export class ReportMockServer {
  readonly log: ReportMockRequest[] = [];
  private seen = new Set<string>();
  private next = 101;
  private server: http.Server | null = null;

  constructor(readonly port: number) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/api/report`;
  }

  reset(): void {
    this.log.length = 0;
    this.seen.clear();
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = null;
        }
        this.log.push({ method: req.method ?? "", path: req.url ?? "", body });
        const send = (status: number, v: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(v));
        };
        if (req.method !== "POST" || req.url !== "/api/report" || !body) return send(400, { error: "bad request" });
        const id = String(body.instanceId);
        if (this.seen.has(id)) return send(429, { error: "too many reports", retryAfterSeconds: 2580 });
        this.seen.add(id);
        const number = this.next++;
        send(201, { number, url: `https://github.com/refaustria/rusuite/issues/${number}` });
      });
    });
    return new Promise((resolve) => this.server!.listen(this.port, "127.0.0.1", () => resolve()));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
