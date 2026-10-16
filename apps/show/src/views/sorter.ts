// Slide Sorter (P8-28), pure parts: the multi-selection of thumbnails
// (click, Ctrl+click toggles, Shift+click a range from the anchor) and
// moving the selected slides to a drop position – also into another
// section – as one command: `MoveSlide`s from the current to the wanted
// order, plus `RestoreSections` with the wanted membership when the deck
// has sections (the core's `MoveSlide` alone joins the section of the
// slide before).

import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Section } from "../generated/Section";
import type { ShowCommand } from "../generated/ShowCommand";

/** The selection after a click on `id` (`toggle`: Ctrl, `range`: Shift from `anchor`). */
export function sorterSelect(order: readonly NodeId[], sel: readonly NodeId[], id: NodeId, mode: "replace" | "toggle" | "range", anchor: NodeId | null): NodeId[] {
  if (mode === "toggle") {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    return next.length ? next : [id];
  }
  if (mode === "range" && anchor !== null) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) return order.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  return [id];
}

/**
 * `MoveSlide` commands turning `from` into `to` (the same ids): one per
 * `moved` slide when that suffices (the dragged ones, left to right), else
 * one per position that differs.
 */
export function moveCommands(from: readonly NodeId[], to: readonly NodeId[], moved?: readonly NodeId[]): ShowCommand[] {
  if (moved?.length) {
    const cur = [...from];
    const out: ShowCommand[] = [];
    for (const id of [...moved].sort((a, b) => to.indexOf(a) - to.indexOf(b))) {
      const at = cur.indexOf(id);
      const i = to.indexOf(id);
      if (at < 0 || i < 0 || at === i) continue;
      cur.splice(at, 1);
      cur.splice(i, 0, id);
      out.push({ type: "moveSlide", id, toIndex: i });
    }
    if (cur.every((id, i) => id === to[i])) return out;
  }
  const cur = [...from];
  const out: ShowCommand[] = [];
  to.forEach((id, i) => {
    if (cur[i] === id) return;
    const at = cur.indexOf(id);
    if (at < 0) return;
    cur.splice(at, 1);
    cur.splice(i, 0, id);
    out.push({ type: "moveSlide", id, toIndex: i });
  });
  return out;
}

/** Where the dragged slides go: before slide `before` (`null` = the end), into `section` (default: `before`'s, else the last). */
export interface SorterDrop {
  before: NodeId | null;
  section?: number;
}

/** The slide order and sections after dropping `moving` at `drop`. */
export function orderAfterDrop(pres: Pick<Presentation, "slides" | "sections">, moving: readonly NodeId[], drop: SorterDrop): { order: NodeId[]; sections: Section[] | null } {
  const order = pres.slides.map((s) => s.id);
  const set = new Set(moving);
  const moved = order.filter((id) => set.has(id));
  const secs = pres.sections ?? [];
  if (!secs.length) {
    const rest = order.filter((id) => !set.has(id));
    let at = drop.before === null ? rest.length : rest.indexOf(drop.before);
    if (at < 0) {
      // dropped before one of the moved slides: before the next unmoved one
      const i = order.indexOf(drop.before!);
      const next = order.slice(i).find((id) => !set.has(id));
      at = next === undefined ? rest.length : rest.indexOf(next);
    }
    return { order: [...rest.slice(0, at), ...moved, ...rest.slice(at)], sections: null };
  }
  const sections: Section[] = secs.map((s) => ({ name: s.name, slideIds: s.slideIds.filter((id) => !set.has(id)) }));
  let target = drop.section ?? (drop.before === null ? secs.length - 1 : secs.findIndex((s) => s.slideIds.includes(drop.before!)));
  if (target < 0 || target >= sections.length) target = sections.length - 1;
  const ids = sections[target]!.slideIds;
  let at = drop.before === null ? ids.length : ids.indexOf(drop.before);
  if (at < 0) {
    const orig = secs[target]!.slideIds;
    const i = orig.indexOf(drop.before!);
    const next = i < 0 ? undefined : orig.slice(i).find((id) => !set.has(id));
    at = next === undefined ? ids.length : ids.indexOf(next);
  }
  ids.splice(at, 0, ...moved);
  return { order: sections.flatMap((s) => s.slideIds), sections };
}

/** The command moving `moving` to `drop` (`null` = nothing changes). */
export function moveSlidesCommand(pres: Pick<Presentation, "slides" | "sections">, moving: readonly NodeId[], drop: SorterDrop): ShowCommand | null {
  if (!moving.length) return null;
  const { order, sections } = orderAfterDrop(pres, moving, drop);
  const commands = moveCommands(pres.slides.map((s) => s.id), order, moving);
  const old = (pres.sections ?? []).map((s) => ({ name: s.name, slideIds: s.slideIds }));
  if (sections && JSON.stringify(sections) !== JSON.stringify(old)) commands.push({ type: "restoreSections", sections });
  if (!commands.length) return null;
  return commands.length === 1 ? commands[0]! : { type: "compound", commands };
}

/** Sorter zoom: thumbnail width in px for the slider's percentage (100 % = 200 px). */
export const sorterThumbWidth = (zoom: number): number => Math.round(Math.max(40, Math.min(400, 2 * zoom)));
