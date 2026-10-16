// "Report a problem" (P8-43): dialog, controller and the relay client.
export * from "./types";
export { relayUrl, DEFAULT_RELAY_URL, type SendResult, type ReportFetch } from "./client";
export { ReportController, reportProblem, type ReportHost, type ReportState, type ReportPhase } from "./controller";
export { buildPayload, buildDiagnostics, parsePing, detectOs, type ReportContext } from "./payload";
export { instanceId, waitMinutes } from "./instance";
export { validateDraft, checkScreenshotFile, checkScreenshotList } from "./validate";
export { ReportDialog, ReportOverlay } from "./ui/ReportDialog";
export { HelpMenu, ReportBackstageItem } from "./ui/ribbon";
