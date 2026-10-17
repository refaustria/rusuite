// File › Info: the document properties (Word's Properties panel). The text
// fields commit on blur / Enter (`SetProperties`, one undo step each);
// created / modified / the statistics are read-only.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { getLocale } from "@rusuite/ui-shared";
import type { CoreProperties } from "../generated/CoreProperties";
import type { DocumentStatistics } from "../generated/DocumentStatistics";
import { isTemplateName } from "../sync/SyncPlugin";
import type { WriteCommand } from "../generated/WriteCommand";
import type { SyncController } from "../sync/SyncPlugin";
import { countDocWords } from "../wordCount";
import { useT } from "../i18n";

/** The editable properties, in Word's order. */
export const INFO_FIELDS: { key: keyof CoreProperties; label: string; multiline?: boolean }[] = [
  { key: "title", label: "write.info.title" },
  { key: "subject", label: "write.info.subject" },
  { key: "author", label: "write.info.author" },
  { key: "keywords", label: "write.info.keywords" },
  { key: "category", label: "write.info.category" },
  { key: "company", label: "write.info.company" },
  { key: "description", label: "write.info.comments", multiline: true },
];

/** `SetProperties` for one edited field (null when unchanged; an empty text clears it). */
export function propertyCommand(props: CoreProperties, key: keyof CoreProperties, text: string): WriteCommand | null {
  const cur = (props[key] as string | undefined) ?? "";
  if (cur === text.trim() || (!cur && !text.trim())) return null;
  return { type: "setProperties", patch: { [key]: text.trim() } };
}

/** A stored ISO date for display in the UI language (the text itself when unparsable). */
export function formatPropertyDate(iso: string | undefined, locale = getLocale()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function Field({ label, value, multiline, onCommit }: { label: string; value: string; multiline?: boolean; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const common = {
    "aria-label": label,
    value: text,
    className: "w-full rounded border border-ui-border bg-ui-bg px-2 py-1 text-sm text-ui-fg",
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => onCommit(text),
  };
  return (
    <label className="grid grid-cols-[9rem_1fr] items-start gap-2 text-sm">
      <span className="pt-1 text-ui-muted">{label}</span>
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(text);
            }
          }}
        />
      )}
    </label>
  );
}

export function InfoPanel({ ctl, editor, pages }: { ctl: SyncController; editor: Editor | null; pages: number | null }) {
  const t = useT();
  const props = useSyncExternalStore(ctl.subscribe, () => ctl.properties);
  const revision = useSyncExternalStore(ctl.subscribe, () => ctl.getState().revision);
  const name = useSyncExternalStore(ctl.subscribe, () => ctl.getState().name);
  const words = editor ? countDocWords(editor.state.doc) : 0;
  // Characters and paragraphs as the core counts them (docProps/app.xml).
  const [stats, setStats] = useState<DocumentStatistics | null>(null);
  useEffect(() => {
    let live = true;
    ctl.api.statistics().then((r) => live && setStats(r.stats), () => undefined);
    return () => {
      live = false;
    };
  }, [ctl, revision]);
  const commit = (key: keyof CoreProperties) => (text: string) => {
    const cmd = propertyCommand(props, key, text);
    if (cmd) void ctl.run(cmd);
  };
  const ro = (label: string, value: string, id: string) => (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <span className="text-ui-muted">{label}</span>
      <span data-testid={id}>{value || "—"}</span>
    </div>
  );
  return (
    <section aria-label={t("write.info.properties")} className="flex max-w-xl flex-col gap-2" data-testid="info-panel">
      <h2 className="mb-1 text-lg font-semibold">{t("write.info.properties")}</h2>
      {INFO_FIELDS.map((f) => (
        <Field key={f.key} label={t(f.label)} value={(props[f.key] as string | undefined) ?? ""} multiline={f.multiline} onCommit={commit(f.key)} />
      ))}
      <h3 className="mt-3 text-sm font-semibold">{t("write.info.related")}</h3>
      {ro(t("write.info.created"), formatPropertyDate(props.created), "info-created")}
      {ro(t("write.info.modified"), formatPropertyDate(props.modified), "info-modified")}
      {ro(t("write.info.lastModifiedBy"), props.lastModifiedBy ?? "", "info-modified-by")}
      {ro(t("write.info.words"), String(words), "info-words")}
      {ro(t("write.info.pages"), String(pages ?? props.pages ?? ""), "info-pages")}
      {ro(t("write.info.characters"), stats ? String(stats.characters) : "", "info-characters")}
      {ro(t("write.info.charactersWithSpaces"), stats ? String(stats.charactersWithSpaces) : "", "info-characters-spaces")}
      {ro(t("write.info.paragraphs"), stats ? String(stats.paragraphs) : "", "info-paragraphs")}
      {ro(t("write.info.template"), t(name && isTemplateName(name) ? "write.info.isTemplate" : "write.info.isDocument"), "info-type")}
    </section>
  );
}
