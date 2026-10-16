// Building the report from the dialog: the user's text, the screenshots they chose and – if they keep "Include
// diagnostics" on – the diagnostics shown in the dialog. Nothing reads the document itself: the app only supplies
// counts (`DocStats`).

import type { DocStats, ReportApp, ReportDiagnostics, ReportDraft, ReportPayload, ReportPlatform } from "./types";

/** Who sends: filled in from the backend's `ping()`, the platform and the UI language. */
export interface ReportContext {
  app: ReportApp;
  appVersion: string;
  platform: ReportPlatform;
  os: string;
  locale: string;
  instanceId: string;
}

/** `"Rusuite Calc 0.1.0"` → `{ app: "calc", version: "0.1.0" }`. */
export function parsePing(ping: string): { app: ReportApp | null; version: string } {
  const m = /Rusuite\s+(Calc|Write|Show)\b\s*(\S+)?/i.exec(ping);
  const app = (m?.[1]?.toLowerCase() as ReportApp | undefined) ?? null;
  return { app, version: m?.[2]?.slice(0, 40) ?? "unknown" };
}

/** The operating system name: from the platform hint when it names one, else from the user agent. */
export function detectOs(ua: string, platform = ""): string {
  const name = (s: string) => {
    if (/Android/i.test(s)) return "Android";
    if (/iPhone|iPad|iPod/i.test(s)) return "iOS";
    if (/CrOS|Chrome OS/i.test(s)) return "ChromeOS";
    if (/Win/i.test(s)) return "Windows";
    if (/Mac/i.test(s)) return "macOS";
    if (/Linux|X11/i.test(s)) return "Linux";
    return null;
  };
  return name(platform) ?? name(ua) ?? "unknown";
}

/** Counts only: anything but non-negative integers of the three known keys is dropped. */
export function cleanDocStats(stats: DocStats | null | undefined): DocStats | undefined {
  if (!stats) return undefined;
  const out: DocStats = {};
  for (const k of ["blocks", "cells", "slides"] as const) {
    const v = stats[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One line of at most `max` characters, control characters removed. */
export const oneLine = (s: string, max: number) =>
  Array.from(s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()).slice(0, max).join("");

export interface DiagnosticsSource {
  userAgent: string;
  width: number;
  height: number;
  docStats?: DocStats | null;
  lastError?: string | null;
}

export function buildDiagnostics(src: DiagnosticsSource): ReportDiagnostics {
  const d: ReportDiagnostics = {
    userAgent: oneLine(src.userAgent, 500),
    viewport: { width: Math.max(0, Math.round(src.width)), height: Math.max(0, Math.round(src.height)) },
  };
  const stats = cleanDocStats(src.docStats);
  if (stats) d.docStats = stats;
  const err = src.lastError?.trim();
  if (err) d.lastError = Array.from(err).slice(0, 2000).join("");
  return d;
}

/** The request body: exactly the dialog's content (steps only for a bug, diagnostics only when included). */
export function buildPayload(draft: ReportDraft, ctx: ReportContext, diagnostics: ReportDiagnostics | null): ReportPayload {
  const p: ReportPayload = {
    app: ctx.app,
    appVersion: ctx.appVersion,
    platform: ctx.platform,
    os: ctx.os,
    locale: ctx.locale,
    instanceId: ctx.instanceId,
    kind: draft.kind,
    title: oneLine(draft.title, 120),
    description: draft.description.trim(),
    screenshots: draft.screenshots.map((s) => ({ name: s.name, mime: s.mime, dataBase64: s.dataBase64 })),
  };
  const steps = draft.steps.trim();
  if (draft.kind === "bug" && steps) p.steps = steps;
  if (draft.includeDiagnostics && diagnostics) p.diagnostics = diagnostics;
  return p;
}
