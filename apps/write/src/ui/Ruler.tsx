// The horizontal ruler (Word's): the caret paragraph's text column white
// between the grey margins, cm ticks from the column's left edge, the
// paragraph's indents, and its tab stops. Click the ruler to add a stop of
// the kind shown in the corner selector (click the selector to cycle Left
// → Center → Right → Decimal → Bar); drag a stop to move it, drag it down
// off the ruler to remove it; double-click a stop for the Tabs… dialog.
// Pointer events throughout; stops have 32 px wide hit areas.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor } from "@tiptap/react";
import type { Indent } from "../generated/Indent";
import type { PageSetup } from "../generated/PageSetup";
import type { TabStop } from "../generated/TabStop";
import { pageGeometry } from "../features/pagination";
import {
  addTabCommand, moveTabCommand, nextTabKind, removeTabCommand, selectedParagraphs, snapTwips, tabsOf,
} from "../features/paragraphFormat";
import type { WriteFeatures } from "../features/WriteFeatures";
import { TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { useT } from "../i18n";
import { rulerSegments, textWidth } from "../features/columns";
import { currentSection } from "../features/structureCommands";
import { getLocale } from "@rusuite/ui-shared";
import { columnMarkers, dragIndent, formatLength, indentFrom, indentsOf, markerPositions, rulerTicks, setRulerPreview, snapTo, type IndentMarker, type Indents } from "../features/rulerDrag";
import { rulerUnitOf, type RulerUnit } from "../features/writeOptions";
import { colWidthsOf, dragBorder, setColWidths, tableContext } from "../features/tables";
import { setIndent } from "../features/formatting";

/** Height of the sticky ruler row (`h-7` band + `mb-1`), unzoomed. */
export const RULER_HEIGHT_PX = 32;
/** The scroll container's top padding (`p-6`): the sticky ruler sticks below it. */
export const SCROLL_PADDING_PX = 24;

/**
 * Space the scroll container keeps free at its top for the sticky ruler
 * (below the container's padding; it sits inside the zoomed page area, so
 * it scales with the zoom), plus a
 * small gap: used as `scroll-padding-top` and as ProseMirror's top scroll
 * margin, so neither a focus scroll nor `scrollIntoView` puts text under it.
 */
export function rulerReserve(ruler: boolean, zoom = 1): number {
  return ruler ? SCROLL_PADDING_PX + Math.ceil(RULER_HEIGHT_PX * zoom) + 8 : 0;
}

/** Pointer distance below the ruler that removes a dragged stop. */
const OFF_RULER_PX = 18;

/** Glyph of a tab stop kind (ruler and corner selector). */
export function TabGlyph({ kind, size = 12 }: { kind: TabStop["kind"]; size?: number }) {
  const d: Record<string, string> = {
    left: "M3 2v8h7",
    center: "M7 2v8M2 10h10",
    right: "M11 2v8H4",
    decimal: "M6 2v8M1 10h10M9.5 6.5h.01",
    bar: "M7 1v11",
    clear: "",
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={d[kind] ?? ""} />
    </svg>
  );
}

interface RulerInfo {
  /** Text column of the caret paragraph (px from the page's left edge) and its width. */
  left: number;
  width: number;
  indent: Indent;
  tabs: TabStop[];
  ids: number[];
  /** The columns of a multi-column section: [start, end] px from the text's left edge (none otherwise). */
  segments: [number, number][];
  /** The caret's table (column markers), if any. */
  table: { table: number; left: number; widths: number[] } | null;
}

/** The caret paragraph's column, measured in the DOM (cells have their own), else the page margins. */
function measureColumn(editor: Editor, page: PageSetup | null): { left: number; width: number } {
  const g = pageGeometry(page);
  const fallback = { left: g.left, width: g.width - g.left - g.right };
  try {
    const { $from } = editor.state.selection;
    const dom = editor.view.nodeDOM($from.before($from.depth)) as HTMLElement | null;
    const pageEl = editor.view.dom.closest(".write-page") as HTMLElement | null;
    if (!dom?.getBoundingClientRect || !pageEl) return fallback;
    const zoom = pageEl.offsetWidth ? pageEl.getBoundingClientRect().width / pageEl.offsetWidth || 1 : 1;
    const r = dom.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();
    if (!r.width) return fallback;
    const cs = getComputedStyle(dom);
    const left = (r.left - pr.left) / zoom - (parseFloat(cs.marginLeft) || 0);
    const width = r.width / zoom + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
    return { left, width };
  } catch {
    return fallback;
  }
}

/** Ticks and numbers (cm or inches) over `width` px, starting at 0 at the left edge. */
export function RulerScale({ width, unit = "cm" }: { width: number; unit?: RulerUnit }) {
  const ticks = rulerTicks(width, unit);
  return (
    <>
      {ticks.map((k, i) => (
        <span key={i} className="absolute bottom-0 border-l border-gray-400" style={{ left: k.x, height: k.kind === "major" ? 0 : k.kind === "half" ? 6 : 3 }} />
      ))}
      {ticks
        .filter((k) => k.label != null)
        .map((k) => (
          <span key={`n${k.label}`} className="absolute top-0.5 -translate-x-1/2 text-[9px] leading-3 text-gray-500" style={{ left: k.x }} data-testid="ruler-number">
            {k.label}
          </span>
        ))}
    </>
  );
}

/** The caret's table: its left edge (px from the page's left edge) and grid widths (twips). */
function measureTable(editor: Editor, contentWidth: number): { table: number; left: number; widths: number[] } | null {
  try {
    const t = tableContext(editor.state);
    if (!t) return null;
    const dom = editor.view.nodeDOM(t.pos) as HTMLElement | null;
    const table = dom?.tagName === "TABLE" ? dom : (dom?.querySelector?.("table") ?? null);
    const pageEl = editor.view.dom.closest(".write-page") as HTMLElement | null;
    if (!table || !pageEl) return null;
    const zoom = pageEl.offsetWidth ? pageEl.getBoundingClientRect().width / pageEl.offsetWidth || 1 : 1;
    const left = (table.getBoundingClientRect().left - pageEl.getBoundingClientRect().left) / zoom;
    return { table: t.table, left, widths: colWidthsOf(t, contentWidth) };
  } catch {
    return null;
  }
}

export function Ruler({ editor, ctl, features, page }: { editor: Editor; ctl: SyncController; features: WriteFeatures; page: PageSetup | null }) {
  const t = useT();
  const [kind, setKind] = useState<TabStop["kind"]>("left");
  const [drag, setDrag] = useState<{ from: number; x: number; off: boolean } | null>(null);
  const [indentDrag, setIndentDrag] = useState<{ marker: IndentMarker; value: Indents } | null>(null);
  const [colDrag, setColDrag] = useState<{ col: number; widths: number[] } | null>(null);
  const unit = rulerUnitOf(features.ui.getState().options, getLocale() || (typeof navigator !== "undefined" ? navigator.language : "en"));
  const band = useRef<HTMLDivElement>(null);
  const g = pageGeometry(page);
  const info = useThrottledEditorState<RulerInfo>({
    editor,
    selector: ({ editor: e }) => {
      const nodes = selectedParagraphs(e.state);
      const first = nodes[0];
      const col = measureColumn(e, page);
      const { $from } = e.state.selection;
      let inColumns = false;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "tableCell") break;
        if ($from.node(d).type.name === "columns") inColumns = true;
      }
      const sec = inColumns ? currentSection(e.state, ctl.sections) : null;
      return {
        ...col,
        segments: sec && (sec.columns?.count ?? 1) > 1 ? rulerSegments(sec.columns, textWidth(sec.page), TWIPS_PER_PX) : [],
        indent: ((first?.attrs.indent as Indent | null) ?? {}) as Indent,
        tabs: first ? tabsOf(ctl.styles, first) : [],
        ids: nodes.map((n) => n.attrs.id as number),
        table: measureTable(e, (ctl.page ? ctl.page.width - ctl.page.margins.left - ctl.page.margins.right : 9026)),
      };
    },
  });
  // Re-measure after layout changes the column (zoom, view, page setup).
  const [, force] = useState(0);
  useEffect(() => {
    const off = features.ui.subscribe(() => force((n) => n + 1));
    return off;
  }, [features]);

  const run = (cmd: ReturnType<typeof addTabCommand>) => {
    if (cmd) void ctl.run(cmd).then(() => editor.commands.focus());
  };
  const nodes = () => selectedParagraphs(editor.state);
  /** Pointer x (client) → twips from the column's left edge. */
  const twipsAt = (clientX: number) => {
    const el = band.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const zoom = el.offsetWidth ? r.width / el.offsetWidth || 1 : 1;
    return snapTwips(((clientX - r.left) / zoom - info.left) * TWIPS_PER_PX);
  };

  const onBandDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-tab-stop]")) return;
    e.preventDefault();
    const pos = twipsAt(e.clientX);
    if (pos <= 0 || pos / TWIPS_PER_PX > info.width + 1) return;
    run(addTabCommand(nodes(), { pos, kind }));
  };

  const onStopDown = (e: ReactPointerEvent, stop: TabStop) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const bandRect = band.current?.getBoundingClientRect();
    setDrag({ from: stop.pos, x: stop.pos, off: false });
    const move = (ev: PointerEvent) => {
      const off = !!bandRect && ev.clientY > bandRect.bottom + OFF_RULER_PX;
      setDrag({ from: stop.pos, x: twipsAt(ev.clientX), off });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const off = !!bandRect && ev.clientY > bandRect.bottom + OFF_RULER_PX;
      if (off) run(removeTabCommand(nodes(), stop.pos));
      else {
        const to = twipsAt(ev.clientX);
        if (Math.abs(to - stop.pos) >= 20) run(moveTabCommand(nodes(), stop.pos, { ...stop, pos: to }));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ind = info.indent;
  /** Pointer x (client) → twips from the column's left edge, unsnapped. */
  const rawTwips = (clientX: number, left: number) => {
    const el = band.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const zoom = el.offsetWidth ? r.width / el.offsetWidth || 1 : 1;
    return ((clientX - r.left) / zoom - left) * TWIPS_PER_PX;
  };

  const onIndentDown = (e: ReactPointerEvent, marker: IndentMarker) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const start = indentsOf(ind);
    const ids = info.ids;
    const width = info.width * TWIPS_PER_PX;
    // Alt: no snapping (Word).
    const at = (ev: PointerEvent | ReactPointerEvent) => {
      const x = rawTwips(ev.clientX, info.left);
      return ev.altKey ? Math.round(x) : snapTo(unit, x);
    };
    let value = start;
    setIndentDrag({ marker, value });
    const move = (ev: PointerEvent) => {
      value = dragIndent(start, marker, at(ev), width);
      setIndentDrag({ marker, value });
      setRulerPreview(editor.view, { ids, indent: value });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setIndentDrag(null);
      setRulerPreview(editor.view, null);
      if (JSON.stringify(value) !== JSON.stringify(start)) {
        setIndent(editor, indentFrom(value));
        editor.commands.focus();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onColumnDown = (e: ReactPointerEvent, col: number) => {
    const tbl = info.table;
    if (e.button !== 0 || !tbl) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const x0 = rawTwips(e.clientX, tbl.left);
    let widths = tbl.widths;
    setColDrag({ col, widths });
    const move = (ev: PointerEvent) => {
      const dx = rawTwips(ev.clientX, tbl.left) - x0;
      widths = dragBorder(tbl.widths, col, ev.altKey ? dx : snapTo(unit, dx));
      setColDrag({ col, widths });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setColDrag(null);
      const tc = tableContext(editor.state);
      if (tc && tc.table === tbl.table && JSON.stringify(widths) !== JSON.stringify(tbl.widths)) void ctl.run(setColWidths(tc, widths)).then(() => editor.commands.focus());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="write-ruler-row sticky top-0 z-[1] mx-auto mb-1 flex" style={{ width: g.width, maxWidth: "100%" }} data-testid="ruler">
      <div
        ref={band}
        className="write-ruler relative h-7 flex-1 select-none overflow-hidden border-b border-ui-border bg-ui-panel"
        role="group"
        aria-label={t("write.ruler")}
        onPointerDown={onBandDown}
      >
        <button
          type="button"
          className="absolute left-0.5 top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded border border-ui-border bg-ui-bg text-ui-fg hover:bg-ui-hover"
          aria-label={t("write.tabKindSelector", { kind: t(`write.tabKind.${kind}`) })}
          title={t("write.tabKindSelector", { kind: t(`write.tabKind.${kind}`) })}
          data-testid="tab-kind"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setKind(nextTabKind(kind))}
        >
          <TabGlyph kind={kind} />
        </button>
        {/* Multi-column sections: every column has its own scale from 0 at its left edge (Word); the gaps are grey. */}
        {info.segments.map(([start, end], i) => (
          <div key={`col${i}`} className="absolute inset-y-1 bg-white" style={{ left: g.left + start, width: end - start }} data-testid="ruler-segment">
            <RulerScale width={end - start} unit={unit} />
          </div>
        ))}
        {info.segments.slice(1).map(([start], i) => (
          <div
            key={`gap${i}`}
            className="absolute inset-y-1 z-[1] border-x border-gray-400 bg-ui-panel"
            style={{ left: g.left + info.segments[i]![1], width: start - info.segments[i]![1] }}
            data-testid="ruler-column-gap"
          />
        ))}
        {info.segments.length === 0 && (
          <div className="absolute inset-y-1 bg-white" style={{ left: info.left, width: info.width }} data-testid="ruler-column">
            <RulerScale width={info.width} unit={unit} />
          </div>
        )}
        {/* Indents: first line on top, hanging and the left-indent box at the bottom, the right indent (drag them, Word). */}
        {(() => {
          const shown = indentDrag?.value ?? indentsOf(ind);
          const pos = markerPositions(shown, info.width * TWIPS_PER_PX);
          const marker = (m: IndentMarker, cls: string, extra: string) => (
            <span
              key={m}
              role="slider"
              tabIndex={-1}
              aria-label={t(`write.w5.indent.${m}`)}
              aria-valuenow={Math.round(pos[m])}
              title={`${t(`write.w5.indent.${m}`)}: ${formatLength(m === "right" ? shown.right : pos[m], unit)}`}
              data-indent-marker={m}
              className={`absolute z-[2] -translate-x-1/2 cursor-ew-resize ${cls}`}
              style={{ left: info.left + pos[m] / TWIPS_PER_PX, touchAction: "none" }}
              onPointerDown={(e) => onIndentDown(e, m)}
            >
              <span className={`block h-0 w-0 ${extra}`} />
            </span>
          );
          return [
            marker("firstLine", "top-0 px-1", "border-x-[5px] border-t-[6px] border-x-transparent border-t-gray-500"),
            marker("hanging", "bottom-[5px] px-1", "border-x-[5px] border-b-[6px] border-x-transparent border-b-gray-500"),
            marker("left", "bottom-0 px-1", "h-[5px] w-[10px] border border-gray-500 bg-ui-panel"),
            marker("right", "bottom-0 px-1", "border-x-[5px] border-b-[6px] border-x-transparent border-b-gray-500"),
          ];
        })()}
        {/* Table column markers: drag one to change the column widths (Word's Move Table Column). */}
        {info.table &&
          columnMarkers(colDrag?.widths ?? info.table.widths).map((x, i) => (
            <span
              key={`tc${i}`}
              role="slider"
              tabIndex={-1}
              aria-label={t("write.w5.moveTableColumn", { n: i + 1 })}
              aria-valuenow={Math.round(x)}
              data-table-marker={i}
              className="absolute top-1 z-[2] h-5 w-2 -translate-x-1/2 cursor-ew-resize border-x border-gray-500 bg-[repeating-linear-gradient(0deg,#9ca3af_0_1px,transparent_1px_3px)]"
              style={{ left: info.table!.left + x / TWIPS_PER_PX, touchAction: "none" }}
              onPointerDown={(e) => onColumnDown(e, i)}
            />
          ))}
        {info.tabs.map((s) => {
          const dragging = drag?.from === s.pos;
          const x = info.left + (dragging ? drag.x : s.pos) / TWIPS_PER_PX;
          return (
            <span
              key={s.pos}
              role="button"
              tabIndex={-1}
              data-tab-stop={s.kind}
              data-pos={s.pos}
              aria-label={t("write.tabStopAt", { kind: t(`write.tabKind.${s.kind}`), pos: (s.pos / (1440 / 2.54)).toFixed(2) })}
              title={`${t(`write.tabKind.${s.kind}`)}: ${formatLength(s.pos, unit)}`}
              className={`absolute bottom-0 flex h-7 w-8 -translate-x-1/2 cursor-ew-resize items-end justify-center pb-0.5 text-ui-fg ${dragging && drag.off ? "opacity-30" : ""}`}
              style={{ left: x, touchAction: "none" }}
              onPointerDown={(e) => onStopDown(e, s)}
              onDoubleClick={() => features.ui.openDialog("tabs")}
            >
              <TabGlyph kind={s.kind} size={10} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
