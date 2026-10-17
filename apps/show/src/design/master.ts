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
import { textClass } from "./deck";

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
      return [{ props: { bullet: { kind: "none" }, alignment: "center" }, runs: [{ text: t("show.master.samplePicture") }] }];
    case "chart":
      return [{ props: { bullet: { kind: "none" }, alignment: "center" }, runs: [{ text: t("show.master.sampleChart") }] }];
    case "table":
      return [{ props: { bullet: { kind: "none" }, alignment: "center" }, runs: [{ text: t("show.master.sampleTable") }] }];
    case "dateTime":
      return [{ runs: [{ text: "", field: { kind: "dateTime", value: { format: 1 } } }] }];
    case "footer":
      return [p(t("show.master.sampleFooter"))];
    case "slideNumber":
      return [{ runs: [{ text: "‹#›", field: { kind: "slideNumber" } }] }];
  }
}

/**
 * The text a placeholder shows in the master view: its custom prompt (one
 * paragraph per line; on body placeholders line N is outline level N),
 * else PowerPoint's sample text.
 */
export function placeholderText(def: PlaceholderDef): TextParagraph[] {
  if (def.prompt === undefined || def.prompt === null || def.kind === "dateTime" || def.kind === "slideNumber") return sampleParagraphs(def.kind);
  const body = def.kind === "body";
  return def.prompt.split("\n").map((text, i) => ({ props: body && i > 0 && i < 9 ? { level: i } : undefined, runs: text ? [{ text }] : [] }));
}

/** A pseudo shape for placeholder `def` (index `i` of its target). */
export function designShape(def: PlaceholderDef, i: number): Shape {
  return {
    id: DESIGN_SHAPE_BASE + i,
    name: def.kind,
    transform: def.transform,
    kind: { kind: "auto", value: { geometry: "rect", text: { props: def.bodyDefaults, paragraphs: placeholderText(def) } } },
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

/** Commands the master view sends as they are (everything else is translated from the pseudo slide). */
export const DESIGN_COMMANDS = new Set<ShowCommand["type"]>([
  "setMasterPlaceholderProps", "setBackground", "addLayout", "duplicateLayout", "deleteLayout", "applyTheme", "setThemeColors",
  "setThemeFonts", "setSlideSize", "setHeaderFooter", "restoreSections", "renameLayout", "addPlaceholder", "removePlaceholder",
  "setMasterTextStyle", "setPlaceholderPrompt", "setBackgroundPicture",
  // P9-S3: Effects, the master's and layouts' guides, the view settings (grid, guides on / off)
  "setThemeEffects", "setDesignGuides", "setViewProps",
]);

/** Plain text of paragraphs, one line each. */
const plainText = (paras: TextParagraph[]) => paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n");

/**
 * Translates an editor command on the pseudo slide into design commands:
 * `setTransform` → placeholder transforms; `setRunProps` /
 * `setParagraphProps` on paragraph 1 → the placeholder's run / paragraph
 * defaults, on deeper paragraphs of the master's body placeholder → that
 * outline level of the master's body text style (`setMasterTextStyle`),
 * of a layout's body-like placeholder → that level of its own list style
 * (`setMasterPlaceholderProps` with `level`); with `level` set – the
 * Slide Master tab's text level – only that level changes; `setTextBody`
 * → the placeholder's custom prompt (back to the sample text: no prompt);
 * `deleteShapes` → `removePlaceholder`. Returns the commands and whether
 * something could not be translated (deeper levels of titles, adding
 * shapes).
 */
export function translateDesignCommand(
  pres: Pick<Presentation, "master" | "layouts">,
  target: DesignTarget,
  cmd: ShowCommand,
  opts: { level?: number | null } = {},
): { commands: ShowCommand[]; dropped: boolean } {
  const out: ShowCommand[] = [];
  let dropped = false;
  const def = (id: number) => placeholderOfShape(pres, target, id);
  const level = opts.level ?? null;
  // outline levels: the master's body placeholder (its text style) and the layouts' body-like placeholders (their own levels)
  const levelled = (d: PlaceholderDef) => target.kind === "master" && d.kind === "body";
  const layoutLevels = (d: PlaceholderDef) => target.kind === "layout" && textClass(d.kind) === "body";
  /** The outline level a change of paragraph `p` goes to (`null`: none, with a chosen level only paragraph 1's change counts). */
  const levelOf = (p: number): number | null => (level !== null ? (p === 0 ? level : null) : Math.min(8, p));
  const visit = (c: ShowCommand) => {
    if (DESIGN_COMMANDS.has(c.type)) {
      out.push(c);
      return;
    }
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
        if (!d) {
          dropped = true;
          return;
        }
        if (d && levelled(d)) {
          // with a chosen level, the first paragraph's change goes to it
          if (level !== null) {
            if (c.paragraph === 0) out.push({ type: "setMasterTextStyle", which: "body", level, run: c.patch });
          } else if (c.paragraph === 0) out.push(placeholderCommand(target, d, { run: c.patch }));
          else out.push({ type: "setMasterTextStyle", which: "body", level: Math.min(8, c.paragraph), run: c.patch });
          return;
        }
        if (layoutLevels(d)) {
          const l = levelOf(c.paragraph);
          if (l !== null) out.push(placeholderCommand(target, d, l ? { run: c.patch, level: l } : { run: c.patch }));
          return;
        }
        if (c.paragraph === 0) out.push(placeholderCommand(target, d, { run: c.patch }));
        else dropped = true;
        return;
      }
      case "setParagraphProps": {
        const d = def(c.shape);
        if (!d) {
          dropped = true;
          return;
        }
        const { level: _level, ...rest } = c.patch;
        if (levelled(d)) {
          if (level !== null) {
            if (c.paragraphs.includes(0)) out.push({ type: "setMasterTextStyle", which: "body", level, paragraph: rest });
            return;
          }
          for (const p of c.paragraphs) {
            if (p === 0) out.push(placeholderCommand(target, d, { paragraph: rest }));
            else out.push({ type: "setMasterTextStyle", which: "body", level: Math.min(8, p), paragraph: rest });
          }
          return;
        }
        if (layoutLevels(d)) {
          for (const p of c.paragraphs) {
            const l = levelOf(p);
            if (l !== null) out.push(placeholderCommand(target, d, l ? { paragraph: rest, level: l } : { paragraph: rest }));
          }
          return;
        }
        if (c.paragraphs.includes(0)) out.push(placeholderCommand(target, d, { paragraph: rest }));
        if (c.paragraphs.some((p) => p !== 0)) dropped = true;
        return;
      }
      case "setTextBody": {
        // typed text becomes the placeholder's prompt (the sample text: none)
        const d = def(c.shape);
        if (!d) return;
        if (d.kind === "dateTime" || d.kind === "slideNumber") return;
        const text = plainText(c.body.paragraphs);
        const sample = plainText(sampleParagraphs(d.kind));
        const prompt = text === sample || text.trim() === "" ? null : text;
        if ((d.prompt ?? null) !== prompt) {
          const pc: ShowCommand = { type: "setPlaceholderPrompt", target, placeholder: d.kind, prompt };
          if (d.idx) pc.idx = d.idx;
          out.push(pc);
        }
        return;
      }
      case "deleteShapes":
        for (const id of c.ids) {
          const d = def(id);
          if (!d) {
            dropped = true;
            continue;
          }
          const rc: ShowCommand = { type: "removePlaceholder", target, placeholder: d.kind };
          if (d.idx) rc.idx = d.idx;
          out.push(rc);
        }
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
