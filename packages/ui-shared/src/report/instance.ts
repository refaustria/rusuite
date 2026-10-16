// The app instance id (a random version 4 UUID made once and kept in `localStorage` – on the desktop that is the
// webview's storage in the app data directory; never derived from hardware) and the client-side 1-per-hour gate.

import { REPORT_LIMITS } from "./types";

export const INSTANCE_KEY = "rusuite.report.instance";
export const NEXT_KEY = "rusuite.report.nextAllowedAt";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(s: string | null | undefined): s is string {
  return !!s && UUID_V4.test(s);
}

export function localStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A random v4 UUID (`crypto.randomUUID`, or built from `getRandomValues`). */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let memoryId: string | null = null;

/** This installation's id: stored on first use; without storage, one per page. */
export function instanceId(store: Storage | null = localStore()): string {
  try {
    const v = store?.getItem(INSTANCE_KEY);
    if (isUuidV4(v)) return v;
  } catch {
    // blocked storage
  }
  const id = memoryId ?? randomUuid();
  memoryId = id;
  try {
    store?.setItem(INSTANCE_KEY, id);
  } catch {
    // the id lasts for this page
  }
  return id;
}

/** When the next report may be sent (ms since the epoch; 0 = now). */
export function nextAllowedAt(store: Storage | null = localStore()): number {
  try {
    const n = Number(store?.getItem(NEXT_KEY) ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setNextAllowedAt(at: number, store: Storage | null = localStore()): void {
  try {
    store?.setItem(NEXT_KEY, String(Math.round(at)));
  } catch {
    // the gate lasts for this page (the relay enforces the limit anyway)
  }
}

/** After a successful report: the next one in an hour. */
export function recordSubmitted(now: number, store: Storage | null = localStore()): number {
  const at = now + REPORT_LIMITS.gapMs;
  setNextAllowedAt(at, store);
  return at;
}

/** Milliseconds until another report may be sent (0 = now). */
export function waitMs(now: number, next: number): number {
  return Math.max(0, next - now);
}

/** Whole minutes for "in 43 min" (at least 1 while waiting). */
export function waitMinutes(ms: number): number {
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 60_000));
}
