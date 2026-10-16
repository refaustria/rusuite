// Sections in the slide panel (`Presentation.sections`, P8-19): ranges of
// slides per section and the commands of the panel's gestures. Moving a
// slide into another section is `MoveSlide` plus `RestoreSections` with
// the wanted membership (the core's `MoveSlide` alone puts a moved slide
// into the section of the slide before it), in one undo step.

import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Section } from "../generated/Section";
import type { ShowCommand } from "../generated/ShowCommand";

/** A section with the index of its first slide in the deck. */
export interface SectionRange {
  index: number;
  name: string;
  start: number;
  count: number;
  slideIds: NodeId[];
}

/** The sections of a presentation with their slide ranges (empty = no sections). */
export function sectionRanges(pres: Pick<Presentation, "sections">): SectionRange[] {
  let start = 0;
  return (pres.sections ?? []).map((s, index) => {
    const r = { index, name: s.name, start, count: s.slideIds.length, slideIds: s.slideIds };
    start += s.slideIds.length;
    return r;
  });
}

/** The index of the section holding slide `id` (`-1` = none). */
export function sectionOf(pres: Pick<Presentation, "sections">, id: NodeId): number {
  return (pres.sections ?? []).findIndex((s) => s.slideIds.includes(id));
}

/**
 * Moves slide `id` to position `at` (0-based among the other slides of
 * section `section`): `MoveSlide` to the deck position and the sections
 * with the slide in `section`.
 */
export function moveToSectionCommand(pres: Pick<Presentation, "slides" | "sections">, id: NodeId, section: number, at: number): ShowCommand | null {
  const secs = pres.sections ?? [];
  if (!secs[section]) return null;
  const sections: Section[] = secs.map((s) => ({ name: s.name, slideIds: s.slideIds.filter((x) => x !== id) }));
  const target = sections[section]!;
  const pos = Math.max(0, Math.min(at, target.slideIds.length));
  target.slideIds.splice(pos, 0, id);
  const order = sections.flatMap((s) => s.slideIds);
  const toIndex = order.indexOf(id);
  const from = pres.slides.findIndex((s) => s.id === id);
  if (from < 0) return null;
  const same = JSON.stringify(sections) === JSON.stringify(secs.map((s) => ({ name: s.name, slideIds: s.slideIds })));
  if (same) return null;
  const commands: ShowCommand[] = [];
  if (from !== toIndex) commands.push({ type: "moveSlide", id, toIndex });
  commands.push({ type: "restoreSections", sections });
  return commands.length === 1 ? commands[0]! : { type: "compound", commands };
}

/** Removes every section (Remove All Sections; the slides stay). */
export const removeAllSectionsCommand = (): ShowCommand => ({ type: "restoreSections", sections: [] });

/** Whether section `index` can move up / down. */
export function canMoveSection(pres: Pick<Presentation, "sections">, index: number, delta: -1 | 1): boolean {
  const n = pres.sections?.length ?? 0;
  const to = index + delta;
  return index >= 0 && index < n && to >= 0 && to < n;
}
