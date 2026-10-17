// The error indicator of a flagged active cell (P9-C4): Excel's smart tag
// left of the cell – a warning button whose menu names the rule and
// offers its fix, Help, Ignore Error, Edit in Formula Bar and Error
// Checking Options. The grid paints the green triangles itself.

import { useLayoutEffect, useState, type RefObject } from "react";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { fixFor } from "./AuditDialogs";

export function ErrorTag({ store, boxRef, onMount }: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const anchor = useCalc(store, (s) => s.selection.anchor);
  const editing = useCalc(store, (s) => s.edit !== null);
  const [open, setOpen] = useState(false);
  // A #SPILL! cell has the spill indicator in this place (grid/SpillIndicator).
  const spillError = store.activeCell()?.display === "#SPILL!";
  const issue = editing || spillError ? null : store.audit.activeIssue();
  useLayoutEffect(() => {
    if (issue) onMount();
  }, [issue, onMount, anchor]);
  useLayoutEffect(() => setOpen(false), [anchor.row, anchor.col]);
  if (!issue) return null;
  const info = store.audit.describe(issue);
  const fix = fixFor(store, issue);
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
    store.focusGrid();
  };
  const item = "block w-full rounded px-2 py-1 text-left text-sm hover:bg-ui-hover";
  return (
    <div ref={boxRef} className="pointer-events-none absolute z-10" style={{ left: -9999, top: -9999 }} data-testid="error-tag">
      <button
        type="button"
        aria-label={t("calc.err.tag", { title: info.title })}
        title={info.title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="error-tag-button"
        className="pointer-events-auto absolute top-0 flex h-5 w-5 items-center justify-center rounded border border-[#c9a400] bg-[#fff4c2] text-[11px] text-[#7a5d00] hover:bg-[#ffe98a]"
        style={{ right: "calc(100% + 2px)" }}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        !
      </button>
      {open && (
        <div
          role="menu"
          aria-label={info.title}
          data-testid="error-menu"
          className="pointer-events-auto absolute top-6 w-64 rounded border border-ui-border bg-ui-panel p-1 text-ui-fg shadow-lg"
          style={{ right: "calc(100% - 18px)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              store.focusGrid();
            }
          }}
        >
          <p className="px-2 py-1 text-xs font-semibold">{info.title}</p>
          {fix && (
            <button type="button" role="menuitem" className={item} onClick={run(fix.run)}>
              {t(fix.label)}
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={run(() => store.audit.ignore(issue))}>
            {t("calc.err.ignore")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              store.beginEdit(null, "bar");
              store.focusEditor();
            }}
          >
            {t("calc.err.editInBar")}
          </button>
          <div role="separator" className="my-1 border-t border-ui-border" />
          <button type="button" role="menuitem" className={item} onClick={run(() => store.openDialog({ kind: "formulaOptions" }))}>
            {t("calc.err.optionsMenu")}
          </button>
        </div>
      )}
    </div>
  );
}
