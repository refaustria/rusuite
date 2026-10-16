// The Slide Master view: the master or a layout shown as an editable
// pseudo slide (one shape per placeholder, with PowerPoint's sample text
// per outline level), and the translation of the editor's commands on
// those shapes into design commands (`SetMasterPlaceholderProps`):
// moving / resizing → `transform`, run formatting of level 1 → `run`,
// paragraph formatting of level 1 → `paragraph`.

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { DesignTarget } from "../generated/DesignTarget";
import type { LayoutKind } from "../generated/LayoutKind";
import type { PlaceholderDef } from "../generated/PlaceholderDef";
import type { PlaceholderKind } from "../generated/PlaceholderKind";
import type { PlaceholderPatch } from "../generated/PlaceholderPatch";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";
import type { TextParagraph } from "../generated/TextParagraph";
import { t } from "../i18n";

/** Id of the pseudo slide of the master view. */
export const DESIGN_SLIDE_ID = 1_999_999_999;
/** Ids of the pseudo shapes: this plus the placeholder's index. */
export const DESIGN_SHAPE_BASE = 2_000_000_000;

export const isDesignShape = (id: number) => id >= DESIGN_SHAPE_BASE;

/** A stable string of a target (React keys, test ids). */
export const targetKey = (t: DesignTarget) => (t.kind === "master" ? "master" : `layout:${t.value}`);

export const sameTarget = (a: DesignTarget, b: DesignTarget) => targetKey(a) === targetKey(b);

/** The placeholders of a design target. */
export function targetPlaceholders(pres: Pick<Presentation, "master" | "layouts">, target: DesignTarget): PlaceholderDef[] {
  if (target.kind === "master") return pres.master?.placeholders ?? [];
  return pres.layouts.find((l) => l.kind === target.value)?.placeholders ?? [];
}

const gray: Color = { kind: "rgb", value: "A6A6A6" };

/** PowerPoint's sample text of a placeholder in the master view. */
export function sampleParagraphs(kind: PlaceholderKind): TextParagraph[] {
  const p = (text: string, level = 0): TextParagraph => ({ props: level ? { level } : undefined, runs: [{ text }] });
  switch (kind) {
    case "title":
    case "centeredTitle":
      return [p(t("show.master.sampleTitle"))];
    case "subtitle":
      return [p(t("show.master.sampleSubtitle"))];
    case "body":
      return [
        p(t("show.master.sampleLevel1")),
        p(t("show.master.sampleLevel2"), 1),
        p(t("show.master.sampleLevel3"), 2),
        p(t("show.master.sampleLevel4"), 3),
        p(t("show.master.sampleLevel5"), 4),
      ];
    case "picture":
      return [p(t("show.master.samplePicture"))];
    case "dateTime":
      return [{ runs: [{ text: "", field: { kind: "dateTime", value: { format: 1 } } }] }];
    case "footer":
      return [p(t("show.master.sampleFooter"))];
    case "slideNumber":
      return [{ runs: [{ text: "‹#›", field: { kind: "slideNumber" } }] }];
  }
}

/** A pseudo shape for placeholder `def` (index `i` of its target). */
export function designShape(def: PlaceholderDef, i: number): Shape {
  return {
    id: DESIGN_SHAPE_BASE + i,
    name: def.kind,
    transform: def.transform,
    kind: { kind: "auto", value: { geometry: "rect", text: { props: def.bodyDefaults, paragraphs: sampleParagraphs(def.kind) } } },
    fill: { kind: "none" },
    line: { fill: { kind: "solid", value: gray }, width: 9525, dash: "dash" },
    placeholder: def.kind,
    placeholderIdx: def.idx,
  };
}

const cache = new WeakMap<object, Map<string, Slide>>();

/** The pseudo slide of `target` (memoized per master / layouts list). */
export function designSlide(pres: Pick<Presentation, "master" | "layouts">, target: DesignTarget): Slide {
  const owner = (target.kind === "master" ? pres.master : pres.layouts) ?? pres.layouts;
  let m = cache.get(owner);
  if (!m) {
    m = new Map();
    cache.set(owner, m);
  }
  const key = `${targetKey(target)}|${pres.master ? "m" : ""}`;
  const hit = m.get(key);
  if (hit) return hit;
  const layout: LayoutKind = target.kind === "layout" ? target.value : (pres.layouts[0]?.kind ?? "blank");
  const slide: Slide = { id: DESIGN_SLIDE_ID, layout, shapes: targetPlaceholders(pres, target).map(designShape) };
  m.set(key, slide);
  return slide;
}

/** The placeholder a pseudo shape stands for. */
export function placeholderOfShape(pres: Pick<Presentation, "master" | "layouts">, target: DesignTarget, id: number): PlaceholderDef | undefined {
  return isDesignShape(id) ? targetPlaceholders(pres, target)[id - DESIGN_SHAPE_BASE] : undefined;
}

/** `SetMasterPlaceholderProps` of a placeholder. */
export function placeholderCommand(target: DesignTarget, def: PlaceholderDef, patch: PlaceholderPatch): ShowCommand {
  const c: ShowCommand = { type: "setMasterPlaceholderProps", target, placeholder: def.kind, patch };
  if (def.idx) c.idx = def.idx;
  return c;
}

/**
 * Translates an editor command on the pseudo slide into design commands:
 * `setTransform` → placeholder transforms, `setRunProps` / `setParagraphProps`
 * on the first paragraph (level 1) → run / paragraph defaults. Returns the
 * commands and whether something could not be translated (deeper levels,
 * text, adding or deleting shapes).
 */
export function translateDesignCommand(
  pres: Pick<Presentation, "master" | "layouts">,
  target: DesignTarget,
  cmd: ShowCommand,
): { commands: ShowCommand[]; dropped: boolean } {
  const out: ShowCommand[] = [];
  let dropped = false;
  const def = (id: number) => placeholderOfShape(pres, target, id);
  const visit = (c: ShowCommand) => {
    switch (c.type) {
      case "compound":
        c.commands.forEach(visit);
        return;
      case "setTransform":
        for (const [id, tr] of c.shapes) {
          const d = def(id);
          if (d) out.push(placeholderCommand(target, d, { transform: { ...tr, rotationDeg: tr.rotationDeg ?? 0 } }));
          else dropped = true;
        }
        return;
      case "setRunProps": {
        const d = def(c.shape);
        if (d && c.paragraph === 0) out.push(placeholderCommand(target, d, { run: c.patch }));
        else dropped = true;
        return;
      }
      case "setParagraphProps": {
        const d = def(c.shape);
        if (d && c.paragraphs.includes(0)) {
          const { level: _level, ...rest } = c.patch;
          out.push(placeholderCommand(target, d, { paragraph: rest }));
        }
        if (!d || c.paragraphs.some((p) => p !== 0)) dropped = true;
        return;
      }
      case "setTextBody":
        // the sample text is not stored; editing it changes nothing
        return;
      default:
        dropped = true;
    }
  };
  visit(cmd);
  return { commands: out, dropped };
}

/** The design target after the layouts changed (a deleted layout → the master). */
export function validTarget(pres: Pick<Presentation, "layouts">, target: DesignTarget): DesignTarget {
  return target.kind === "layout" && !pres.layouts.some((l) => l.kind === target.value) ? { kind: "master" } : target;
}
