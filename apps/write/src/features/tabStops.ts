// Tab stops (docx `w:tabs`): the stops in effect for a paragraph (document
// defaults, its style chain, then its own, `clear` entries removing
// inherited ones), the layout of the tab characters of a line (left,
// centre, right and decimal stops, then Word's default stops every
// 1.27 cm) and the plugin that sizes every tab character in the editor
// (an inline decoration: an inline-block of the computed width with the
// stop's leader). Segment widths are measured in the DOM; a line that
// wraps is laid out as if it did not (approximation).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TabStop } from "../generated/TabStop";
import { mergeTabs } from "../sync/model";
import { TWIPS_PER_PX } from "../sync/schema";

/** Word's default tab interval (twips, 1.27 cm). */
export const DEFAULT_TAB_TWIPS = 720;

/** The paragraph style id of a textblock node. */
export function styleIdOf(node: PMNode, defaultStyle = "Normal"): string {
  if (node.type.name === "heading") return `Heading${node.attrs.level}`;
  if (node.type.name === "title") return "Title";
  return (node.attrs.style as string | null) ?? defaultStyle;
}

/** The tab stops in effect (sorted, without `clear` entries). */
export function resolveTabs(sheet: StyleSheet | null, styleId: string | null, direct: TabStop[] | null | undefined): TabStop[] {
  let tabs: TabStop[] = [...(sheet?.defaults.paragraph?.tabs ?? [])];
  if (sheet && styleId) {
    const chain: NonNullable<StyleSheet["styles"][number]>[] = [];
    let s = sheet.styles.find((x) => x.id === styleId);
    while (s && !chain.includes(s)) {
      chain.push(s);
      s = s.basedOn ? sheet.styles.find((x) => x.id === s!.basedOn) : undefined;
    }
    for (const st of chain.reverse()) tabs = mergeTabs(tabs, st.paragraph?.tabs ?? []);
  }
  tabs = mergeTabs(tabs, direct ?? []);
  return tabs.filter((t) => t.kind !== "clear");
}

/** The text after a tab up to the next tab (or the line end): its width and the width before its decimal point (px). */
export interface TabSegment {
  width: number;
  beforeDecimal: number;
}

/** One laid-out tab character: width (px) and the stop it went to (null = a default stop). */
export interface TabBox {
  width: number;
  stop: TabStop | null;
}

/**
 * Widths of the tab characters of a line: `x` = where the line's text
 * starts (px from the text column's left edge), `first` = the width of
 * the text before the first tab, `segments[i]` = the text after tab `i`.
 */
export function layoutTabs(stops: TabStop[], x: number, first: number, segments: TabSegment[], defaultPx = DEFAULT_TAB_TWIPS / TWIPS_PER_PX): TabBox[] {
  const out: TabBox[] = [];
  let pos = x + first;
  const real = stops.filter((s) => s.kind !== "bar" && s.kind !== "clear");
  for (const seg of segments) {
    const stop = real.find((s) => s.pos / TWIPS_PER_PX > pos + 0.5) ?? null;
    let width: number;
    if (!stop) {
      const next = (Math.floor(pos / defaultPx + 1e-6) + 1) * defaultPx;
      width = next - pos;
    } else {
      const at = stop.pos / TWIPS_PER_PX;
      const before = stop.kind === "right" ? seg.width : stop.kind === "center" ? seg.width / 2 : stop.kind === "decimal" ? seg.beforeDecimal : 0;
      width = Math.max(0, at - pos - before);
    }
    out.push({ width, stop });
    pos += width + seg.width;
  }
  return out;
}

/** CSS class of a leader. */
export const leaderClass = (stop: TabStop | null): string => (stop?.leader && stop.leader !== "none" ? ` tab-leader-${stop.leader}` : "");

export const tabStopsKey = new PluginKey<DecorationSet>("rusuiteTabStops");

interface Measured {
  /** Text column width the paragraph was measured at. */
  width: number;
  boxes: TabBox[];
}

/** PM positions (absolute) of the tab characters of the textblock at `pos`. */
function tabPositions(node: PMNode, pos: number): number[] {
  const out: number[] = [];
  node.forEach((child, offset) => {
    if (!child.isText || !child.text!.includes("\t")) return;
    for (let i = 0; i < child.text!.length; i++) if (child.text![i] === "\t") out.push(pos + 1 + offset + i);
  });
  return out;
}

