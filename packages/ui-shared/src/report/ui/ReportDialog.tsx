// Help › Report a problem… / File › Report a problem…: the dialog (P8-43). Kind, title, description, steps (bugs),
// screenshots (picked files or a capture of this window), the diagnostics with their exact preview, the public-posting
// notice with "I understand", then progress → the issue link, or the relay's error.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "../../Dialog";
import { FOCUS_RING } from "../../Popover";
import { bytesToBase64 } from "../../base64";
import { useT } from "../../i18n/react";
import type { TFunction } from "../../i18n/core";
import { CAPTURE_EXCLUDE_ATTR } from "../capture";
import type { SendResult } from "../client";
import { reportProblem, type ReportController, type ReportHost } from "../controller";
import { waitMinutes } from "../instance";
import { REPORT_ISSUES_URL, REPORT_LIMITS, type ReportDraft, type ReportKind, type ReportScreenshot } from "../types";
import { checkScreenshotFile, checkScreenshotList, isValid, screenshotMime, validateDraft, type DraftErrors } from "../validate";
import { useReport } from "./hooks";

const BUTTON = `inline-flex h-8 items-center gap-1.5 rounded border border-ui-border px-3 text-sm hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const PRIMARY = `inline-flex h-8 items-center gap-1.5 rounded bg-ui-focus px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const INPUT = `w-full rounded border border-ui-border bg-ui-bg px-2 py-1 text-sm text-ui-fg ${FOCUS_RING}`;
const KINDS: ReportKind[] = ["bug", "feature", "question"];

/** The message for a failed submit. */
export function outcomeMessage(t: TFunction, r: SendResult, now: number, next: number): string | null {
  switch (r.kind) {
    case "ok":
      return null;
    case "rateLimited":
      return t("report.err.rate", { minutes: waitMinutes(Math.max(next - now, 1000)) });
    case "github":
      return t("report.err.github");
    case "offline":
      return t("report.err.offline");
    case "network":
      return t("report.err.network");
    case "tooLarge":
      return t("report.err.tooLarge");
    case "invalid":
      return t("report.err.invalid", { message: r.message });
    case "failed":
      return t("report.err.failed", { status: r.status });
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error ?? new Error("cannot read file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Re-renders every 30 s while shown (the "in 43 min" countdown). */
function useTicker(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [on]);
}

function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-baseline justify-between gap-2 font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-ui-muted">{hint}</span>}
      </span>
      {children}
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </label>
  );
}

function Success({ c, result }: { c: ReportController; result: Extract<SendResult, { kind: "ok" }> }) {
  const t = useT();
  const next = useReport(c, (s) => s.nextAllowedAt);
  useTicker(true);
  const minutes = waitMinutes(next - c.now());
  return (
    <div className="flex flex-col gap-3" data-testid="report-success">
      <p className="text-sm" role="status">
        {t("report.done", { number: result.number })}
      </p>
      <a href={result.url} target="_blank" rel="noopener noreferrer" className={`text-sm font-medium text-ui-focus underline ${FOCUS_RING}`} data-testid="report-issue-link">
        {t("report.openIssue")}
      </a>
      {result.warnings.includes("screenshots not attached") && (
        <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="report-warning">
          {t("report.warningScreenshots")}
        </p>
      )}
      {minutes > 0 && (
        <p className="text-xs text-ui-muted" data-testid="report-wait">
          {t("report.wait", { minutes })}
        </p>
      )}
      <div className="flex justify-end">
        <button type="button" className={PRIMARY} onClick={() => c.close()}>
          {t("report.close")}
        </button>
      </div>
    </div>
  );
}

