// Outline View (P8-28): the text outline of the deck – each slide's title
// placeholder and the paragraphs of its body placeholder with their
// outline levels – as text, and the commands that write an edited outline
// back. Each slide is edited as lines: the first line is the title, every
// body paragraph is indented by its level + 1 tab. Tab / Shift+Tab add or
// remove a leading tab: a body line without tabs starts a new slide
// (promote), a title line with a tab joins the previous slide's body
// (demote), as in PowerPoint.

import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { TextParagraph } from "../generated/TextParagraph";
import { paragraphText, textOf } from "../model";

export interface OutlineSlide {
  id: NodeId;
  hidden: boolean;
  /** The title placeholder (`null`: the slide has none). */
  titleShape: NodeId | null;
  title: string;
  /** The body (or subtitle) placeholder. */
  bodyShape: NodeId | null;
  /** Body paragraphs: outline level (0 = first) and text. */
  body: { level: number; text: string }[];
}

const isTitle = (s: Shape) => s.placeholder === "title" || s.placeholder === "centeredTitle";
const isBody = (s: Shape) => s.placeholder === "body" || s.placeholder === "subtitle";

/** The outline of one slide. */
export function outlineSlide(slide: Slide): OutlineSlide {
  const title = slide.shapes.find(isTitle);
  const body = slide.shapes.find(isBody);
  const titleBody = title ? textOf(title) : null;
  const bodyText = body ? textOf(body) : null;
  return {
    id: slide.id,
    hidden: !!slide.hidden,
    titleShape: title?.id ?? null,
    title: titleBody ? titleBody.paragraphs.map(paragraphText).join(" ") : "",
    bodyShape: body?.id ?? null,
    body: (bodyText?.paragraphs ?? [])
      .map((p) => ({ level: p.props?.level ?? 0, text: paragraphText(p) }))
      .filter((p, _i, all) => p.text !== "" || all.length > 1),
  };
}

/** The outline of the deck. */
export const outlineOf = (pres: Presentation): OutlineSlide[] => pres.slides.map(outlineSlide);

/** One slide's outline as editable lines (title, then each paragraph indented by level + 1 tabs). */
export function outlineText(o: OutlineSlide): string {
  return [o.title, ...o.body.map((p) => `${"\t".repeat(p.level + 1)}${p.text}`)].join("\n");
}

export interface ParsedSlide {
  title: string;
  body: { level: number; text: string }[];
}

/**
 * Parses edited lines: a line without leading tabs starts a slide (its
 * title); indented lines are body paragraphs (level = tabs − 1, at most
 * 8). `joinsPrevious`: the first line was indented (demoted title).
 */
export function parseOutline(text: string): { slides: ParsedSlide[]; joinsPrevious: boolean } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const slides: ParsedSlide[] = [];
  let joinsPrevious = false;
  lines.forEach((line, i) => {
    const tabs = /^\t*/.exec(line)![0].length;
    const content = line.slice(tabs);
    if (tabs === 0) {
      slides.push({ title: content, body: [] });
      return;
    }
    if (i === 0) {
      joinsPrevious = true;
      slides.push({ title: "", body: [] });
    }
    slides[slides.length - 1]!.body.push({ level: Math.min(8, tabs - 1), text: content });
  });
  if (!slides.length) slides.push({ title: "", body: [] });
  return { slides, joinsPrevious };
}

