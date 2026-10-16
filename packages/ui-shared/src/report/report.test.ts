// "Report a problem": validation, the hourly gate, payload building (never the document), screenshot limits, the
// relay replies.
import { describe, expect, it } from "vitest";
import { relayUrl, sendReport, DEFAULT_RELAY_URL, type ReportFetch } from "./client";
import { ReportController } from "./controller";
import { instanceId, INSTANCE_KEY, isUuidV4, nextAllowedAt, randomUuid, recordSubmitted, waitMinutes, waitMs } from "./instance";
import { buildDiagnostics, buildPayload, cleanDocStats, detectOs, parsePing, type ReportContext } from "./payload";
import { emptyDraft, REPORT_LIMITS, type ReportDraft, type ReportScreenshot } from "./types";
import { base64Bytes, checkScreenshotFile, checkScreenshotList, isValid, validateDraft } from "./validate";

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const good = (patch: Partial<ReportDraft> = {}): ReportDraft => ({
  ...emptyDraft(),
  title: "Sum is wrong",
  description: "The SUM of A1:A3 shows 5 instead of 6.",
  steps: "1. Type\n2. Sum",
  understood: true,
  ...patch,
});

const shot = (bytes: number, name = "a.png"): ReportScreenshot => ({ name, mime: "image/png", dataBase64: "A".repeat(Math.ceil(bytes / 3) * 4) });

const ctx: ReportContext = { app: "calc", appVersion: "0.1.0", platform: "web", os: "Linux", locale: "en", instanceId: "3f2b8c1e-9d4a-4e7b-8a6f-0c1d2e3f4a5b" };

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("validation", () => {
  it("accepts a complete draft", () => {
    expect(validateDraft(good())).toEqual({});
    expect(isValid(validateDraft(good()))).toBe(true);
  });

  it("title: required, at most 120 characters", () => {
    expect(validateDraft(good({ title: "  " })).title).toBe("report.v.title");
    expect(validateDraft(good({ title: "x".repeat(121) })).title).toBe("report.v.title");
    expect(validateDraft(good({ title: "ä".repeat(120) })).title).toBeUndefined();
  });

  it("description: 20 to 4000 characters (trimmed)", () => {
    expect(validateDraft(good({ description: "too short      " + " ".repeat(40) })).description).toBe("report.v.description");
    expect(validateDraft(good({ description: "y".repeat(4001) })).description).toBe("report.v.description");
    expect(validateDraft(good({ description: "z".repeat(20) })).description).toBeUndefined();
  });

  it("steps count only for bugs", () => {
    expect(validateDraft(good({ steps: "s".repeat(4001) })).steps).toBe("report.v.steps");
    expect(validateDraft(good({ kind: "question", steps: "s".repeat(4001) })).steps).toBeUndefined();
  });

  it("'I understand' is required", () => {
    expect(validateDraft(good({ understood: false })).understood).toBe("report.v.understand");
  });
});

describe("screenshots", () => {
  it("PNG and JPEG only, 2 MB each", () => {
    expect(checkScreenshotFile("image/png", 1000)).toBeNull();
    expect(checkScreenshotFile("image/jpeg", REPORT_LIMITS.screenshotBytesMax)).toBeNull();
    expect(checkScreenshotFile("image/gif", 10)).toBe("report.v.type");
    expect(checkScreenshotFile("image/png", REPORT_LIMITS.screenshotBytesMax + 1)).toBe("report.v.size");
  });

  it("at most 3, 5 MB together", () => {
    const mb = 1024 * 1024;
    expect(checkScreenshotList([shot(mb), shot(mb)], mb)).toBeNull();
    expect(checkScreenshotList([shot(mb), shot(mb), shot(mb)], mb)).toBe("report.v.count");
    expect(checkScreenshotList([shot(1.9 * mb), shot(1.9 * mb)], 1.9 * mb)).toBe("report.v.total");
    expect(validateDraft(good({ screenshots: [shot(2.5 * mb)] })).screenshots).toBe("report.v.size");
  });

  it("base64 sizes", () => {
    expect(base64Bytes(btoa("abc"))).toBe(3);
    expect(base64Bytes(btoa("abcd"))).toBe(4);
    expect(base64Bytes(btoa("abcde"))).toBe(5);
  });
});

