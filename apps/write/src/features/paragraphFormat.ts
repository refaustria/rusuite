// Home › Paragraph: borders (Word's Borders ▾ for paragraphs), shading and
// tab stops (ruler, Tabs… dialog). Rust-first `SetParagraphProps` on the
// selected paragraphs (borders merge side by side; tab stops merge by
// position, a `clear` stop removes one; `shading: auto` removes the fill).

import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { BorderSide } from "../generated/BorderSide";
import type { ParagraphBorders } from "../generated/ParagraphBorders";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TabStop } from "../generated/TabStop";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { resolveTabs, styleIdOf } from "./tabStops";

/** The textblocks of the selection (the caret's at least). */
export function selectedParagraphs(state: EditorState): PMNode[] {
  const { from, to } = state.selection;
  const out: PMNode[] = [];
  state.doc.nodesBetween(from, Math.max(to, from), (node) => {
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      if (node.attrs.id != null) out.push(node);
      return false;
    }
    return true;
  });
  if (!out.length && state.selection.$from.parent.isTextblock && state.selection.$from.parent.attrs.id != null) out.push(state.selection.$from.parent);
  return out;
}

const idsOf = (nodes: PMNode[]) => nodes.map((n) => n.attrs.id as number);

/** The direct paragraph borders of a textblock node. */
export const paragraphBorders = (n: PMNode): ParagraphBorders => (n.attrs.extra as { borders?: ParagraphBorders } | null)?.borders ?? {};
export const paragraphShading = (n: PMNode): Color | null => (n.attrs.extra as { shading?: Color } | null)?.shading ?? null;
export const paragraphTabs = (n: PMNode): TabStop[] => (n.attrs.extra as { tabs?: TabStop[] } | null)?.tabs ?? [];

/** Word's ½ pt single line, 1 pt from the text. */
export const PARA_BORDER: BorderSide = { style: "single", width: 10, color: { kind: "auto" }, space: 1 };
export const NO_PARA_BORDER: BorderSide = { style: "none", width: 0, color: { kind: "auto" } };

export type ParaBorderPreset = "bottom" | "top" | "left" | "right" | "none" | "all" | "outside" | "inside";

const on = (s: BorderSide | null | undefined) => !!s && s.style !== "none";

/**
 * Borders ▾ for the selected paragraphs: a single side toggles (Word: off
 * when every selected paragraph has it), All / Outside / Inside set those
 * sides, No Border removes all five.
 */
export function paragraphBordersCommand(nodes: PMNode[], preset: ParaBorderPreset, side: BorderSide = PARA_BORDER): WriteCommand | null {
  if (!nodes.length) return null;
  let patch: ParagraphBorders;
  switch (preset) {
    case "bottom":
    case "top":
    case "left":
    case "right": {
      const all = nodes.every((n) => on(paragraphBorders(n)[preset]));
      patch = { [preset]: all ? NO_PARA_BORDER : side };
      break;
    }
    case "none":
      patch = { top: NO_PARA_BORDER, bottom: NO_PARA_BORDER, left: NO_PARA_BORDER, right: NO_PARA_BORDER, between: NO_PARA_BORDER };
      break;
    case "all":
      patch = { top: side, bottom: side, left: side, right: side, between: side };
      break;
    case "outside":
      patch = { top: side, bottom: side, left: side, right: side };
      break;
    case "inside":
      patch = { between: side };
      break;
  }
  return { type: "setParagraphProps", blocks: idsOf(nodes), patch: { borders: patch } };
}

/** Which presets the selection shows as on (for the menu's checks). */
export function paragraphBorderState(nodes: PMNode[]): Record<"top" | "bottom" | "left" | "right" | "between", boolean> {
  const all = (k: keyof ParagraphBorders) => nodes.length > 0 && nodes.every((n) => on(paragraphBorders(n)[k]));
  return { top: all("top"), bottom: all("bottom"), left: all("left"), right: all("right"), between: all("between") };
}

