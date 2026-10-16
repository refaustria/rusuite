// The report transport: the only `fetch` of "Report a problem" (scripts/privacy-check.sh allow-list). It runs only
// when the user submits the dialog (`ReportController.submit`), never at start-up or in the background. Web: the
// site's own relay (`/api/report`, same origin – the CSP stays `connect-src 'self'`); desktop: the URL baked in at
// build time (`REPORT_RELAY_URL`, default `https://rusuit.es/api/report`). No cookies, no referrer.

import type { ReportPayload, ReportPlatform } from "./types";

export const DEFAULT_RELAY_URL = "https://rusuit.es/api/report";

export type SendResult =
  | { kind: "ok"; number: number; url: string; warnings: string[] }
  | { kind: "rateLimited"; retryAfterSeconds: number }
  | { kind: "github" }
  | { kind: "invalid"; message: string }
  | { kind: "tooLarge" }
  | { kind: "offline" }
  | { kind: "network" }
  | { kind: "failed"; status: number };

export type ReportFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The build-time override (`REPORT_RELAY_URL`, exposed by the apps' Vite `envPrefix`). */
function bakedRelayUrl(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.REPORT_RELAY_URL?.trim();
    return v ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Web: the relative `/api/report`; desktop: the baked-in URL. */
export function relayUrl(platform: ReportPlatform, baked = bakedRelayUrl()): string {
  if (platform === "web") return "/api/report";
  return baked ?? DEFAULT_RELAY_URL;
}

const browserFetch: ReportFetch = (url, init) => fetch(url, init);

/** Seconds from the body's `retryAfterSeconds`, else the `Retry-After` header, else an hour. */
function retryAfter(body: unknown, header: string | null): number {
  const b = (body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  if (typeof b === "number" && Number.isFinite(b) && b >= 0) return Math.ceil(b);
  const h = Number(header);
  return Number.isFinite(h) && h >= 0 && header !== null ? Math.ceil(h) : 3600;
}

/** Posts the report; never throws. */
export async function sendReport(url: string, payload: ReportPayload, fetchImpl: ReportFetch = browserFetch): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine === false ? { kind: "offline" } : { kind: "network" };
  }
  const body: unknown = await res.json().catch(() => null);
  const o = (body ?? {}) as Record<string, unknown>;
  switch (res.status) {
    case 201:
    case 200:
      if (typeof o.number === "number" && typeof o.url === "string" && /^https:\/\//.test(o.url)) {
        const warnings = Array.isArray(o.warnings) ? o.warnings.filter((w): w is string => typeof w === "string") : [];
        return { kind: "ok", number: o.number, url: o.url, warnings };
      }
      return { kind: "failed", status: res.status };
    case 400:
      return { kind: "invalid", message: typeof o.error === "string" ? o.error.slice(0, 300) : "" };
    case 413:
      return { kind: "tooLarge" };
    case 429:
      return { kind: "rateLimited", retryAfterSeconds: retryAfter(body, res.headers.get("retry-after")) };
    case 502:
      return { kind: "github" };
    default:
      return { kind: "failed", status: res.status };
  }
}
