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

const PX_PER_CM = 96 / 2.54;
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

export function Ruler({ editor, ctl, features, page }: { editor: Editor; ctl: SyncController; features: WriteFeatures; page: PageSetup | null }) {
  const t = useT();
  const [kind, setKind] = useState<TabStop["kind"]>("left");
  const [drag, setDrag] = useState<{ from: number; x: number; off: boolean } | null>(null);
  const band = useRef<HTMLDivElement>(null);
  const g = pageGeometry(page);
  const info = useThrottledEditorState<RulerInfo>({
    editor,
    selector: ({ editor: e }) => {
      const nodes = selectedParagraphs(e.state);
      const first = nodes[0];
      const col = measureColumn(e, page);
      return {
        ...col,
        indent: ((first?.attrs.indent as Indent | null) ?? {}) as Indent,
        tabs: first ? tabsOf(ctl.styles, first) : [],
        ids: nodes.map((n) => n.attrs.id as number),
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

  const cm = Math.floor(info.width / PX_PER_CM);
  const ind = info.indent;
  const px = (tw: number | null | undefined) => (tw ?? 0) / TWIPS_PER_PX;
  const firstLine = px(ind.left) + (ind.firstLine != null ? px(ind.firstLine) : -px(ind.hanging));
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
        <div className="absolute inset-y-1 bg-white" style={{ left: info.left, width: info.width }} data-testid="ruler-column">
          {Array.from({ length: cm * 4 + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute bottom-0 border-l border-gray-400"
              style={{ left: (i * PX_PER_CM) / 4, height: i % 4 === 0 ? 0 : i % 2 === 0 ? 6 : 3 }}
            />
          ))}
          {Array.from({ length: cm }, (_, i) => (
            <span key={`n${i}`} className="absolute top-0.5 -translate-x-1/2 text-[9px] leading-3 text-gray-500" style={{ left: (i + 1) * PX_PER_CM }}>
              {i + 1}
            </span>
          ))}
        </div>
        {/* Indents (display): first line on top, left/hanging at the bottom, right indent. */}
        <span className="pointer-events-none absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-gray-500" style={{ left: info.left + firstLine }} aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent border-b-gray-500" style={{ left: info.left + px(ind.left) }} aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent border-b-gray-500" style={{ left: info.left + info.width - px(ind.right) }} aria-hidden="true" />
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
              title={t("write.tabStopAt", { kind: t(`write.tabKind.${s.kind}`), pos: (s.pos / (1440 / 2.54)).toFixed(2) })}
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
