// Active cell address + editable input. The bar and the in-cell editor are
// two views of the same edit session (typing in either updates both,
// pointing works from either); the fx button opens the function list.

import { useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { isFormula } from "./formula/tokenize";
import { cellAddress, sheetPrefix } from "./grid/address";
import { FORMULA_BAR_ATTR } from "./grid/CellEditor";
import { EditPopups, FormulaOverlay, handleEditorKey, syncCaret, useEditorBinding } from "./grid/editorKit";
import { normalize } from "./grid/Selection";
import { isSingleCell } from "./grid/merges";
import { useCalc, type CalcStore } from "./state/store";
import { useT } from "./i18n";
import { NameBox } from "./names/NameBox";
import { formulaHidden } from "./protection/protection";
import { applySeriesFormula, seriesFormula } from "./charts/extras";
import { useCompact } from "@rusuite/ui-shared";

/** While a chart series is selected the bar shows its `=SERIES(…)` formula (Excel); Enter applies an edit. */
function SeriesFormulaField({ store, series }: { store: CalcStore; series: number }) {
  const t = useT();
  const obj = store.charts.selectedChart();
  const text = obj ? seriesFormula(obj.chart, series) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [base, setBase] = useState(text);
  if (base !== text) {
    setBase(text);
    setDraft(null);
  }
  const commit = () => {
    if (draft === null || !obj) return;
    const next = applySeriesFormula(obj.chart, series, draft);
    setDraft(null);
    if (!next) {
      store.pushError(new Error(t("calc.chart.badSeriesFormula")));
      return;
    }
    void store.charts.setSeries(next.series, next.categories);
  };
  return (
    <input
      aria-label={t("calc.chart.seriesFormula")}
      data-testid="series-formula"
      spellCheck={false}
      className="block h-[26px] w-full rounded border border-ui-border bg-ui-bg px-2 py-0.5 font-mono leading-5 outline-none focus:border-ui-focus"
      value={draft ?? text}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          store.focusGrid();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
          store.focusGrid();
        }
      }}
    />
  );
}