/** A body whose paragraphs are `lines` (formatting of the old paragraphs kept by index, levels set). */
export function bodyWithLines(old: TextBody | null, lines: { level: number; text: string }[]): TextBody {
  const props = old?.props ?? { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" };
  const olds = old?.paragraphs ?? [];
  const paragraphs: TextParagraph[] = (lines.length ? lines : [{ level: 0, text: "" }]).map((l, i) => {
    const prev = olds[i] ?? olds[olds.length - 1];
    const runProps = prev?.runs[0]?.props;
    const same = olds[i] && paragraphText(olds[i]!) === l.text && (olds[i]!.props?.level ?? 0) === l.level;
    if (same) return olds[i]!;
    const p: TextParagraph = { runs: l.text ? [runProps ? { props: runProps, text: l.text } : { text: l.text }] : [] };
    const pp = { ...(prev?.props ?? {}) };
    if (l.level > 0) pp.level = l.level;
    else delete pp.level;
    if (Object.keys(pp).length) p.props = pp;
    return p;
  });
  return { props, paragraphs };
}

/** `SetTextBody` of a placeholder when its text changes. */
function setText(slide: Slide, shapeId: NodeId | null, build: (old: TextBody | null) => TextBody): ShowCommand | null {
  if (shapeId === null) return null;
  const shape = slide.shapes.find((s) => s.id === shapeId);
  if (!shape) return null;
  const old = textOf(shape);
  const body = build(old);
  if (old && JSON.stringify(old) === JSON.stringify(body)) return null;
  return { type: "setTextBody", shape: shapeId, body };
}

/** What committing a slide's edited outline does. */
export interface OutlinePlan {
  /** Text commands of existing slides (one undo step). */
  commands: ShowCommand[];
  /** The edited slide is removed (its title was demoted into the previous slide). */
  deleteSlide: NodeId | null;
  /** New slides to insert after `after` (promoted body lines), in order. */
  newSlides: { after: NodeId; slides: ParsedSlide[] } | null;
}

/** The plan for the edited lines `text` of slide `id`. */
export function outlinePlan(pres: Presentation, id: NodeId, text: string): OutlinePlan {
  const index = pres.slides.findIndex((s) => s.id === id);
  const slide = pres.slides[index];
  const none: OutlinePlan = { commands: [], deleteSlide: null, newSlides: null };
  if (!slide) return none;
  const { slides, joinsPrevious } = parseOutline(text);
  const own = outlineSlide(slide);
  const commands: ShowCommand[] = [];
  let first = slides[0]!;
  let rest = slides.slice(1);
  if (joinsPrevious && index > 0) {
    // the title went one level down: these lines join the previous slide's body
    const prev = pres.slides[index - 1]!;
    const po = outlineSlide(prev);
    const c = setText(prev, po.bodyShape, (old) => bodyWithLines(old, [...po.body, ...first.body]));
    if (c) commands.push(c);
    if (!rest.length) return { commands, deleteSlide: slide.id, newSlides: null };
    // the next slide of the lines stays on this slide
    first = rest[0]!;
    rest = rest.slice(1);
  }
  const t = setText(slide, own.titleShape, (old) => bodyWithLines(old, [{ level: 0, text: first.title }]));
  if (t) commands.push(t);
  const b = setText(slide, own.bodyShape, (old) => bodyWithLines(old, first.body));
  if (b) commands.push(b);
  return { commands, deleteSlide: null, newSlides: rest.length ? { after: slide.id, slides: rest } : null };
}

/**
 * Tab / Shift+Tab on lines `[start, end)` (UTF-16 offsets) of `text`: adds
 * or removes one leading tab per touched line. Returns the new text and
 * selection.
 */
export function shiftLines(text: string, start: number, end: number, demote: boolean): { text: string; start: number; end: number } {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = text.indexOf("\n", Math.max(start, end - (end > start ? 1 : 0)));
  if (lineEnd < 0) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  let s = start;
  let e = end;
  const changed = lines.map((l, i) => {
    if (demote) {
      if (i === 0) s += 1;
      e += 1;
      return `\t${l}`;
    }
    if (!l.startsWith("\t")) return l;
    if (i === 0) s = Math.max(lineStart, s - 1);
    e = Math.max(s, e - 1);
    return l.slice(1);
  });
  return { text: text.slice(0, lineStart) + changed.join("\n") + text.slice(lineEnd), start: s, end: e };
}
