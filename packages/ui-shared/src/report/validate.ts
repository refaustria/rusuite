// Checks of the dialog's fields before anything is sent (the relay checks the same limits).

import { REPORT_LIMITS, type ReportDraft, type ReportScreenshot, type ScreenshotMime } from "./types";

/** Message keys (`report.v.*`) per field; empty = valid. */
export type DraftErrors = Partial<Record<"title" | "description" | "steps" | "screenshots" | "understood", string>>;

const chars = (s: string) => Array.from(s).length;

/** Decoded size of standard base64 (padding aware). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function screenshotMime(type: string): ScreenshotMime | null {
  return type === "image/png" || type === "image/jpeg" ? type : null;
}

/** A file the user picked: its type and size. Returns a message key or null. */
export function checkScreenshotFile(type: string, size: number): string | null {
  if (!screenshotMime(type)) return "report.v.type";
  if (size > REPORT_LIMITS.screenshotBytesMax) return "report.v.size";
  return null;
}

/** Whether `add` may join `list` (count and total size). Returns a message key or null. */
export function checkScreenshotList(list: readonly ReportScreenshot[], addBytes = 0): string | null {
  if (list.length + (addBytes > 0 ? 1 : 0) > REPORT_LIMITS.screenshotsMax) return "report.v.count";
  for (const s of list) if (base64Bytes(s.dataBase64) > REPORT_LIMITS.screenshotBytesMax) return "report.v.size";
  const total = list.reduce((n, s) => n + base64Bytes(s.dataBase64), 0) + addBytes;
  if (total > REPORT_LIMITS.screenshotsTotalMax) return "report.v.total";
  return null;
}

export function validateDraft(d: ReportDraft): DraftErrors {
  const e: DraftErrors = {};
  const title = d.title.trim();
  if (!title || chars(title) > REPORT_LIMITS.titleMax) e.title = "report.v.title";
  const desc = d.description.trim();
  if (chars(desc) < REPORT_LIMITS.descriptionMin || chars(desc) > REPORT_LIMITS.descriptionMax) e.description = "report.v.description";
  if (d.kind === "bug" && chars(d.steps.trim()) > REPORT_LIMITS.stepsMax) e.steps = "report.v.steps";
  const shots = checkScreenshotList(d.screenshots);
  if (shots) e.screenshots = shots;
  if (!d.understood) e.understood = "report.v.understand";
  return e;
}

export const isValid = (e: DraftErrors) => Object.keys(e).length === 0;
