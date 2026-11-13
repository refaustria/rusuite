// View › Page history: the page's versions (newest first: when, which device – names come with sharing, P11-N5b),
// a read-only preview of a version with the paragraphs that differ from the current page highlighted, and
// Restore (the core's `Restore`: new operations, history only grows). Keyboard: ↑/↓ move, Enter previews, Esc
// leaves the preview.

import { useEffect, useRef, useState } from "react";
import { Node as PMNode } from "@tiptap/pm/model";
import { FOCUS_RING, getLocale } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { HistoryEntry } from "../generated/HistoryEntry";
import type { VersionPreview } from "../generated/VersionPreview";
import { blockTexts, changedBlocks, imageBlobs, notesSchema, renderContent } from "../render";
import { useT } from "../i18n";
import { makeEditorEnv } from "./editorEnv";
import { useDialog } from "./dialogs";
import { useNotes } from "./hooks";

export interface VersionView {
  entry: HistoryEntry;
  preview: VersionPreview;
  /** Top-level blocks of the version that differ from the current page. */
  changed: boolean[];
}

/** A stable colour per device (until members have their own colours, P11-N5b). */
export function deviceColor(device: string | null, peer: string): string {
  const s = device ?? peer;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 45%)`;
}

export function HistoryPanel({ ctl, docId, selected, onSelect }: { ctl: NotesController; docId: string; selected: HistoryEntry | null; onSelect: (v: VersionView | null) => void }) {
  const t = useT();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const locale = getLocale();
  useEffect(() => {
    let live = true;
    void ctl.history(docId).then(
      (e) => live && setEntries(e),
      (e) => {
        ctl.fail(e);
        if (live) setEntries([]);
      },
    );
    return () => {
      live = false;
    };
  }, [ctl, docId, tick]);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const show = async (e: HistoryEntry, i: number) => {
    setCursor(i);
    if (i === 0) {
      onSelect(null);
      return;
    }
    try {
      const preview = await ctl.preview(docId, e.frontiers);
      const schema = notesSchema();
      const current = PMNode.fromJSON(schema, await ctl.pageContent(docId));
      const old = PMNode.fromJSON(schema, preview.pm as object);
      onSelect({ entry: e, preview, changed: changedBlocks(blockTexts(old), blockTexts(current)) });
    } catch (err) {
      ctl.fail(err);
    }
  };
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-sm" aria-label={t("notes.history.title")} data-testid="history-panel">
      <div className="flex items-center justify-between border-b border-ui-border px-3 py-2">
        <h2 className="font-semibold">{t("notes.history.title")}</h2>
        <button type="button" aria-label={t("notes.close")} className={`rounded px-1 hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => ctl.showPanel(null)}>
          ✕
        </button>
      </div>
      {entries === null ? (
        <p className="p-3 text-ui-muted">{t("notes.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="p-3 text-ui-muted">{t("notes.history.none")}</p>
      ) : (
        <ul
          ref={list}
          role="listbox"
          aria-label={t("notes.history.versions")}
          tabIndex={0}
          aria-activedescendant={`hist-${cursor}`}
          className={`min-h-0 flex-1 overflow-auto py-1 ${FOCUS_RING}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, Math.min(entries.length - 1, c + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void show(entries[cursor]!, cursor);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onSelect(null);
            }
          }}
        >
          {entries.map((e, i) => {
            const isSel = i === 0 ? !selected : selected?.frontiers.join() === e.frontiers.join();
            return (
              <li
                key={e.frontiers.join() + i}
                id={`hist-${i}`}
                role="option"
                aria-selected={isSel}
                data-testid="history-entry"
                className={`mx-1 flex cursor-pointer flex-col rounded px-2 py-1.5 hover:bg-ui-hover ${isSel ? "bg-ui-active" : ""} ${i === cursor ? "ring-1 ring-ui-border" : ""}`}
                onClick={() => void show(e, i)}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: deviceColor(e.deviceId, e.peer) }} aria-hidden="true" />
                  <span className="font-medium">{e.end ? new Date(e.end).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : t("notes.history.unknownTime")}</span>
                </span>
                <span className="pl-4.5 text-xs text-ui-muted">
                  {i === 0 ? t("notes.history.current") : ""}
                  {i === 0 ? " · " : ""}
                  {ctl.nameOf(e.deviceId) ?? (e.deviceId ? t("notes.history.device", { device: e.deviceId.slice(0, 12) }) : t("notes.history.peer", { peer: e.peer.slice(-6) }))}
                  {" · "}
                  {t("notes.history.changes", { count: e.ops })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/** The read-only preview of a version (shown instead of the editor). */
export function VersionPreviewView({ ctl, version, onBack }: { ctl: NotesController; version: VersionView; onBack: () => void }) {
  const t = useT();
  const open = useDialog();
  const host = useRef<HTMLDivElement>(null);
  const docId = useNotes(ctl, (s) => s.opened?.docId ?? null);
  const locale = getLocale();
  useEffect(() => {
    let live = true;
    const json = version.preview.pm as object;
    void Promise.all(imageBlobs(json).map(async (b) => [b, await ctl.blobUrl(b)] as const)).then((pairs) => {
      if (!live || !host.current) return;
      const el = renderContent(json, { env: makeEditorEnv(ctl), urls: new Map(pairs), changed: version.changed });
      el.setAttribute("data-testid", "version-content");
      host.current.replaceChildren(el);
    });
    return () => {
      live = false;
    };
  }, [ctl, version]);
  const changed = version.changed.filter(Boolean).length;
  return (
    <div className="notes-page mx-auto max-w-3xl px-10 pb-24 pt-4" data-testid="version-preview">
      <div role="status" className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded border border-ui-border bg-ui-panel px-3 py-2 text-sm shadow">
        <span className="min-w-0 flex-1">
          <strong>{t("notes.history.previewOf", { when: new Date(version.entry.end).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</strong>
          <span className="ml-2 text-ui-muted">{changed ? t("notes.history.changedBlocks", { count: changed }) : t("notes.history.same")}</span>
        </span>
        <button
          type="button"
          data-testid="history-restore"
          className={`rounded bg-[var(--notes-accent)] px-3 py-1 text-white hover:brightness-110 ${FOCUS_RING}`}
          onClick={() =>
            open({
              kind: "confirm",
              title: t("notes.history.restore"),
              message: t("notes.history.restoreConfirm"),
              confirm: t("notes.history.restore"),
              onConfirm: () => {
                if (docId) void ctl.restoreVersion(docId, version.entry.frontiers).then(onBack);
              },
            })
          }
        >
          {t("notes.history.restore")}
        </button>
        <button type="button" className={`rounded border border-ui-border px-3 py-1 hover:bg-ui-hover ${FOCUS_RING}`} onClick={onBack} data-testid="history-back">
          {t("notes.history.back")}
        </button>
      </div>
      <h1 className="mb-4 border-b border-ui-border pb-1 text-3xl font-semibold">{version.preview.title || t("notes.untitled")}</h1>
      <div ref={host} aria-readonly="true" />
    </div>
  );
}
