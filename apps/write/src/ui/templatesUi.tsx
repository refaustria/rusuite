// File › New (Word's template gallery: Blank document plus the shipped
// Report, Letter, Memo and Minutes templates, `public/templates/*.dotx`,
// written by write-core's `templates` module) and the web's Save As dialog
// with Word's "Save as type" (Word Document / Word Template).

import { useEffect, useState } from "react";
import { bytesToBase64, Dialog, getLocale, withExtension } from "@rusuite/ui-shared";
import { isTemplateName } from "../sync/SyncPlugin";
import { useT } from "../i18n";
import { BUTTON, INPUT } from "./dialogs";

/** The shipped templates, in gallery order (write-core `TEMPLATE_IDS`). */
export const TEMPLATE_IDS = ["report", "letter", "memo", "minutes"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** The file of template `id` for the UI language (German: `memo.de.dotx`). */
export function templateFile(id: TemplateId, locale = getLocale()): string {
  return locale.toLowerCase().startsWith("de") ? `${id}.de.dotx` : `${id}.dotx`;
}

/** Where the app serves its templates (Vite `public/`, under the app's base URL). */
export function templateUrl(id: TemplateId, locale = getLocale(), base: string = import.meta.env.BASE_URL ?? "/"): string {
  return `${base.endsWith("/") ? base : `${base}/`}templates/${templateFile(id, locale)}`;
}

/** Fetches a shipped template as base64. */
export async function fetchTemplate(id: TemplateId, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(templateUrl(id));
  if (!res.ok) throw new Error(`${templateUrl(id)}: HTTP ${res.status}`);
  return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
}

/** A file name for Save As: `.dotx` kept for templates, else `.docx` added. */
export function saveAsName(name: string, template: boolean): string {
  const n = name.trim();
  if (template) return isTemplateName(n) ? n : `${n.replace(/\.docx$/i, "")}.dotx`;
  return withExtension(n.replace(/\.dotx$/i, ""), ".docx");
}

/** A miniature of a page in the gallery (title bar, text lines; `kind` shapes it a little). */
function Thumb({ kind }: { kind: "blank" | TemplateId }) {
  const line = (w: string, extra = "") => <span className={`block h-1 rounded bg-neutral-300 ${extra}`} style={{ width: w }} />;
  return (
    <span className="flex h-28 w-20 flex-col gap-1 border border-ui-border bg-white p-2 shadow-sm" aria-hidden="true">
      {kind === "blank" ? null : kind === "letter" ? (
        <>
          {line("40%")}
          {line("35%")}
          <span className="h-2" />
          {line("50%", "self-end")}
          {[90, 95, 80, 92, 60].map((w, i) => (
            <span key={i}>{line(`${w}%`)}</span>
          ))}
        </>
      ) : (
        <>
          <span className={`block h-2 rounded ${kind === "memo" ? "w-1/2 bg-neutral-700" : "w-3/4 bg-[#2f5496]"}`} />
          {kind === "minutes" || kind === "memo" ? [60, 55, 65].map((w, i) => <span key={i}>{line(`${w}%`)}</span>) : line("50%", "bg-neutral-400")}
          {kind === "memo" && <span className="block h-px bg-neutral-700" />}
          <span className="block h-1.5 w-1/2 rounded bg-[#2f5496]/70" />
          {[95, 90, 85].map((w, i) => (
            <span key={i}>{line(`${w}%`)}</span>
          ))}
          {kind === "minutes" && <span className="block h-4 border border-neutral-300" />}
        </>
      )}
    </span>
  );
}

/** File › New: Blank document or one of the shipped templates. */
export function NewDocumentDialog({ open, onBlank, onTemplate, onClose }: {
  open: boolean;
  onBlank: () => void;
  onTemplate: (id: TemplateId) => void;
  onClose: () => void;
}) {
  const t = useT();
  const item = (kind: "blank" | TemplateId, label: string, onPick: () => void) => (
    <li key={kind}>
      <button
        type="button"
        data-testid={`new-${kind}`}
        className="flex flex-col items-center gap-1 rounded p-2 text-xs hover:bg-ui-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-focus"
        onClick={onPick}
      >
        <Thumb kind={kind} />
        <span>{label}</span>
      </button>
    </li>
  );
  return (
    <Dialog open={open} title={t("write.new.title")} onClose={onClose}>
      <div className="flex w-[34rem] max-w-full flex-col gap-2 text-sm" data-testid="new-gallery">
        <ul className="flex flex-wrap gap-2">
          {item("blank", t("write.new.blank"), onBlank)}
          {TEMPLATE_IDS.map((id) => item(id, t(`write.new.${id}`), () => onTemplate(id)))}
        </ul>
        <p className="text-xs text-ui-muted">{t("write.new.hint")}</p>
        <div className="flex justify-end">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The web's Save As: file name and Word's "Save as type". */
export function SaveAsDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [template, setTemplate] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTemplate(isTemplateName(initial));
    setName(initial.replace(/\.(docx|dotx)$/i, ""));
  }, [open, initial]);
  return (
    <Dialog open={open} title={t("cmd.saveAs")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(saveAsName(name, template || isTemplateName(name)));
        }}
      >
        <label className="flex flex-col gap-1">
          {t("saveAs.fileName")}
          <input aria-label={t("saveAs.fileName")} className={INPUT} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {t("write.saveAs.type")}
          <select aria-label={t("write.saveAs.type")} className={INPUT} value={template ? "dotx" : "docx"} onChange={(e) => setTemplate(e.target.value === "dotx")}>
            <option value="docx">{t("write.saveAs.docx")}</option>
            <option value="dotx">{t("write.saveAs.dotx")}</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={!name.trim()}>
            {t("cmd.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