describe("instance id and gate", () => {
  it("a v4 uuid, made once and kept", () => {
    const s = new MemStorage();
    const id = instanceId(s);
    expect(isUuidV4(id)).toBe(true);
    expect(s.getItem(INSTANCE_KEY)).toBe(id);
    expect(instanceId(s)).toBe(id);
    s.setItem(INSTANCE_KEY, "garbage");
    expect(instanceId(s)).not.toBe("garbage");
    expect(isUuidV4(randomUuid())).toBe(true);
  });

  it("one report per hour; minutes round up", () => {
    const s = new MemStorage();
    const t0 = 1_000_000;
    expect(waitMs(t0, nextAllowedAt(s))).toBe(0);
    recordSubmitted(t0, s);
    expect(waitMs(t0 + 17 * 60_000, nextAllowedAt(s))).toBe(43 * 60_000);
    expect(waitMinutes(43 * 60_000)).toBe(43);
    expect(waitMinutes(42 * 60_000 + 1)).toBe(43);
    expect(waitMinutes(1)).toBe(1);
    expect(waitMinutes(0)).toBe(0);
    expect(waitMs(t0 + 60 * 60_000, nextAllowedAt(s))).toBe(0);
  });
});

describe("payload", () => {
  it("contains exactly the dialog's content", () => {
    const d = buildDiagnostics({ userAgent: "UA", width: 1400.4, height: 900, docStats: { cells: 4 } });
    const p = buildPayload(good(), ctx, d);
    expect(p).toEqual({
      ...ctx,
      kind: "bug",
      title: "Sum is wrong",
      description: "The SUM of A1:A3 shows 5 instead of 6.",
      steps: "1. Type\n2. Sum",
      diagnostics: { userAgent: "UA", viewport: { width: 1400, height: 900 } , docStats: { cells: 4 } },
      screenshots: [],
    });
  });

  it("leaves out diagnostics when unticked and steps for other kinds", () => {
    const d = buildDiagnostics({ userAgent: "UA", width: 1, height: 1 });
    const p = buildPayload(good({ kind: "feature", includeDiagnostics: false }), ctx, d);
    expect(p.diagnostics).toBeUndefined();
    expect(p.steps).toBeUndefined();
    expect(Object.keys(p).sort()).toEqual(["app", "appVersion", "description", "instanceId", "kind", "locale", "os", "platform", "screenshots", "title"]);
  });

  it("document statistics are counts only", () => {
    expect(cleanDocStats({ cells: 3, blocks: -1, slides: 2.5, text: "secret" } as never)).toEqual({ cells: 3 });
    expect(cleanDocStats({})).toBeUndefined();
    const d = buildDiagnostics({ userAgent: "UA", width: 1, height: 1, docStats: { blocks: 7, content: "<w:t>secret</w:t>" } as never });
    expect(JSON.stringify(d)).not.toContain("secret");
  });

  it("titles become one line", () => {
    expect(buildPayload(good({ title: " a\nb\tc " }), ctx, null).title).toBe("a b c");
  });

  it("app and version from ping, OS from the user agent", () => {
    expect(parsePing("Rusuite Calc 0.1.0")).toEqual({ app: "calc", version: "0.1.0" });
    expect(parsePing("Rusuite Write 1.2.3-beta")).toEqual({ app: "write", version: "1.2.3-beta" });
    expect(parsePing("")).toEqual({ app: null, version: "unknown" });
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macOS");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(detectOs("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
  });
});