function Form({ c }: { c: ReportController }) {
  const t = useT();
  const phase = useReport(c, (s) => s.phase);
  const outcome = useReport(c, (s) => s.outcome);
  const diagnostics = useReport(c, (s) => s.diagnostics);
  const next = useReport(c, (s) => s.nextAllowedAt);
  const [draft, setDraftState] = useState<ReportDraft>(c.draft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [shotError, setShotError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const waitMins = waitMinutes(next - c.now());
  useTicker(waitMins > 0);
  const sending = phase === "sending";

  const setDraft = (patch: Partial<ReportDraft>) =>
    setDraftState((d) => {
      const n = { ...d, ...patch };
      c.draft = n;
      return n;
    });
  const addShot = (s: ReportScreenshot, bytes: number): boolean => {
    const err = checkScreenshotList(c.draft.screenshots, bytes);
    if (err) {
      setShotError(t(err, { name: s.name }));
      return false;
    }
    setShotError(null);
    setDraft({ screenshots: [...c.draft.screenshots, s] });
    return true;
  };
  const onFiles = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const err = checkScreenshotFile(f.type, f.size);
      if (err) {
        setShotError(t(err, { name: f.name }));
        continue;
      }
      const data = await readFile(f).catch(() => null);
      if (data === null) continue;
      if (!addShot({ name: f.name.slice(0, 100), mime: screenshotMime(f.type)!, dataBase64: data }, f.size)) break;
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const capture = async () => {
    setCapturing(true);
    try {
      const s = await c.capture();
      if (s) addShot(s, Math.floor((s.dataBase64.length * 3) / 4));
      else setShotError(t("report.captureFailed"));
    } catch {
      setShotError(t("report.captureFailed"));
    } finally {
      setCapturing(false);
    }
  };
  const submit = () => {
    const e = validateDraft(draft);
    setErrors(e);
    if (!isValid(e)) return;
    void c.submit(draft);
  };
  const msg = outcome ? outcomeMessage(t, outcome, c.now(), next) : null;
  const err = (k: keyof DraftErrors) => (errors[k] ? t(errors[k]!) : undefined);
  const titleLen = Array.from(draft.title).length;
  const descLen = Array.from(draft.description.trim()).length;

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="report-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" disabled={sending}>
        <legend className="mb-1 font-medium">{t("report.kind")}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex min-h-8 items-center gap-1.5">
            <input type="radio" name="report-kind" value={k} checked={draft.kind === k} onChange={() => setDraft({ kind: k })} />
            {t(`report.kind.${k}`)}
          </label>
        ))}
      </fieldset>
      <Field label={t("report.titleLabel")} error={err("title")} hint={`${titleLen} / ${REPORT_LIMITS.titleMax}`}>
        <input
          className={`${INPUT} h-8`}
          value={draft.title}
          maxLength={REPORT_LIMITS.titleMax}
          placeholder={t("report.titlePlaceholder")}
          disabled={sending}
          data-testid="report-title"
          onChange={(e) => setDraft({ title: e.target.value })}
        />
      </Field>
      <Field label={t("report.description")} error={err("description")} hint={`${descLen} / ${REPORT_LIMITS.descriptionMax}`}>
        <textarea
          className={`${INPUT} min-h-24`}
          rows={5}
          value={draft.description}
          maxLength={REPORT_LIMITS.descriptionMax + 200}
          placeholder={t(`report.descriptionPlaceholder.${draft.kind}`)}
          disabled={sending}
          data-testid="report-description"
          onChange={(e) => setDraft({ description: e.target.value })}
        />
      </Field>
      {draft.kind === "bug" && (
        <Field label={t("report.steps")} error={err("steps")}>
          <textarea
            className={`${INPUT} min-h-16`}
            rows={3}
            value={draft.steps}
            placeholder={t("report.stepsPlaceholder")}
            disabled={sending}
            data-testid="report-steps"
            onChange={(e) => setDraft({ steps: e.target.value })}
          />
        </Field>
      )}
      <section aria-label={t("report.screenshots")} className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("report.screenshots")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} disabled={sending || draft.screenshots.length >= REPORT_LIMITS.screenshotsMax} onClick={() => fileInput.current?.click()}>
            {t("report.addScreenshot")}
          </button>
          <button type="button" className={BUTTON} disabled={sending || capturing || draft.screenshots.length >= REPORT_LIMITS.screenshotsMax} onClick={() => void capture()} data-testid="report-capture">
            {capturing ? t("report.capturing") : t("report.capture")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            hidden
            data-testid="report-file"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>
        <p className="text-xs text-ui-muted">{t("report.captureNote")}</p>
        {draft.screenshots.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="report-shots">
            {draft.screenshots.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex flex-col items-center gap-1 rounded border border-ui-border p-1">
                <img src={`data:${s.mime};base64,${s.dataBase64}`} alt={s.name} className="h-16 w-24 object-contain" />
                <span className="max-w-24 truncate text-xs" title={s.name}>
                  {s.name}
                </span>
                <button
                  type="button"
                  className={`${BUTTON} h-7 px-2 text-xs`}
                  disabled={sending}
                  aria-label={t("report.removeScreenshot", { name: s.name })}
                  onClick={() => setDraft({ screenshots: draft.screenshots.filter((_, j) => j !== i) })}
                >
                  {t("report.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {(shotError || errors.screenshots) && (
          <p className="text-xs text-red-700 dark:text-red-400" data-testid="report-shot-error">
            {shotError ?? t(errors.screenshots!)}
          </p>
        )}
      </section>
      <div className="flex flex-col gap-1 text-sm">
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" checked={draft.includeDiagnostics} disabled={sending} data-testid="report-diagnostics" onChange={(e) => setDraft({ includeDiagnostics: e.target.checked })} />
          {t("report.diagnostics")}
        </label>
        <p className="text-xs text-ui-muted">{t("report.diagnosticsHint")}</p>
        {draft.includeDiagnostics && diagnostics && (
          <details className="text-xs">
            <summary className={`cursor-pointer select-none py-1 ${FOCUS_RING}`}>{t("report.diagnosticsShow")}</summary>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-ui-border bg-ui-bg p-2 font-mono" data-testid="report-diagnostics-preview">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          </details>
        )}
      </div>
      <div role="note" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100" data-testid="report-public">
        <p className="font-medium">{t("report.public", { url: REPORT_ISSUES_URL.replace(/^https:\/\//, "") })}</p>
        <label className="mt-2 flex min-h-8 items-center gap-2">
          <input type="checkbox" checked={draft.understood} disabled={sending} data-testid="report-understood" onChange={(e) => setDraft({ understood: e.target.checked })} />
          {t("report.understand")}
        </label>
      </div>
      {waitMins > 0 && (
        <p className="text-sm text-ui-muted" data-testid="report-wait">
          {t("report.wait", { minutes: waitMins })}
        </p>
      )}
      {msg && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="report-error">
          {msg}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {sending && (
          <span role="status" className="mr-auto text-sm text-ui-muted" data-testid="report-sending">
            {t("report.sending")}
          </span>
        )}
        <button type="button" className={BUTTON} disabled={sending} onClick={() => c.close()}>
          {t("report.cancel")}
        </button>
        <button type="submit" className={PRIMARY} disabled={sending || !draft.understood || waitMins > 0} data-testid="report-submit">
          {t("report.submit")}
        </button>
      </div>
    </form>
  );
}

/** The dialog (rendered by the backstage, also while it is closed). */
export function ReportDialog({ controller = reportProblem }: { controller?: ReportController }) {
  const t = useT();
  const open = useReport(controller, (s) => s.open);
  const phase = useReport(controller, (s) => s.phase);
  const outcome = useReport(controller, (s) => s.outcome);
  if (!open) return null;
  return (
    <div {...{ [CAPTURE_EXCLUDE_ATTR]: "" }}>
      <Dialog open title={t("report.title")} onClose={() => controller.close()}>
        <div className="max-h-[calc(100vh-6rem)] w-[36rem] max-w-[calc(100vw-3rem)] overflow-auto pr-1" data-testid="report-dialog">
          {phase === "done" && outcome?.kind === "ok" ? <Success c={controller} result={outcome} /> : <Form c={controller} />}
        </div>
      </Dialog>
    </div>
  );
}

/** Mounts the dialog and gives the controller the window's backend. */
export function ReportOverlay({ host, controller = reportProblem }: { host?: ReportHost | null; controller?: ReportController }) {
  useEffect(() => controller.attach(host), [controller, host]);
  return <ReportDialog controller={controller} />;
}
