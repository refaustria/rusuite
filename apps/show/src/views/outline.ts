// Outline View (P8-28, rich since P9-S3): the outline of the deck – each
// slide's title placeholder and the paragraphs of its body placeholder
// with their outline levels – and the commands that write an edited
// outline back. Each slide is edited as rich lines (runs keep their
// formatting): the first line is the title (depth 0), every body
// paragraph has depth level + 1. Tab / Shift+Tab demote / promote: a body
// line promoted to depth 0 starts a new slide, a demoted title joins the
// previous slide's body (the slide goes), as in PowerPoint. The plain
// tab-indented text form (`outlineText` / `textLines`) is kept for the
// assistant and tests.

import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { TextParagraph } from "../generated/TextParagraph";
import type { TextParagraphProps } from "../generated/TextParagraphProps";
import type { TextRun } from "../generated/TextRun";
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

// ----- rich outline (P9-S3) ---------------------------------------------------------------
//
// The Outline View edits each slide as rich lines: depth 0 is the title,
// depth n ≥ 1 a body paragraph of level n − 1; every line keeps its runs
// (bold, italic, colour … survive editing) and the properties of the
// paragraph it came from. The editor holds a slide's lines as a
// `TextBody` whose paragraphs carry the depth in `props.level` (so the
// text editor's `spliceBody` splits and joins them like paragraphs).

/** One line of the rich outline. */
export interface OutlineLine {
  /** 0 = the title, n = body level n − 1 (1…9). */
  depth: number;
  runs: TextRun[];
  /** Properties of the paragraph the line came from (written back with the new level). */
  props?: TextParagraphProps;
}

/** The deepest outline depth (body level 9). */
export const MAX_DEPTH = 9;

export const lineText = (l: Pick<OutlineLine, "runs">): string => l.runs.map((r) => r.text).join("");

const sameRunLook = (a: TextRun, b: TextRun) =>
  JSON.stringify(a.props ?? {}) === JSON.stringify(b.props ?? {}) && JSON.stringify(a.hyperlink ?? null) === JSON.stringify(b.hyperlink ?? null);

/** Runs without empty ones, neighbours that look the same merged (fields stay apart). */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text && !r.field) continue;
    const last = out[out.length - 1];
    if (last && !last.field && !r.field && sameRunLook(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push({ ...r });
  }
  return out;
}

/** The title's runs: its paragraphs joined by a space (with the formatting of the run before). */
function titleRuns(body: TextBody | null): TextRun[] {
  const out: TextRun[] = [];
  (body?.paragraphs ?? []).forEach((p, i) => {
    if (i > 0 && p.runs.length && out.length) {
      const prev = out[out.length - 1]!;
      out.push(prev.props ? { props: prev.props, text: " " } : { text: " " });
    }
    out.push(...p.runs);
  });
  return normalizeRuns(out);
}

/** A slide's rich outline: the title line (always) and the body paragraphs. */
export function slideLines(slide: Slide): OutlineLine[] {
  const title = slide.shapes.find(isTitle);
  const body = slide.shapes.find(isBody);
  const tb = title ? textOf(title) : null;
  const bb = body ? textOf(body) : null;
  const first: OutlineLine = { depth: 0, runs: titleRuns(tb) };
  if (tb?.paragraphs[0]?.props) first.props = tb.paragraphs[0].props;
  const paras = (bb?.paragraphs ?? []).filter((p, _i, all) => paragraphText(p) !== "" || all.length > 1);
  return [
    first,
    ...paras.map((p) => {
      const l: OutlineLine = { depth: Math.min(MAX_DEPTH, (p.props?.level ?? 0) + 1), runs: normalizeRuns(p.runs) };
      if (p.props) l.props = p.props;
      return l;
    }),
  ];
}

