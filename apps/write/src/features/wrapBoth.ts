// Wrap Text "both sides" (P9-W4). CSS floats push text to one side only;
// Word fills the text area left of a centred picture and continues the
// same line right of it. A picture wrapped on both sides is placed out of
// the flow (`floatPlacement` mode `both`), and every line crossing its
// exclusion box (the picture plus its distances) gets an inline spacer
// widget: placed after the last word that ends left of the box, as wide as
// the rest of the box, so that the line goes on right of it. Lines are the
// browser's: each pass measures the lines, fixes the first line whose
// spacer is missing or wrong and runs again (the lines after it move), at
// most `MAX_PASSES` times. The spacers are ordinary DOM in the editor, so
// print and PDF (clones of the editor) wrap the same way.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Anchor } from "../generated/Anchor";
import type { Drawing } from "../generated/Drawing";
import { zoomOf } from "./floating";

/** EMU per CSS pixel. */
const EMU_PER_PX = 9525;
const MAX_PASSES = 40;

/** An exclusion: the band of lines it crosses and the horizontal gap it leaves (px, editor coordinates, unzoomed). */
export interface Exclusion {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A measured line of a paragraph (editor coordinates): its box and its characters' right edges with the PM position after each. */
export interface WrapLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Characters in order: right edge, whether it is a space, PM position after it. */
  chars: { right: number; space: boolean; after: number }[];
  /** PM position of the line's first character. */
  start: number;
}

/** A spacer: PM position and width (px). */
export interface Spacer {
  pos: number;
  width: number;
}

/**
 * Where the spacer of `line` goes for `ex`: after the last space that ends
 * left of the exclusion (else at the line's start), as wide as the rest of
 * the exclusion; null when the line does not reach the exclusion.
 */
export function spacerFor(line: WrapLine, ex: Exclusion): Spacer | null {
  if (line.bottom <= ex.top || line.top >= ex.bottom) return null;
  if (line.right <= ex.left + 0.5) return null;
  let pos = line.start;
  let x = line.left;
  for (const c of line.chars) {
    if (c.right > ex.left + 0.5) break;
    if (c.space) {
      pos = c.after;
      x = c.right;
    }
  }
  // The whole line ends before the exclusion: nothing to move.
  return { pos, width: Math.max(0, Math.round((ex.right - x) * 100) / 100) };
}

/** Whether an existing spacer (its box) is right for `ex`: it starts left of the exclusion and ends at its right edge. */
export function spacerFits(box: { left: number; right: number }, ex: Exclusion): boolean {
  return box.left <= ex.left + 1 && Math.abs(box.right - ex.right) <= 1;
}

export const wrapBothKey = new PluginKey<DecorationSet>("rusuiteWrapBoth");

const spacerWidget = (s: Spacer) =>
  Decoration.widget(
    s.pos,
    () => {
      const el = document.createElement("span");
      el.className = "wrap-spacer";
      el.style.width = `${s.width}px`;
      el.setAttribute("aria-hidden", "true");
      el.contentEditable = "false";
      return el;
    },
    { side: -1, key: `wrap-${s.pos}-${s.width}`, ignoreSelection: true, width: s.width },
  );

/** The exclusions of the pictures and drawings placed for both-sided wrapping (editor coordinates). */
function exclusions(view: EditorView, base: DOMRect, z: number): Exclusion[] {
  const out: Exclusion[] = [];
  view.dom.querySelectorAll<HTMLElement>(".inline-image-wrap.both, .drawing-wrap.both").forEach((el) => {
    let pos: number;
    try {
      pos = view.posAtDOM(el, 0);
    } catch {
      return;
    }
    const node = view.state.doc.nodeAt(pos);
    const anchor = anchorOf(node);
    if (!anchor) return;
    const r = el.getBoundingClientRect();
    const d = anchor.distance;
    out.push({
      top: (r.top - base.top) / z - d.top / EMU_PER_PX,
      bottom: (r.bottom - base.top) / z + d.bottom / EMU_PER_PX,
      left: (r.left - base.left) / z - d.left / EMU_PER_PX,
      right: (r.right - base.left) / z + d.right / EMU_PER_PX,
    });
  });
  return out.sort((a, b) => a.top - b.top);
}

function anchorOf(node: PMNode | null): Anchor | null {
  if (!node) return null;
  if (node.type.name === "image") return (node.attrs.anchor as Anchor | null) ?? null;
  if (node.type.name === "drawing") return ((node.attrs.value as Drawing | null)?.anchor as Anchor | undefined) ?? null;
  return null;
}

