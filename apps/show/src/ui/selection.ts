// Selection pane (P8-28), pure parts: the rows (the slide's shapes top to
// bottom, groups with their children) and the commands of its gestures –
// rename (`SetName`), show / hide (`SetShapesHidden`), Show All / Hide
// All, and reordering a top-level shape to a row (`ZOrder` steps, one
// undo step).

import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";

export interface PaneRow {
  id: NodeId;
  name: string;
  hidden: boolean;
  /** 0 = top level, 1 = a group's child … */
  depth: number;
  kind: Shape["kind"]["kind"];
  /** The top-level shape the row belongs to. */
  top: NodeId;
}

/** The rows of the Selection pane: topmost shape first, group children under their group (also topmost first). */
export function paneRows(slide: Slide): PaneRow[] {
  const out: PaneRow[] = [];
  const walk = (shapes: Shape[], depth: number, top: NodeId | null) => {
    for (const s of [...shapes].reverse()) {
      out.push({ id: s.id, name: s.name, hidden: !!s.hidden, depth, kind: s.kind.kind, top: top ?? s.id });
      if (s.kind.kind === "group") walk(s.kind.value.children, depth + 1, top ?? s.id);
    }
  };
  walk(slide.shapes, 0, null);
  return out;
}

/** Hide (`true`) or show `ids`. */
export const hideCommand = (ids: NodeId[], hidden: boolean): ShowCommand | null => (ids.length ? { type: "setShapesHidden", shapes: ids, hidden } : null);

/** Show All / Hide All of the slide's top-level shapes (only the ones that change). */
export function allCommand(slide: Slide, hidden: boolean): ShowCommand | null {
  return hideCommand(slide.shapes.filter((s) => !!s.hidden !== hidden).map((s) => s.id), hidden);
}

/** Rename (trimmed; empty or unchanged names send nothing). */
export function renameCommand(shape: Shape, name: string): ShowCommand | null {
  const n = name.trim();
  return n && n !== shape.name ? { type: "setName", shape: shape.id, name: n } : null;
}

/**
 * Moves top-level shape `id` to z-index `to` (0 = bottom): one
 * Bring Forward / Send Backward step per position, as one undo step.
 */
export function moveToZ(slide: Slide, id: NodeId, to: number): ShowCommand | null {
  const from = slide.shapes.findIndex((s) => s.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(slide.shapes.length - 1, to));
  if (target === from) return null;
  const op = target > from ? "bringForward" : "sendBackward";
  const steps = Math.abs(target - from);
  const commands: ShowCommand[] = Array.from({ length: steps }, () => ({ type: "zOrder", shapes: [id], op }));
  return commands.length === 1 ? commands[0]! : { type: "compound", commands };
}

/** The z-index a top-level shape gets when dropped on pane row `row` (rows of top-level shapes only, topmost first). */
export const zOfRow = (slide: Slide, row: number): number => slide.shapes.length - 1 - row;