/** Lines as the editor's document (`props.level` = depth). */
export function linesDoc(lines: readonly OutlineLine[]): TextBody {
  return {
    props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" },
    paragraphs: (lines.length ? lines : [{ depth: 0, runs: [] }]).map((l) => ({ props: { ...(l.props ?? {}), level: l.depth }, runs: l.runs.map((r) => ({ ...r })) })),
  };
}

/** The editor's document as lines. */
export function docLines(doc: TextBody): OutlineLine[] {
  return doc.paragraphs.map((p) => {
    const { level, ...rest } = p.props ?? {};
    const l: OutlineLine = { depth: Math.max(0, Math.min(MAX_DEPTH, level ?? 0)), runs: normalizeRuns(p.runs) };
    if (Object.keys(rest).length) l.props = rest;
    return l;
  });
}

/**
 * `runs` with their text changed to `text`: the common start and end
 * keep their runs, the changed middle takes the formatting of the run
 * before it (the first run at the start).
 */
export function retextRuns(runs: readonly TextRun[], text: string): TextRun[] {
  const old = runs.map((r) => r.text).join("");
  if (old === text) return runs.map((r) => ({ ...r }));
  if (!runs.length) return text ? [{ text }] : [];
  let pre = 0;
  const max = Math.min(old.length, text.length);
  while (pre < max && old[pre] === text[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
  // the run before the change (the first run when it is at the start)
  let style: TextRun = runs[0]!;
  let at = 0;
  for (const r of runs) {
    if (at < pre) style = r;
    at += r.text.length;
  }
  const out: TextRun[] = [];
  at = 0;
  for (const r of runs) {
    if (at < pre) {
      const piece = { ...r, text: r.text.slice(0, Math.min(r.text.length, pre - at)) };
      if (piece.text !== r.text) delete piece.field;
      out.push(piece);
    }
    at += r.text.length;
  }
  const mid = text.slice(pre, text.length - suf);
  if (mid) out.push({ ...(style.props ? { props: style.props } : {}), text: mid });
  at = 0;
  const from = old.length - suf;
  for (const r of runs) {
    const end = at + r.text.length;
    if (end > from) {
      const piece = { ...r, text: r.text.slice(Math.max(0, from - at)) };
      if (piece.text !== r.text) delete piece.field;
      out.push(piece);
    }
    at = end;
  }
  return normalizeRuns(out);
}

/** Lines of the tab-indented outline text, formatting taken from `old` by position. */
export function textLines(text: string, old: readonly OutlineLine[]): OutlineLine[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  return rows.map((row, i) => {
    const tabs = /^\t*/.exec(row)![0].length;
    const content = row.slice(tabs);
    const o = old[i];
    const prev = old[Math.min(i, old.length) - 1] ?? old[0];
    const runs = o ? retextRuns(o.runs, content) : content ? [{ ...(prev?.runs[0]?.props ? { props: prev.runs[0].props } : {}), text: content }] : [];
    const l: OutlineLine = { depth: Math.min(MAX_DEPTH, tabs), runs };
    const props = o?.props ?? prev?.props;
    if (props && tabs > 0) l.props = props;
    return l;
  });
}

/** A slide of the edited lines: its title line and body lines. */
export interface RichSlide {
  title: OutlineLine;
  body: OutlineLine[];
}

/** Splits lines into slides; `joinsPrevious`: the first line is no title (it was demoted). */
export function splitSlides(lines: readonly OutlineLine[]): { slides: RichSlide[]; joinsPrevious: boolean } {
  const slides: RichSlide[] = [];
  let joinsPrevious = false;
  lines.forEach((l, i) => {
    if (l.depth === 0) {
      slides.push({ title: l, body: [] });
      return;
    }
    if (i === 0) {
      joinsPrevious = true;
      slides.push({ title: { depth: 0, runs: [] }, body: [] });
    }
    slides[slides.length - 1]!.body.push(l);
  });
  if (!slides.length) slides.push({ title: { depth: 0, runs: [] }, body: [] });
  return { slides, joinsPrevious };
}

/** A placeholder body whose paragraphs are the body `lines` (depth ≥ 1); unchanged paragraphs stay as they were. */
export function bodyFromLines(old: TextBody | null, lines: readonly OutlineLine[]): TextBody {
  const props = old?.props ?? { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" };
  const olds = old?.paragraphs ?? [];
  const list = lines.length ? lines : [{ depth: 1, runs: [] }];
  const paragraphs: TextParagraph[] = list.map((l, i) => {
    const prev = olds[i] ?? olds[olds.length - 1];
    const pp: TextParagraphProps = { ...(l.props ?? prev?.props ?? {}) };
    const level = Math.max(0, l.depth - 1);
    if (level > 0) pp.level = level;
    else delete pp.level;
    const p: TextParagraph = { runs: normalizeRuns(l.runs) };
    if (Object.keys(pp).length) p.props = pp;
    const o = olds[i];
    return o && JSON.stringify(o) === JSON.stringify(p) ? o : p;
  });
  return { props, paragraphs };
}

/** A title placeholder body holding `line` (the old body when the line is what it showed). */
export function titleFromLine(old: TextBody | null, line: OutlineLine): TextBody {
  const runs = normalizeRuns(line.runs);
  if (old && JSON.stringify(titleRuns(old)) === JSON.stringify(runs)) return old;
  const props = old?.props ?? { anchor: "bottom", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" };
  const p: TextParagraph = { runs };
  const pp = old?.paragraphs[0]?.props;
  if (pp) p.props = pp;
  return { props, paragraphs: [p] };
}

/** What committing a slide's edited rich lines does. */
export interface RichPlan {
  /** Text commands of existing slides (one undo step). */
  commands: ShowCommand[];
  /** The edited slide is removed (its title was demoted into the previous slide). */
  deleteSlide: NodeId | null;
  /** New slides to insert after `after` (promoted lines), in order. */
  newSlides: { after: NodeId; slides: RichSlide[] } | null;
}

/** The plan for the edited lines of slide `id`. */
export function linesPlan(pres: Presentation, id: NodeId, lines: readonly OutlineLine[]): RichPlan {
  const index = pres.slides.findIndex((s) => s.id === id);
  const slide = pres.slides[index];
  const none: RichPlan = { commands: [], deleteSlide: null, newSlides: null };
  if (!slide) return none;
  const { slides, joinsPrevious } = splitSlides(lines);
  const own = outlineSlide(slide);
  const commands: ShowCommand[] = [];
  let first = slides[0]!;
  let rest = slides.slice(1);
  if (joinsPrevious && index > 0) {
    const prev = pres.slides[index - 1]!;
    const po = outlineSlide(prev);
    const prevBody = slideLines(prev).slice(1);
    const c = setText(prev, po.bodyShape, (old) => bodyFromLines(old, [...prevBody, ...first.body]));
    if (c) commands.push(c);
    if (!rest.length) return { commands, deleteSlide: slide.id, newSlides: null };
    first = rest[0]!;
    rest = rest.slice(1);
  }
  const t = setText(slide, own.titleShape, (old) => titleFromLine(old, first.title));
  if (t) commands.push(t);
  const b = setText(slide, own.bodyShape, (old) => bodyFromLines(old, first.body));
  if (b) commands.push(b);
  return { commands, deleteSlide: null, newSlides: rest.length ? { after: slide.id, slides: rest } : null };
}

/** Lines `[from, to]` one level deeper (`demote`) or higher; depth stays within 0…9. */
export function shiftDepth(lines: readonly OutlineLine[], from: number, to: number, demote: boolean): OutlineLine[] {
  return lines.map((l, i) => (i < from || i > to ? l : { ...l, depth: Math.max(0, Math.min(MAX_DEPTH, l.depth + (demote ? 1 : -1))) }));
}

type ToggleKey = "bold" | "italic" | "underline";

const hasLook = (r: TextRun, key: ToggleKey) => (key === "underline" ? !!r.props?.underline && r.props.underline !== "none" : !!r.props?.[key]);

/**
 * Bold / italic / underline over the UTF-16 range `[from, to)` of the
 * document's text (paragraphs joined by `\n`): on when any run in the
 * range lacks it, else off (like PowerPoint's toggle buttons).
 */
export function toggleRange(doc: TextBody, from: number, to: number, key: ToggleKey): TextBody {
  if (to <= from) return doc;
  let at = 0;
  let allOn = true;
  const split = doc.paragraphs.map((p) => {
    const out: { run: TextRun; inside: boolean }[] = [];
    for (const r of p.runs) {
      const s = at;
      const e = at + r.text.length;
      const a = Math.max(from, s);
      const b = Math.min(to, e);
      if (b > a) {
        if (a > s) out.push({ run: { ...r, text: r.text.slice(0, a - s) }, inside: false });
        out.push({ run: { ...r, text: r.text.slice(a - s, b - s) }, inside: true });
        if (b < e) out.push({ run: { ...r, text: r.text.slice(b - s) }, inside: false });
        if (!hasLook(r, key)) allOn = false;
      } else out.push({ run: r, inside: false });
      at = e;
    }
    at += 1;
    return out;
  });
  const on = !allOn;
  return {
    ...doc,
    paragraphs: doc.paragraphs.map((p, i) => ({
      ...p,
      runs: normalizeRuns(
        split[i]!.map(({ run, inside }) => {
          if (!inside) return run;
          const props = { ...(run.props ?? {}) };
          if (key === "underline") props.underline = on ? "single" : "none";
          else props[key] = on;
          if (!on && key !== "underline") delete props[key];
          if (!on && key === "underline") delete props.underline;
          const next: TextRun = { ...run, props };
          if (!Object.keys(props).length) delete next.props;
          return next;
        }),
      ),
    })),
  };
}

/** Paragraph indexes `[first, last]` the UTF-16 range `[from, to]` of the document's text touches. */
export function linesInRange(doc: TextBody, from: number, to: number): { first: number; last: number } {
  let at = 0;
  let first = -1;
  let last = 0;
  doc.paragraphs.forEach((p, i) => {
    const len = paragraphText(p).length;
    const end = at + len;
    if (first < 0 && from <= end) first = i;
    if (to >= at) last = i;
    at = end + 1;
  });
  return { first: Math.max(0, first), last: Math.max(Math.max(0, first), last) };
}

/** Lines `[first, last]` moved one line up (`dir` −1) or down (Alt+Shift+↑ / ↓); `null` at the edge. */
export function moveLines<T>(lines: readonly T[], first: number, last: number, dir: -1 | 1): T[] | null {
  if (dir < 0 ? first <= 0 : last >= lines.length - 1) return null;
  const out = [...lines];
  const block = out.splice(first, last - first + 1);
  out.splice(first + dir, 0, ...block);
  return out;
}

/**
 * Where line `pos.paragraph` of committed `lines` went: the slide (of
 * `ids`, as `commitOutlineLines` returns them) and the line on it.
 * `prevCount`: lines of the previous slide before the commit (a demoted
 * title's lines join it after those).
 */
export function lineTarget(lines: readonly OutlineLine[], ids: readonly NodeId[], pos: { paragraph: number; offset: number }, prevCount: number): { slide: NodeId; line: number; offset: number } | null {
  const joins = (lines[0]?.depth ?? 0) > 0;
  let group = joins ? 0 : -1;
  let start = 0;
  for (let i = 0; i <= pos.paragraph && i < lines.length; i++) {
    if (lines[i]!.depth === 0) {
      group += 1;
      start = i;
    }
  }
  const slide = ids[Math.max(0, group)];
  if (slide === undefined) return null;
  const line = joins && group === 0 ? prevCount + pos.paragraph : pos.paragraph - start;
  return { slide, line, offset: pos.offset };
}
