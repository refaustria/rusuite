// The AI transport: the only module that calls `fetch` for the assistant (scripts/privacy-check.sh allow-list). It is
// reached only from `Assistant.run`/`Assistant.test`, i.e. when the user enabled AI, entered a key and ran an action
// or pressed Test – never at start-up or in the background. Requests go straight to the provider the user configured:
// no cookies, no referrer, no caching, no redirects to other hosts. A Content-Security-Policy whose `connect-src` does
// not list the provider blocks the request before any traffic; `securitypolicyviolation` events tell that apart from
// CORS / network failures.

import { AiError } from "../types";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** `connect-src` violations seen by this page (origin → time). */
const violations = new Map<string, number>();
let watching = false;

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

function watchCsp(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("securitypolicyviolation", (e) => {
    if (!/^connect-src/.test(e.effectiveDirective || e.violatedDirective || "")) return;
    violations.set(originOf(e.blockedURI), Date.now());
  });
}

/** Records a CSP violation (tests). */
export function noteAiCspViolation(origin: string, at = Date.now()): void {
  violations.set(origin, at);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browserFetch: FetchLike = (url, init) => fetch(url, init);

/** `fetch` to a provider with the failure mapped to an `AiError` (`csp`, `cors`, `network`, `aborted`). */
export async function aiFetch(url: string, init: RequestInit, fetchImpl: FetchLike = browserFetch): Promise<Response> {
  watchCsp();
  const origin = originOf(url);
  const started = Date.now();
  try {
    return await fetchImpl(url, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
      mode: "cors",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new AiError("aborted", "Stopped");
    if (init.signal?.aborted) throw new AiError("aborted", "Stopped");
    // CSP and CORS failures both reject with a TypeError; the violation event arrives around the same time.
    await sleep(30);
    const seen = violations.get(origin);
    if (seen !== undefined && seen >= started - 1000) {
      throw new AiError("csp", `This site's security policy does not allow connections to ${origin}`, null, null, origin);
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AiError("network", "You are offline");
    const page = typeof location === "undefined" ? "this page" : location.origin;
    throw new AiError(
      "cors",
      `${origin} could not be reached from ${page}: the server is down, the address is wrong, or it does not allow requests from this page (CORS).`,
      null,
      null,
      origin,
    );
  }
}

/** Seconds of a `retry-after` header (delta seconds or an HTTP date). */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** The provider's own error message from a JSON error body (Anthropic `{error:{message}}`, OpenAI likewise). */
function bodyMessage(text: string): string | null {
  try {
    const v = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof v.error === "string") return v.error;
    if (v.error && typeof v.error.message === "string") return v.error.message;
    if (typeof v.message === "string") return v.message;
  } catch {
    // not JSON
  }
  return null;
}

/** An HTTP error reply → `AiError` with a clear message. */
export async function errorFromResponse(res: Response, provider: string): Promise<AiError> {
  let detail: string | null = null;
  try {
    detail = bodyMessage(await res.text());
  } catch {
    // body unreadable
  }
  const suffix = detail ? ` (${detail})` : "";
  const s = res.status;
  if (s === 401 || s === 403) return new AiError("auth", `${provider} rejected the API key${suffix}`, s, null, detail);
  if (s === 429) {
    const after = retryAfterSeconds(res.headers.get("retry-after"));
    return new AiError("rateLimit", `${provider}: rate limit reached${after !== null ? ` – try again in ${after} s` : ""}${suffix}`, s, after, detail);
  }
  if (s === 529 || s === 503) return new AiError("overloaded", `${provider} is overloaded – try again shortly${suffix}`, s, null, detail);
  if (s === 404) return new AiError("notFound", `${provider}: not found – check the model and the base URL${suffix}`, s, null, detail);
  if (s >= 500) return new AiError("server", `${provider}: server error ${s}${suffix}`, s, null, detail);
  return new AiError("invalid", `${provider} refused the request (${s})${suffix}`, s, null, detail);
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Server-sent events of a response body (`event:` / `data:` lines, blank-line separated). */
export async function* sseEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "";
  let data: string[] = [];
  const flush = (): SseEvent | null => {
    if (!data.length && !event) return null;
    const out = { event: event || "message", data: data.join("\n") };
    event = "";
    data = [];
    return out;
  };
  try {
    for (;;) {
      if (signal?.aborted) throw new AiError("aborted", "Stopped");
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new AiError("aborted", "Stopped");
        throw new AiError("network", "The connection was interrupted");
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
        if (line === "") {
          const ev = flush();
          if (ev) yield ev;
        } else if (line.startsWith(":")) {
          // comment / keep-alive
        } else {
          const i = line.indexOf(":");
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
      }
    }
    buf += decoder.decode();
    if (buf.trim()) {
      for (const line of buf.split(/\r\n|\r|\n/)) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** Parses a tool call's accumulated JSON strictly (a broken or truncated input is a `badResponse`). */
export function parseToolJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("badResponse", "The model returned an incomplete or invalid structured answer");
  }
}
