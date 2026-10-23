// The window's "Report a problem" controller: one per window (`reportProblem`), shared by the ribbon's Help group,
// the File backstage entry and the dialog. It learns the app from the backend (`ping()`), the document size from the
// app (`setDocStats`, counts only) and the last uncaught error message of the page. Nothing is sent before `submit`.

import { getLocale } from "../i18n/locale";
import { isMobile } from "../mobile/platform";
import { captureWindow, type Capture } from "./capture";
import { relayUrl, sendReport, type ReportFetch, type SendResult } from "./client";
import { instanceId, localStore, nextAllowedAt, recordSubmitted, setNextAllowedAt, waitMs } from "./instance";
import { buildDiagnostics, buildPayload, detectOs, parsePing, type ReportContext } from "./payload";
import { emptyDraft, type DocStats, type ReportDiagnostics, type ReportDraft, type ReportPayload } from "./types";

/** The part of `Backend` the report needs. */
export interface ReportHost {
  readonly kind: "tauri" | "wasm";
  ping(): Promise<string>;
}

export type ReportPhase = "edit" | "sending" | "done";

export interface ReportState {
  open: boolean;
  phase: ReportPhase;
  /** The sender, once the backend answered `ping()`. */
  context: ReportContext | null;
  /** The diagnostics shown in the dialog (taken when it opened) – exactly what is sent. */
  diagnostics: ReportDiagnostics | null;
  /** The last submit's outcome (an error shown under the form, or the success card). */
  outcome: SendResult | null;
  /** When the next report may be sent (ms since the epoch). */
  nextAllowedAt: number;
}

export interface ReportControllerOptions {
  fetch?: ReportFetch;
  now?: () => number;
  storage?: Storage | null;
  capture?: Capture;
  /** Viewport and user agent (tests). */
  env?: () => { userAgent: string; platform: string; width: number; height: number };
}

const browserEnv = () => ({
  userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  platform: typeof navigator === "undefined" ? "" : ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ""),
  width: typeof window === "undefined" ? 0 : window.innerWidth,
  height: typeof window === "undefined" ? 0 : window.innerHeight,
});

/**
 * Whether "Report a problem" is offered: not in the mobile shells (it sends text, screenshots and diagnostics to
 * rusuit.es, and the store privacy declarations say "no data collected"); the web and desktop builds keep it.
 */
export function reportAvailable(): boolean {
  return !isMobile();
}

export class ReportController {
  private state: ReportState;
  private listeners = new Set<() => void>();
  private host: ReportHost | null = null;
  private docStats: (() => DocStats | null | undefined) | null = null;
  private lastError: string | null = null;
  private watching = false;
  /** The dialog's fields, kept while it is closed (cleared after a sent report). */
  draft: ReportDraft = emptyDraft();
  private readonly fetchImpl?: ReportFetch;
  readonly now: () => number;
  private readonly storage: () => Storage | null;
  readonly capture: Capture;
  private readonly env: NonNullable<ReportControllerOptions["env"]>;

  constructor(o: ReportControllerOptions = {}) {
    this.fetchImpl = o.fetch;
    this.now = o.now ?? Date.now;
    this.storage = "storage" in o ? () => o.storage ?? null : localStore;
    this.capture = o.capture ?? captureWindow;
    this.env = o.env ?? browserEnv;
    this.state = { open: false, phase: "edit", context: null, diagnostics: null, outcome: null, nextAllowedAt: 0 };
  }

  getState = (): ReportState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<ReportState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  /** The window's backend (the backstage attaches the session's). Also starts noting uncaught error messages. */
  attach(host: ReportHost | null | undefined): void {
    if (host) this.host = host;
    if (this.watching || typeof window === "undefined") return;
    this.watching = true;
    window.addEventListener("error", (e) => this.noteError(e.message));
    window.addEventListener("unhandledrejection", (e) => this.noteError(e.reason instanceof Error ? e.reason.message : String(e.reason)));
  }