describe("client", () => {
  const payload = buildPayload(good(), ctx, null);
  const fetchWith = (res: Response | Error, seen: { url?: string; init?: RequestInit } = {}): ReportFetch => async (url, init) => {
    seen.url = url;
    seen.init = init;
    if (res instanceof Error) throw res;
    return res;
  };

  it("relay URL: relative on the web, baked in on the desktop", () => {
    expect(relayUrl("web")).toBe("/api/report");
    expect(relayUrl("desktop", undefined)).toBe(DEFAULT_RELAY_URL);
    expect(relayUrl("desktop", "https://example.test/api/report")).toBe("https://example.test/api/report");
  });

  it("201 → the issue; no cookies, no referrer", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const r = await sendReport("/api/report", payload, fetchWith(reply(201, { number: 42, url: "https://github.com/o/r/issues/42" }), seen));
    expect(r).toEqual({ kind: "ok", number: 42, url: "https://github.com/o/r/issues/42", warnings: [] });
    expect(seen.init?.method).toBe("POST");
    expect(seen.init?.credentials).toBe("omit");
    expect(seen.init?.referrerPolicy).toBe("no-referrer");
    expect(JSON.parse(String(seen.init?.body))).toEqual(payload);
  });

  it("201 with warnings; a non-https issue URL is refused", async () => {
    const r = await sendReport("/x", payload, fetchWith(reply(201, { number: 1, url: "https://github.com/o/r/issues/1", warnings: ["screenshots not attached"] })));
    expect(r).toMatchObject({ kind: "ok", warnings: ["screenshots not attached"] });
    expect(await sendReport("/x", payload, fetchWith(reply(201, { number: 1, url: "javascript:alert(1)" })))).toEqual({ kind: "failed", status: 201 });
  });

  it("429 → retry time from the body or the header", async () => {
    expect(await sendReport("/x", payload, fetchWith(reply(429, { retryAfterSeconds: 2580 })))).toEqual({ kind: "rateLimited", retryAfterSeconds: 2580 });
    expect(await sendReport("/x", payload, fetchWith(reply(429, null, { "retry-after": "60" })))).toEqual({ kind: "rateLimited", retryAfterSeconds: 60 });
  });

  it("502, 400, 413, offline, other", async () => {
    expect(await sendReport("/x", payload, fetchWith(reply(502, { error: "GitHub did not accept the report" })))).toEqual({ kind: "github" });
    expect(await sendReport("/x", payload, fetchWith(reply(400, { error: "description: at least 20 characters" })))).toEqual({ kind: "invalid", message: "description: at least 20 characters" });
    expect(await sendReport("/x", payload, fetchWith(reply(413, { error: "big" })))).toEqual({ kind: "tooLarge" });
    expect(await sendReport("/x", payload, fetchWith(reply(500, undefined)))).toEqual({ kind: "failed", status: 500 });
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      expect(await sendReport("/x", payload, fetchWith(new TypeError("Failed to fetch")))).toEqual({ kind: "offline" });
    } finally {
      delete (navigator as unknown as { onLine?: boolean }).onLine;
      if (online) Object.defineProperty(Navigator.prototype, "onLine", online);
    }
    expect(await sendReport("/x", payload, fetchWith(new TypeError("Failed to fetch")))).toEqual({ kind: "network" });
  });
});

describe("controller", () => {
  function setup(responses: Response[]) {
    let now = 5_000_000;
    const sent: unknown[] = [];
    const storage = new MemStorage();
    const c = new ReportController({
      storage,
      now: () => now,
      env: () => ({ userAgent: "UA", platform: "Linux", width: 800, height: 600 }),
      fetch: async (url, init) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return responses.shift() ?? reply(500, undefined);
      },
      capture: async () => null,
    });
    c.attach({ kind: "wasm", ping: async () => "Rusuite Show 0.1.0" });
    c.setDocStats(() => ({ slides: 3 }));
    return { c, sent, storage, advance: (ms: number) => (now += ms) };
  }

  it("sends nothing until submit; then the success and the gate", async () => {
    const { c, sent, advance } = setup([reply(201, { number: 7, url: "https://github.com/o/r/issues/7" })]);
    c.open();
    expect(c.getState().diagnostics).toEqual({ userAgent: "UA", viewport: { width: 800, height: 600 }, docStats: { slides: 3 } });
    expect(sent).toEqual([]);
    const r = await c.submit(good());
    expect(r.kind).toBe("ok");
    expect(sent).toHaveLength(1);
    const body = (sent[0] as { url: string; body: Record<string, unknown> });
    expect(body.url).toBe("/api/report");
    expect(body.body).toMatchObject({ app: "show", appVersion: "0.1.0", platform: "web", os: "Linux", diagnostics: c.getState().diagnostics });
    expect(c.getState().phase).toBe("done");
    advance(17 * 60_000);
    expect(waitMinutes(c.waitMs())).toBe(43);
    // A second submit within the hour is refused locally.
    expect((await c.submit(good())).kind).toBe("rateLimited");
    expect(sent).toHaveLength(1);
  });

  it("429 sets the gate from the relay; 502 keeps the draft for a retry", async () => {
    const { c } = setup([reply(502, { error: "x" }), reply(429, { retryAfterSeconds: 600 })]);
    c.open();
    c.draft = good();
    expect((await c.submit(good())).kind).toBe("github");
    expect(c.getState().phase).toBe("edit");
    expect(c.draft.title).toBe("Sum is wrong");
    expect((await c.submit(good())).kind).toBe("rateLimited");
    expect(c.waitMs()).toBe(600_000);
  });

  it("notes the last uncaught error for the diagnostics", () => {
    const { c } = setup([]);
    c.noteError("TypeError: x is undefined");
    c.open();
    expect(c.getState().diagnostics?.lastError).toBe("TypeError: x is undefined");
  });
});