/** Shading ▾: a fill, or (`null`) none. */
export const paragraphShadingCommand = (nodes: PMNode[], color: Color | null): WriteCommand | null =>
  nodes.length ? { type: "setParagraphProps", blocks: idsOf(nodes), patch: { shading: color ?? { kind: "auto" } } } : null;

/** Borders and Shading… result: the five sides (absent = unchanged) and the fill. */
export interface BordersShadingValues {
  borders: ParagraphBorders;
  shading: Color | null;
}

export function bordersShadingCommand(nodes: PMNode[], v: BordersShadingValues): WriteCommand | null {
  if (!nodes.length) return null;
  return { type: "setParagraphProps", blocks: idsOf(nodes), patch: { borders: v.borders, shading: v.shading ?? { kind: "auto" } } };
}

// ----- tab stops ----------------------------------------------------------------------

/** The tab stops in effect for a paragraph node. */
export const tabsOf = (sheet: StyleSheet | null, n: PMNode): TabStop[] => resolveTabs(sheet, styleIdOf(n), paragraphTabs(n));

/** Adds (or replaces) a stop on the selected paragraphs (ruler click). */
export function addTabCommand(nodes: PMNode[], stop: TabStop): WriteCommand | null {
  return nodes.length ? { type: "setParagraphProps", blocks: idsOf(nodes), patch: { tabs: [stop] } } : null;
}

/** Removes the stop at `pos` (dragged off the ruler): a `clear` entry. */
export function removeTabCommand(nodes: PMNode[], pos: number): WriteCommand | null {
  return nodes.length ? { type: "setParagraphProps", blocks: idsOf(nodes), patch: { tabs: [{ pos, kind: "clear" }] } } : null;
}

/** Moves a stop from `from` to `stop.pos` (dragged along the ruler). */
export function moveTabCommand(nodes: PMNode[], from: number, stop: TabStop): WriteCommand | null {
  if (!nodes.length || from === stop.pos) return null;
  return { type: "setParagraphProps", blocks: idsOf(nodes), patch: { tabs: [{ pos: from, kind: "clear" }, stop] } };
}

/** The patch turning the stops `before` into `after` (Tabs… dialog): `clear` for removed positions, the new and changed stops. */
export function tabsPatch(before: TabStop[], after: TabStop[]): TabStop[] {
  const key = (t: TabStop) => `${t.kind}:${t.leader ?? "none"}`;
  const out: TabStop[] = [];
  for (const b of before) if (!after.some((a) => a.pos === b.pos)) out.push({ pos: b.pos, kind: "clear" });
  for (const a of after) {
    const b = before.find((x) => x.pos === a.pos);
    if (!b || key(a) !== key(b)) out.push(a.leader && a.leader !== "none" ? a : { pos: a.pos, kind: a.kind });
  }
  return out.sort((x, y) => x.pos - y.pos);
}

export function tabsDialogCommand(nodes: PMNode[], before: TabStop[], after: TabStop[]): WriteCommand | null {
  const tabs = tabsPatch(before, after);
  return nodes.length && tabs.length ? { type: "setParagraphProps", blocks: idsOf(nodes), patch: { tabs } } : null;
}

/** Ruler snapping: 1/8 cm in twips (Word moves stops in small steps). */
export const RULER_SNAP_TWIPS = 1440 / 2.54 / 8;
export const snapTwips = (tw: number): number => Math.max(0, Math.round(Math.round(tw / RULER_SNAP_TWIPS) * RULER_SNAP_TWIPS));

/** The ruler corner selector's cycle (Word: left, centre, right, decimal, bar). */
export const TAB_KINDS: TabStop["kind"][] = ["left", "center", "right", "decimal", "bar"];
export const nextTabKind = (k: TabStop["kind"]): TabStop["kind"] => TAB_KINDS[(TAB_KINDS.indexOf(k) + 1) % TAB_KINDS.length]!;