  /** The app's document size (counts only), read when the dialog opens. */
  setDocStats(fn: (() => DocStats | null | undefined) | null): void {
    this.docStats = fn;
  }

  noteError(message: string | null | undefined): void {
    const m = (message ?? "").trim();
    if (m) this.lastError = Array.from(m).slice(0, 300).join("");
  }

  /** Milliseconds until another report may be sent. */
  waitMs(): number {
    return waitMs(this.now(), this.state.nextAllowedAt);
  }

  open(): void {
    if (!reportAvailable()) return;
    const env = this.env();
    let stats: DocStats | null | undefined = null;
    try {
      stats = this.docStats?.();
    } catch {
      stats = null;
    }
    const diagnostics = buildDiagnostics({ userAgent: env.userAgent, width: env.width, height: env.height, docStats: stats, lastError: this.lastError });
    // A finished report starts a new one; one being sent keeps its progress.
    const sending = this.state.phase === "sending";
    this.set({
      open: true,
      diagnostics,
      nextAllowedAt: nextAllowedAt(this.storage()),
      phase: sending ? "sending" : "edit",
      outcome: sending ? this.state.outcome : null,
    });
    void this.resolveContext(env.userAgent, env.platform);
  }

  close(): void {
    if (this.state.phase === "sending") return;
    this.set({ open: false });
  }

  private async resolveContext(ua: string, platform: string): Promise<ReportContext> {
    if (this.state.context) return this.state.context;
    let ping = "";
    try {
      ping = (await this.host?.ping()) ?? "";
    } catch {
      ping = "";
    }
    const { app, version } = parsePing(ping);
    const ctx: ReportContext = {
      app: app ?? appFromPath(),
      appVersion: version,
      platform: this.host?.kind === "tauri" ? "desktop" : "web",
      os: detectOs(ua, platform),
      locale: getLocale(),
      instanceId: instanceId(this.storage()),
    };
    this.set({ context: ctx });
    return ctx;
  }

  /** The request body for `draft` (the dialog's preview uses the same function). */
  async payload(draft: ReportDraft): Promise<ReportPayload> {
    const env = this.env();
    const ctx = await this.resolveContext(env.userAgent, env.platform);
    return buildPayload(draft, { ...ctx, locale: getLocale() }, this.state.diagnostics);
  }

  /** Sends the report (the only network call, on the user's submit). */
  async submit(draft: ReportDraft): Promise<SendResult> {
    if (this.state.phase === "sending") return { kind: "failed", status: 0 };
    const wait = this.waitMs();
    if (wait > 0) {
      const r: SendResult = { kind: "rateLimited", retryAfterSeconds: Math.ceil(wait / 1000) };
      this.set({ outcome: r });
      return r;
    }
    this.set({ phase: "sending", outcome: null });
    const body = await this.payload(draft);
    const r = await sendReport(relayUrl(body.platform), body, this.fetchImpl);
    if (r.kind === "ok") {
      this.draft = emptyDraft();
      this.set({ phase: "done", outcome: r, nextAllowedAt: recordSubmitted(this.now(), this.storage()) });
    } else if (r.kind === "rateLimited") {
      const at = this.now() + r.retryAfterSeconds * 1000;
      setNextAllowedAt(at, this.storage());
      this.set({ phase: "edit", outcome: r, nextAllowedAt: at });
    } else {
      this.set({ phase: "edit", outcome: r });
    }
    return r;
  }
}

/** Without an answer from the backend: the app from the page path (`/calc/`, `/write/`, `/show/`). */
function appFromPath(): ReportContext["app"] {
  const p = typeof location === "undefined" ? "" : location.pathname;
  return /\/write\//.test(p) ? "write" : /\/show\//.test(p) ? "show" : "calc";
}

/** The window's controller. */
export const reportProblem = new ReportController();
