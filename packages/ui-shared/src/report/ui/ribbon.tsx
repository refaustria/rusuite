// Entry points of "Report a problem": the "?" Help menu at the right end of the ribbon's tab strip (all apps; it
// costs the tab panels no width, so no ribbon group collapses because of it) and the File backstage item.

import { useId, useRef } from "react";
import { RibbonMenu, usePopup, type RibbonMenuItem } from "../../ribbon/controls";
import { triggerShortcut } from "../../ribbon/triggerShortcut";
import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import { reportAvailable, reportProblem, type ReportController } from "../controller";
import type { DocStats } from "../types";
import { ReportIcon } from "./hooks";
import { useCompact } from "../../compact/useCompact";
import { BottomSheet } from "../../compact/BottomSheet";

/**
 * The "?" Help menu (Report a problem…, Keyboard shortcuts) for the ribbon's `rightSlot`. `docStats` gives the
 * document's size (counts only) for the diagnostics; it is read when the dialog opens.
 */
export function HelpMenu({ docStats, controller = reportProblem }: { docStats?: () => DocStats | null | undefined; controller?: ReportController }) {
  const t = useT();
  controller.setDocStats(docStats ?? null);
  const { open, setOpen, root } = usePopup();
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = t("group.help");
  const compact = useCompact();
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  // Mobile shells: no "Report a problem" (no data leaves the device, `reportAvailable`).
  const items: RibbonMenuItem[] = [
    ...(reportAvailable() ? [{ id: "report", label: t("report.menu"), icon: <ReportIcon />, onSelect: () => controller.open() }] : []),
    { id: "shortcuts", label: t("shortcuts.title"), icon: "keyboard", shortcut: "Mod+/", onSelect: () => triggerShortcut("Mod+/") },
  ];
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={label}
        data-testid="help-menu"
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-ui-border text-xs font-semibold text-ui-muted hover:bg-ui-hover aria-expanded:bg-ui-hover ${FOCUS_RING}`}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && compact && (
        <BottomSheet id={id} label={label} role={null} onClose={close} testId="help-sheet">
          <RibbonMenu label={label} items={items} onDone={close} />
        </BottomSheet>
      )}
      {open && !compact && (
        <div id={id} className="absolute right-0 top-full z-50 mt-0.5 rounded border border-ui-border bg-ui-panel p-1 text-ui-fg shadow-lg">
          <RibbonMenu label={label} items={items} onDone={close} />
        </div>
      )}
    </div>
  );
}

/** File › Report a problem… (`pick` leaves the backstage first); absent in the mobile shells (`reportAvailable`). */
export function ReportBackstageItem({ pick, controller = reportProblem }: { pick: (fn: () => void) => void; controller?: ReportController }) {
  const t = useT();
  if (!reportAvailable()) return null;
  return (
    <li>
      <button
        type="button"
        title={t("report.tip")}
        className={`flex w-full items-center gap-3 px-5 py-2 text-left text-sm hover:bg-white/15 ${FOCUS_RING}`}
        onClick={() => pick(() => controller.open())}
      >
        <ReportIcon size={18} />
        {t("report.menu")}
      </button>
    </li>
  );
}
