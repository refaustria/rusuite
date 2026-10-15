// The File tab's backstage view: a full-pane overlay with the file
// commands on the left and the recent files on the right. Esc (or Back)
// returns to the document.

import { useEffect, useRef, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import type { AnySession } from "../recent/session";
import { formatTime, useSession } from "../recent/useSession";
import { formatCombo } from "../shortcuts/keys";
import { RibbonIcon, type RibbonIconName } from "./icons";

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface BackstageActions {
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onExportPdf?: () => void;
  /** "Close": close the document (apps start a blank one, asking before discarding changes). */
  onCloseDocument?: () => void;
  /** Recent files (and their re-opening) come from the session. */
  session?: AnySession;
  /** When set, Open/Save/Save As/recent files are disabled and this is shown as the reason. */
  fileDisabledReason?: string;
  /** Export PDF disabled (e.g. no slides). */
  exportDisabled?: boolean;
  /** Extra content under the recent list (e.g. document info). */
  info?: ReactNode;
}

export interface BackstageProps extends BackstageActions {
  open: boolean;
  onClose: () => void;
  appName: string;
  documentTitle?: string;
  /** Accent color of the navigation pane (CSS color). */
  accent?: string;
}

function RecentFiles({ session, disabled, pick }: { session: AnySession; disabled: boolean; pick: (fn: () => void) => void }) {
  const recent = useSession(session, (st) => st.recent);
  useEffect(() => {
    void session.refresh();
  }, [session]);
  const browser = session.storage?.kind === "browser";
  return (
    <section aria-label="Recent" className="flex min-h-0 flex-col">
      <h2 className="mb-2 text-lg font-semibold">Recent</h2>
      {recent.length === 0 && (
        <p className="text-sm text-ui-muted" data-testid="recent-empty">
          No recent files
        </p>
      )}
      <ul className="flex min-h-0 flex-col overflow-auto">
        {recent.map((r) => (
          <li key={r.path ?? r.blobId ?? r.name}>
            <button
              type="button"
              disabled={disabled}
              className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`}
              title={r.path ?? `${r.name} (copy stored in this browser)`}
              data-testid="recent-entry"
              onClick={() => pick(() => void session.openRecent(r))}
            >
              <RibbonIcon name="recent" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.name}</span>
                {r.path && <span className="truncate text-xs text-ui-muted">{r.path}</span>}
              </span>
              <span className="ml-auto shrink-0 text-xs text-ui-muted">{formatTime(r.openedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {browser && (
        <p role="note" className="mt-2 max-w-xl text-xs text-ui-muted" data-testid="recent-web-note">
          In the browser, recent files re-open the copy stored in this browser when the file was last opened or saved – not the file on
          disk.
        </p>
      )}
    </section>
  );
}

/** Full-pane File view (Office "backstage"). */
export function Backstage({
  open, onClose, appName, documentTitle, accent = "var(--ui-focus)", onNew, onOpen, onSave, onSaveAs, onExportPdf, onCloseDocument,
  session, fileDisabledReason, exportDisabled, info,
}: BackstageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (previous && previous.isConnected && previous.closest('[role="tab"]') === null) previous.focus?.();
    };
  }, [open]);

  if (!open) return null;

  /** Runs a command after leaving the backstage (dialogs it opens then get the focus). */
  const pick = (fn: () => void) => {
    onCloseRef.current();
    fn();
  };
  const fileOff = fileDisabledReason !== undefined;
  const item = (id: string, label: string, ic: RibbonIconName, fn: (() => void) | undefined, shortcut?: string, disabled = false) =>
    fn && (
      <li key={id}>
        <button
          type="button"
          disabled={disabled}
          title={disabled && fileOff ? fileDisabledReason : shortcut ? `${label} (${formatCombo(shortcut)})` : label}
          className={`flex w-full items-center gap-3 px-5 py-2 text-left text-sm hover:bg-white/15 disabled:opacity-50 ${FOCUS_RING}`}
          onClick={() => pick(fn)}
        >
          <RibbonIcon name={ic} size={18} />
          {label}
        </button>
      </li>
    );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="File"
      data-testid="backstage"
      className="fixed inset-0 z-40 flex bg-ui-bg text-ui-fg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCloseRef.current();
          return;
        }
        if (e.key !== "Tab") return;
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <nav aria-label="File commands" className="flex w-52 shrink-0 flex-col py-3 text-white" style={{ background: accent }}>
        <button
          type="button"
          aria-label="Back to the document"
          title="Back (Esc)"
          className={`mx-3 mb-3 flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 ${FOCUS_RING}`}
          onClick={() => onCloseRef.current()}
        >
          <RibbonIcon name="back" size={24} />
        </button>
        <ul className="flex flex-col">
          {item("new", "New", "new", onNew, "Mod+N")}
          {item("open", "Open…", "open", onOpen, "Mod+O", fileOff)}
          {item("save", "Save", "save", onSave, "Mod+S", fileOff)}
          {item("saveAs", "Save As…", "saveAs", onSaveAs, "Mod+Shift+S", fileOff)}
          {item("export", "Export PDF…", "pdf", onExportPdf, "Mod+P", !!exportDisabled)}
        </ul>
        <ul className="mt-auto flex flex-col border-t border-white/20 pt-2">{item("close", "Close", "close", onCloseDocument)}</ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-8">
        <header>
          <p className="text-sm text-ui-muted">{appName}</p>
          <h1 className="truncate text-2xl font-semibold">{documentTitle ?? "Untitled"}</h1>
          {fileOff && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400" data-testid="file-disabled">
              {fileDisabledReason}
            </p>
          )}
        </header>
        {session && <RecentFiles session={session} disabled={fileOff} pick={pick} />}
        {info}
      </div>
    </div>
  );
}