function rangeWidth(view: EditorView, from: number, to: number, zoom: number): number {
  if (to <= from) return 0;
  try {
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r.getBoundingClientRect().width / zoom;
  } catch {
    return 0;
  }
}

/** Measures one paragraph and lays its tabs out. */
function measure(view: EditorView, node: PMNode, pos: number, tabs: number[], stops: TabStop[]): Measured | null {
  const el = view.nodeDOM(pos) as HTMLElement | null;
  if (!el || !el.getBoundingClientRect) return null;
  const rect = el.getBoundingClientRect();
  const zoom = el.offsetWidth ? rect.width / el.offsetWidth || 1 : 1;
  const marginLeft = parseFloat(getComputedStyle(el).marginLeft) || 0;
  const columnLeft = rect.left - marginLeft * zoom;
  let x = 0;
  try {
    x = (view.coordsAtPos(pos + 1).left - columnLeft) / zoom;
  } catch {
    x = 0;
  }
  const end = pos + node.nodeSize - 1;
  const first = rangeWidth(view, pos + 1, tabs[0]!, zoom);
  const segments: TabSegment[] = tabs.map((t, i) => {
    const to = tabs[i + 1] ?? end;
    const width = rangeWidth(view, t + 1, to, zoom);
    const text = node.textBetween(t + 1 - pos - 1, to - pos - 1, "", "");
    const dot = text.search(/[.,]/);
    return { width, beforeDecimal: dot < 0 ? width : rangeWidth(view, t + 1, t + 1 + dot, zoom) };
  });
  return { width: el.clientWidth, boxes: layoutTabs(stops, x, first, segments) };
}

/** The tab plugin; `styles` returns the document's style sheet. */
export function tabStopsPlugin(styles: () => StyleSheet | null): Plugin<DecorationSet> {
  let cache = new WeakMap<PMNode, Measured>();
  let lastSheet: StyleSheet | null | undefined;
  return new Plugin<DecorationSet>({
    key: tabStopsKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, old) => {
        const next = tr.getMeta(tabStopsKey) as DecorationSet | undefined;
        return next ?? old.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => tabStopsKey.getState(state) },
    view(view) {
      let last = "";
      const run = () => {
        if (view.isDestroyed) return;
        const sheet = styles();
        if (sheet !== lastSheet) {
          lastSheet = sheet;
          cache = new WeakMap();
        }
        const specs: [number, number, string][] = [];
        view.state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true;
          const tabs = tabPositions(node, pos);
          if (!tabs.length) return false;
          const el = view.nodeDOM(pos) as HTMLElement | null;
          let m = cache.get(node);
          if (!m || (el && m.width !== el.clientWidth)) {
            const stops = resolveTabs(sheet, styleIdOf(node), (node.attrs.extra as { tabs?: TabStop[] } | null)?.tabs);
            m = measure(view, node, pos, tabs, stops) ?? undefined;
            if (m) cache.set(node, m);
          }
          m?.boxes.forEach((b, i) => specs.push([tabs[i]!, Math.round(b.width * 10) / 10, `tab-char${leaderClass(b.stop)}`]));
          return false;
        });
        const key = specs.map((x) => x.join(":")).join("|");
        if (key === last) return;
        last = key;
        const decos = specs.map(([at, w, cls]) => Decoration.inline(at, at + 1, { class: cls, style: `width: ${w}px` }));
        view.dispatch(view.state.tr.setMeta(tabStopsKey, DecorationSet.create(view.state.doc, decos)).setMeta("addToHistory", false));
      };
      let frame: ReturnType<typeof setTimeout> | number | null = null;
      const schedule = () => {
        if (frame != null) return;
        const done = () => {
          frame = null;
          run();
        };
        frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(done) : setTimeout(done, 0);
      };
      schedule();
      return {
        update: () => schedule(),
        destroy() {
          if (frame != null && typeof cancelAnimationFrame === "function" && typeof frame === "number") cancelAnimationFrame(frame);
          frame = null;
        },
      };
    },
  });
}

/** Re-measures the tabs (after the style sheet or the page changed): any update schedules a run. */
export function refreshTabs(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta("addToHistory", false));
}