export function FormulaBar({ store }: { store: CalcStore }) {
  const t = useT();
  const input = useRef<HTMLTextAreaElement>(null);
  const edit = useCalc(store, (s) => s.edit);
  const selection = useCalc(store, (s) => s.selection);
  useCalc(store, (s) => s.version);
  const sheets = useCalc(store, (s) => s.info?.sheets);
  const activeSheet = useCalc(store, (s) => s.activeSheet);
  const [scrollX, setScrollX] = useState(0);
  // Compact layout (P10-M3): one line, the name box as a chip, an expand button for long formulas.
  const compact = useCompact();
  const [expandedState, setExpanded] = useState(false);
  const expanded = compact && expandedState;
  useEditorBinding(store, "bar", input);

  const origin = edit?.origin;
  useLayoutEffect(() => {
    const el = input.current;
    if (origin === "bar" && el && el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  }, [origin]);

  const { row, col } = selection.anchor;
  const index = sheets?.findIndex((s) => s.id === activeSheet) ?? 0;
  const prefix = index > 0 && sheets ? sheetPrefix(sheets[index].name) : "";
  const r = normalize(selection);
  // A merged cell is addressed by its top-left cell, as in Excel's name box.
  const single = isSingleCell(r, store.merges());
  // R1C1 reference style (P9-C4): `R2C3`.
  const at = (rr: number, cc: number) => (store.calcTools.r1c1() ? `R${rr + 1}C${cc + 1}` : cellAddress(rr, cc));
  const address = single ? `${prefix}${at(row, col)}` : `${prefix}${at(r.r0, r.c0)}:${at(r.r1, r.c1)}`;
  // A spilled cell shows its array formula greyed and read-only (Excel); typing into the cell still replaces it.
  const ghost = edit ? null : store.ghostFormula();
  useCalc(store, (s) => s.info?.sheets);
  useCalc(store, (s) => s.info?.calc?.options.r1c1);
  // A hidden formula on a protected sheet shows nothing (Format Cells › Protection › Hidden).
  const hidden = !edit && formulaHidden(store);
  const anchor = store.activeAnchor();
  const value = edit ? edit.text : hidden ? "" : store.calcTools.displayInput(ghost?.input ?? store.activeCell()?.input ?? "", anchor.row, anchor.col);
  const refs = edit && isFormula(edit.text) ? store.editRefs() : [];
  // The coloured overlay follows one scrolled line; the expanded (wrapping) field is plain.
  const colored = refs.length > 0 && !expanded;
  // The in-cell editor is hidden while pointing on another sheet: the bar then shows the popups.
  const popups = !!edit && (origin === "bar" || edit.sheet !== activeSheet);

  const onFocus = () => {
    if (ghost) return;
    if (store.getState().edit) store.setEditOrigin("bar");
    else store.beginEdit(null, "bar");
  };

  const onBlur = (e: FocusEvent<HTMLTextAreaElement>) => {
    // Leaving the bar keeps the edit open; only the in-cell editor takes it over.
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.getAttribute("data-testid") === "cell-editor") store.setEditOrigin("cell");
  };

  const track = () => setScrollX(input.current?.scrollLeft ?? 0);
  const chartEl = !edit && store.charts.selected?.sheet === activeSheet ? store.charts.selected.element : null;
  const seriesSel = chartEl && (chartEl.type === "series" || chartEl.type === "dataLabels" || chartEl.type === "trendline" || chartEl.type === "errorBars") ? chartEl.series : null;

  return (
    <div
      className={`flex gap-2 border-b border-ui-border bg-ui-bg px-2 py-1 text-sm text-ui-fg ${compact ? "rs-touch items-start" : "items-center"}`}
      data-testid="formula-bar"
      data-expanded={expanded ? "" : undefined}
    >
      <NameBox store={store} address={address} compact={compact} />
      {!compact && <button
        type="button"
        aria-label={t("calc.insertFunction")}
        title={t("calc.insertFunction")}
        className="select-none rounded px-1 italic text-ui-muted hover:bg-ui-hover"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // Excel's fx: the Insert Function dialog.
          store.openDialog({ kind: "insertFunction" });
        }}
      >
        fx
      </button>}
      <div className="relative min-w-0 flex-1">
        {seriesSel !== null && <SeriesFormulaField store={store} series={seriesSel} />}
        <div className={seriesSel !== null ? "hidden" : "contents"}>
        {colored && (
          <div className={`pointer-events-none absolute inset-0 overflow-hidden rounded border border-transparent px-2 py-0.5 font-mono ${compact ? "leading-[40px]" : ""}`}>
            <FormulaOverlay text={value} refs={refs} className="whitespace-pre" style={{ transform: `translateX(${-scrollX}px)` }} />
          </div>
        )}
        {/* A one-line textarea (not an <input>, which drops line breaks): Alt+Enter line breaks survive editing here. */}
        <textarea
          ref={input}
          rows={expanded ? 4 : 1}
          wrap={expanded ? "soft" : "off"}
          {...{ [FORMULA_BAR_ATTR]: "" }}
          aria-label={t("calc.formulaBar")}
          spellCheck={false}
          autoComplete="off"
          className={`relative block w-full resize-none rounded border ${
            expanded ? "h-[104px] overflow-auto whitespace-pre-wrap break-all" : compact ? "h-11 overflow-hidden whitespace-pre leading-[40px]" : "h-[26px] overflow-hidden whitespace-pre"
          } border-ui-border px-2 py-0.5 font-mono ${compact ? "" : "leading-5"} outline-none focus:border-ui-focus ${
            colored ? "bg-transparent text-transparent" : ghost ? "bg-ui-bg text-ui-muted" : "bg-ui-bg"
          }`}
          readOnly={!!ghost || hidden}
          data-formula-hidden={hidden ? "" : undefined}
          aria-readonly={ghost ? true : undefined}
          title={ghost ? t("calc.spill.ghost", { cell: cellAddress(ghost.anchor.row, ghost.anchor.col) }) : undefined}
          data-spilled={ghost ? "" : undefined}
          style={colored ? { caretColor: "var(--ui-fg)" } : undefined}
          value={value}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            if (!store.getState().edit) store.beginEdit(null, "bar");
            store.setEditText(e.target.value, e.target.selectionEnd ?? e.target.value.length);
            track();
          }}
          onKeyDown={(e) => handleEditorKey(store, e)}
          onSelect={(e) => {
            syncCaret(store)(e);
            track();
          }}
          onKeyUp={syncCaret(store)}
          onMouseUp={syncCaret(store)}
          onScroll={track}
        />
        {popups && <EditPopups store={store} />}
        </div>
      </div>
      {compact && (
        <button
          type="button"
          data-testid="formula-bar-expand"
          aria-label={expanded ? t("calc.formulaBar.collapse") : t("calc.formulaBar.expand")}
          aria-expanded={expanded}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-ui-muted hover:bg-ui-hover"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setExpanded((x) => !x)}
        >
          <span aria-hidden="true" className={`inline-block transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
        </button>
      )}
    </div>
  );
}
