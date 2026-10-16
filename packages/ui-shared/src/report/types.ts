// "Report a problem" (P8-43, ADR 0009 amendment): the report the dialog sends to the site's relay
// (`POST /api/report`), which posts it publicly as a GitHub issue. Exactly what the dialog shows – never the document.

export type ReportApp = "calc" | "write" | "show";
export type ReportKind = "bug" | "feature" | "question";
export type ReportPlatform = "web" | "desktop";

/** Document size, counts only (Write: blocks, Calc: cells, Show: slides). */
export interface DocStats {
  blocks?: number;
  cells?: number;
  slides?: number;
}

export interface ReportDiagnostics {
  userAgent: string;
  viewport: { width: number; height: number };
  docStats?: DocStats;
  lastError?: string;
}

export type ScreenshotMime = "image/png" | "image/jpeg";

export interface ReportScreenshot {
  name: string;
  mime: ScreenshotMime;
  dataBase64: string;
}

/** The wire format of `POST /api/report` (the relay refuses any other field). */
export interface ReportPayload {
  app: ReportApp;
  appVersion: string;
  platform: ReportPlatform;
  os: string;
  locale: string;
  instanceId: string;
  kind: ReportKind;
  title: string;
  description: string;
  steps?: string;
  diagnostics?: ReportDiagnostics;
  screenshots: ReportScreenshot[];
}

/** What the user typed and picked in the dialog. */
export interface ReportDraft {
  kind: ReportKind;
  title: string;
  description: string;
  steps: string;
  screenshots: ReportScreenshot[];
  includeDiagnostics: boolean;
  understood: boolean;
}

/** The relay's limits (`services/report-relay/src/report.rs`). */
export const REPORT_LIMITS = {
  titleMax: 120,
  descriptionMin: 20,
  descriptionMax: 4000,
  stepsMax: 4000,
  screenshotsMax: 3,
  screenshotBytesMax: 2 * 1024 * 1024,
  screenshotsTotalMax: 5 * 1024 * 1024,
  /** One report per app instance per hour (the relay enforces it too). */
  gapMs: 60 * 60 * 1000,
} as const;

/** Where reports become public. */
export const REPORT_ISSUES_URL = "https://github.com/refaustria/rusuite/issues";

export const emptyDraft = (): ReportDraft => ({
  kind: "bug",
  title: "",
  description: "",
  steps: "",
  screenshots: [],
  includeDiagnostics: true,
  understood: false,
});
