// The compact layout's top bar (P10-M2, 44 px): File (the backstage), the document title, Undo, Redo, the app's
// right-slot items (Help, Show's Present) and an overflow "⋯" sheet with Options, Keyboard shortcuts, Report a
// problem and the language.

import { useRef, useState, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { LanguageSelect, useT } from "../i18n/react";
import { RibbonIcon, type RibbonIconName } from "../ribbon/icons";
import { triggerShortcut } from "../ribbon/triggerShortcut";
import { reportProblem } from "../report/controller";
import { ReportIcon } from "../report/ui/hooks";
import { BottomSheet } from "./BottomSheet";

/** Undo / Redo of the top bar (the app's own commands and states). */
export interface CompactUndo {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export interface TopBarProps {
  documentTitle?: string;
  accent: string;
  /** Opens the backstage; without it there is no File button. */
  onFile?: () => void;
  fileExpanded?: boolean;
  undo?: CompactUndo;
  rightSlot?: ReactNode;
  /** Options… (the backstage's), if the app has options. */
  onOptions?: () => void;
  /** Tap on the title: rename the document (apps that support it). */
  onRename?: () => void;
}

const ICON_BTN = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-ui-fg hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`;

export function TopBar({ documentTitle, accent, onFile, fileExpanded, undo, rightSlot, onOptions, onRename }: TopBarProps) {
  const t = useT();
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const closeMore = () => {
    setMore(false);
    moreBtn.current?.focus();
  };
  /** Runs an overflow command after the sheet closed (a dialog it opens then gets the focus). */
  const pick = (fn: () => void) => () => {
    setMore(false);
    fn();
  };
  const item = (id: string, label: string, ic: RibbonIconName | ReactNode, fn: () => void) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      data-testid={`compact-more-${id}`}
      className={`flex min-h-11 w-full items-center gap-3 rounded px-2 text-left text-sm hover:bg-ui-hover ${FOCUS_RING}`}
      onClick={pick(fn)}
    >
      <span className="flex w-5 shrink-0 justify-center">{typeof ic === "string" ? <RibbonIcon name={ic as RibbonIconName} size={18} /> : ic}</span>
      {label}
    </button>
  );
  const title = documentTitle ?? t("doc.untitled");
  return (
    <header
      data-testid="compact-topbar"
      className="rs-touch flex h-11 shrink-0 items-center gap-0.5 border-b border-ui-border bg-ui-panel pr-1 text-ui-fg"
    >
      {onFile && (
        <button
          type="button"
          aria-label={t("ribbon.file")}
          aria-haspopup="dialog"
          aria-expanded={!!fileExpanded}
          data-testid="compact-file"
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center text-white hover:brightness-110 ${FOCUS_RING}`}
          style={{ background: accent }}
          onClick={onFile}
        >
          <RibbonIcon name="menu" size={22} />
        </button>
      )}
      {onRename ? (
        <button type="button" data-testid="compact-title" className={`min-w-0 flex-1 truncate px-2 text-left text-sm font-medium ${FOCUS_RING}`} onClick={onRename}>
          {title}
        </button>
      ) : (
        <span data-testid="compact-title" className="min-w-0 flex-1 truncate px-2 text-sm font-medium">
          {title}
        </span>
      )}
      {undo && (
        <>
          <button type="button" aria-label={t("group.undo")} data-testid="compact-undo" className={ICON_BTN} disabled={!undo.canUndo} onClick={undo.onUndo}>
            <RibbonIcon name="undo" size={20} />
          </button>
          <button type="button" aria-label={t("cmd.redo")} data-testid="compact-redo" className={ICON_BTN} disabled={!undo.canRedo} onClick={undo.onRedo}>
            <RibbonIcon name="redo" size={20} />
          </button>
        </>
      )}
      {rightSlot && <div className="flex shrink-0 items-center gap-0.5">{rightSlot}</div>}
      <button
        ref={moreBtn}
        type="button"
        aria-label={t("compact.more")}
        aria-haspopup="dialog"
        aria-expanded={more}
        data-testid="compact-more"
        className={ICON_BTN}
        onClick={() => setMore((m) => !m)}
      >
        <RibbonIcon name="more" size={20} />
      </button>
      {more && (
        <BottomSheet label={t("compact.moreSheet")} onClose={closeMore} testId="compact-more-sheet">
          <div role="menu" aria-label={t("compact.moreSheet")} className="flex flex-col">
            {onOptions && item("options", t("backstage.options"), "options", onOptions)}
            {item("shortcuts", t("shortcuts.title"), "keyboard", () => triggerShortcut("Mod+/"))}
            {item("report", t("report.menu"), <ReportIcon size={18} />, () => reportProblem.open())}
          </div>
          <LanguageSelect className="mt-2 border-t border-ui-border px-2 pt-3 [&_select]:min-h-11" />
        </BottomSheet>
      )}
    </header>
  );
}