/** The lines of the paragraphs crossing `band` (editor coordinates). */
function linesIn(view: EditorView, band: { top: number; bottom: number }, base: DOMRect, z: number): WrapLine[] {
  const lines: WrapLine[] = [];
  const range = document.createRange();
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const el = view.nodeDOM(pos) as HTMLElement | null;
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const top = (r.top - base.top) / z;
    const bottom = (r.bottom - base.top) / z;
    if (bottom <= band.top || top >= band.bottom) return false;
    const chars: { top: number; bottom: number; left: number; right: number; space: boolean; after: number; before: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if ((n.parentElement as HTMLElement | null)?.closest(".drawing-wrap, .inline-image-wrap, .wrap-spacer, .page-spacer")) continue;
      const text = n.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const cr = range.getClientRects()[0];
        if (!cr || cr.height <= 0) continue;
        let before: number;
        try {
          before = view.posAtDOM(n, i);
        } catch {
          continue;
        }
        chars.push({
          top: (cr.top - base.top) / z,
          bottom: (cr.bottom - base.top) / z,
          left: (cr.left - base.left) / z,
          right: (cr.right - base.left) / z,
          space: /\s/.test(text[i]!),
          before,
          after: before + 1,
        });
      }
    }
    let cur: WrapLine | null = null;
    for (const c of chars) {
      if (!cur || c.top >= cur.bottom - 0.5 * (c.bottom - c.top)) {
        cur = { top: c.top, bottom: c.bottom, left: c.left, right: c.right, chars: [], start: c.before };
        lines.push(cur);
      }
      cur.bottom = Math.max(cur.bottom, c.bottom);
      cur.right = Math.max(cur.right, c.right);
      cur.chars.push({ right: c.right, space: c.space, after: c.after });
    }
    return false;
  });
  return lines;
}

/** One pass: the spacers to use now and whether they differ from `current`. */
function pass(view: EditorView, current: Spacer[]): { spacers: Spacer[]; changed: boolean } {
  const z = zoomOf(view.dom as HTMLElement);
  const base = view.dom.getBoundingClientRect();
  const exs = exclusions(view, base, z);
  if (!exs.length) return { spacers: [], changed: current.length > 0 };
  const top = Math.min(...exs.map((e) => e.top));
  const bottom = Math.max(...exs.map((e) => e.bottom));
  const lines = linesIn(view, { top, bottom }, base, z);
  // The spacers drawn now with their boxes.
  const drawn = [...view.dom.querySelectorAll<HTMLElement>(".wrap-spacer")].map((el) => {
    const r = el.getBoundingClientRect();
    let pos = -1;
    try {
      pos = view.posAtDOM(el, 0);
    } catch {
      pos = -1;
    }
    return { pos, top: (r.top - base.top) / z, bottom: (r.bottom - base.top) / z, left: (r.left - base.left) / z, right: (r.right - base.left) / z };
  });
  const keep: Spacer[] = [];
  for (const line of lines) {
    const ex = exs.find((e) => line.bottom > e.top && line.top < e.bottom);
    if (!ex) continue;
    const own = drawn.find((d) => d.top < line.bottom && d.bottom > line.top - 0.5 && d.left >= line.left - 1);
    const mine = own ? current.find((s) => s.pos === own.pos) : undefined;
    if (own && mine && spacerFits(own, ex)) {
      keep.push(mine);
      continue;
    }
    const want = spacerFor(line, ex);
    if (!want) continue;
    if (own && mine && own.left <= ex.left + 1) {
      // Right place, wrong width.
      keep.push({ pos: mine.pos, width: Math.max(0, Math.round((ex.right - own.left) * 100) / 100) });
      return { spacers: withLater(keep, current, mine.pos), changed: true };
    }
    keep.push(want);
    // The lines after this one move: measure again.
    return { spacers: withLater(keep, current, want.pos), changed: true };
  }
  const same = keep.length === current.length && keep.every((s, i) => s.pos === current[i]!.pos && s.width === current[i]!.width);
  return { spacers: keep, changed: !same };
}

/** `keep` plus the spacers of `current` after `pos` (checked in the next pass). */
const withLater = (keep: Spacer[], current: Spacer[], pos: number) => [...keep, ...current.filter((s) => s.pos > pos && !keep.some((k) => k.pos === s.pos))];

/** The plugin: spacers as widget decorations, recomputed after changes and layout runs. */
export function wrapBothPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: wrapBothKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(wrapBothKey) as DecorationSet | undefined;
        return meta ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => wrapBothKey.getState(state),
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let running = false;
      const run = () => {
        timer = null;
        if (running || !view.dom.isConnected) return;
        running = true;
        try {
          let spacers: Spacer[] = (wrapBothKey.getState(view.state)?.find() ?? []).map((d) => ({ pos: d.from, width: Number((d.spec as { width?: number }).width ?? 0) }));
          for (let i = 0; i < MAX_PASSES; i++) {
            const r = pass(view, spacers);
            if (!r.changed) break;
            spacers = r.spacers;
            const set = DecorationSet.create(view.state.doc, spacers.map(spacerWidget));
            view.dispatch(view.state.tr.setMeta(wrapBothKey, set).setMeta("addToHistory", false));
          }
        } finally {
          running = false;
        }
      };
      const schedule = () => {
        if (running) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, 40);
      };
      view.dom.addEventListener("rusuite-layout", schedule);
      window.addEventListener("resize", schedule);
      schedule();
      return {
        update(v, prev) {
          if (!prev.doc.eq(v.state.doc) && !running) schedule();
        },
        destroy() {
          if (timer) clearTimeout(timer);
          view.dom.removeEventListener("rusuite-layout", schedule);
          window.removeEventListener("resize", schedule);
        },
      };
    },
  });
}
