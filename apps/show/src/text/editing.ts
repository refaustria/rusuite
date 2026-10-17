// The in-place text editor's model (P8-45 S-01): the session keeps the
// plain text (paragraphs joined by `\n`, UTF-16 offsets like the DOM) and
// the rich body it stands for. Typing, deleting and pasting splice the
// body directly, so runs keep their formatting (the text typed takes the
// formatting of the run before the caret, like PowerPoint) and paragraphs
// split by Enter keep their level, bullet and alignment. The body goes to
// the core as one `SetTextBody` when the session ends (ADR 0008).
// Line breaks inside a paragraph (`a:br`, Shift+Enter) are U+000B in the
// session's text (the model stores `\n` in the run, which the session
// text uses between paragraphs); both count as one UTF-16 unit, so
// offsets are the same in the text and in the runs.

import type { TextBody } from "../generated/TextBody";
import type { TextParagraph } from "../generated/TextParagraph";
import type { TextRun } from "../generated/TextRun";
import { paragraphText } from "../model";

/** A line break inside a paragraph in the editor's text (Shift+Enter, `a:br`). */
export const LINE_BREAK = "\u000b";

/** The editor's text of a body: paragraphs joined by `\n`, line breaks as U+000B. */
export function editorText(body: TextBody): string {
  return body.paragraphs.map((p) => paragraphText(p).replace(/\n/g, LINE_BREAK)).join("\n");
}

/** Editor text as plain text (clipboard): line breaks become `\n`. */
export const plainOf = (text: string): string => text.replace(/\u000b/g, "\n");

/** A position in a body: paragraph index and UTF-16 offset in its text. */
export interface EditPos {
  paragraph: number;
  offset: number;
}

/** The paragraph position of the UTF-16 offset `at` of `bodyText(body)` (clamped). */
export function editPos(body: TextBody, at: number): EditPos {
  let rest = Math.max(0, at);
  for (let i = 0; i < body.paragraphs.length; i++) {
    const len = paragraphText(body.paragraphs[i]!).length;
    if (rest <= len || i === body.paragraphs.length - 1) return { paragraph: i, offset: Math.min(rest, len) };
    rest -= len + 1;
  }
  return { paragraph: 0, offset: 0 };
}

/** The UTF-16 offset of a paragraph position. */
export function editOffset(body: TextBody, pos: EditPos): number {
  let at = 0;
  for (let i = 0; i < pos.paragraph && i < body.paragraphs.length; i++) at += paragraphText(body.paragraphs[i]!).length + 1;
  return at + pos.offset;
}

const sameProps = (a: TextRun, b: TextRun) =>
  JSON.stringify(a.props ?? {}) === JSON.stringify(b.props ?? {}) && JSON.stringify(a.hyperlink ?? null) === JSON.stringify(b.hyperlink ?? null);

/**
 * The run whose formatting text typed at `pos` gets: the run before the
 * caret (at a paragraph start the first run; in an empty paragraph its
 * carried run, else the previous paragraph's last run, else the next
 * one's first). Fields are never continued; a hyperlink only inside it.
 */
export function typingRun(body: TextBody, pos: EditPos): TextRun {
  const runs = body.paragraphs[pos.paragraph]?.runs ?? [];
  let at = 0;
  let pick: TextRun | undefined;
  let inside = false;
  for (const r of runs) {
    const end = at + r.text.length;
    if (pick === undefined) pick = r;
    if (pos.offset > at && pos.offset <= end) {
      pick = r;
      inside = pos.offset < end;
      break;
    }
    if (pos.offset <= at) break;
    at = end;
  }
  if (!pick) {
    for (let i = pos.paragraph - 1; i >= 0 && !pick; i--) pick = body.paragraphs[i]!.runs[body.paragraphs[i]!.runs.length - 1];
    for (let i = pos.paragraph + 1; i < body.paragraphs.length && !pick; i++) pick = body.paragraphs[i]!.runs[0];
    inside = false;
  }
  const out: TextRun = { text: "" };
  if (pick?.props) out.props = pick.props;
  if (pick?.hyperlink && inside) out.hyperlink = pick.hyperlink;
  return out;
}

/** The runs of `p` within `[from, to)` (UTF-16); a cut field becomes plain text. */
function sliceRuns(p: TextParagraph, from: number, to: number): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const r of p.runs) {
    const end = at + r.text.length;
    const a = Math.max(from, at);
    const b = Math.min(to, end);
    if (b > a || (r.text.length === 0 && at >= from && at < to)) {
      const whole = a === at && b === end;
      const piece: TextRun = { ...r, text: r.text.slice(a - at, b - at) };
      if (!whole && piece.field) delete piece.field;
      out.push(piece);
    }
    at = end;
  }
  return out;
}

/** Appends `run` to `runs`, merged into the last run when they look the same (no fields). */
function pushRun(runs: TextRun[], run: TextRun): void {
  const last = runs[runs.length - 1];
  if (last && !last.field && !run.field && sameProps(last, run)) runs[runs.length - 1] = { ...last, text: last.text + run.text };
  else runs.push(run);
}

/** Runs without empty runs; a paragraph with no text keeps one empty run (its formatting for the next keystroke). */
function tidy(runs: TextRun[], carry: TextRun): TextRun[] {
  const out = runs.filter((r) => r.text.length > 0 || r.field);
  if (out.length) return out;
  const keep = runs.find((r) => r.props) ?? (carry.props ? carry : undefined);
  return keep ? [{ ...(keep.props ? { props: keep.props } : {}), text: "" }] : [];
}

const para = (props: TextParagraph["props"], runs: TextRun[]): TextParagraph => (props ? { props, runs } : { runs });

/**
 * Replaces the UTF-16 range `[from, to)` of `bodyText(body)` by `insert`
 * (`\n` = new paragraph). The inserted text takes `typingRun`'s
 * formatting; new paragraphs take the properties of the paragraph they
 * were split from; joined paragraphs keep the first one's.
 */
export function spliceBody(body: TextBody, from: number, to: number, insert: string): TextBody {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const a = editPos(body, lo);
  const b = editPos(body, hi);
  const pa = body.paragraphs[a.paragraph] ?? { runs: [] };
  const pb = body.paragraphs[b.paragraph] ?? { runs: [] };
  const style = typingRun(body, a);
  const head = sliceRuns(pa, 0, a.offset);
  const tail = sliceRuns(pb, b.offset, Number.MAX_SAFE_INTEGER);
  const lines = insert.replace(/\r\n?/g, "\n").split("\n");
  const ins = (text: string): TextRun => ({ ...style, text });
  const made: TextParagraph[] = [];
  lines.forEach((line, i) => {
    const runs: TextRun[] = i === 0 ? [...head] : [];
    pushRun(runs, ins(line));
    if (i === lines.length - 1) for (const r of tail) pushRun(runs, r);
    made.push(para(pa.props, tidy(runs, style)));
  });
  return { ...body, paragraphs: [...body.paragraphs.slice(0, a.paragraph), ...made, ...body.paragraphs.slice(b.paragraph + 1)] };
}

/**
 * The body as committed: the empty runs that carried formatting of empty
 * paragraphs are dropped, line breaks are stored as `\n` (as the reader
 * stores `a:br`).
 */
export function cleanBody(body: TextBody): TextBody {
  const breaks = (r: TextRun): TextRun => (r.text.includes(LINE_BREAK) ? { ...r, text: r.text.replace(/\u000b/g, "\n") } : r);
  return {
    ...body,
    paragraphs: body.paragraphs.map((p) => (p.runs.length > 0 && p.runs.every((r) => r.text === "" && !r.field) ? { ...p, runs: [] } : p.runs.some((r) => r.text.includes(LINE_BREAK)) ? { ...p, runs: p.runs.map(breaks) } : p)),
  };
}

/**
 * The single edit turning `before` into `after`: the range of `before`
 * replaced and its replacement. `caret` (the caret in `after`) decides
 * where an ambiguous edit happened ("aa" → "aaa").
 */
export function textDiff(before: string, after: string, caret = after.length): { from: number; to: number; insert: string } {
  let pre = 0;
  const max = Math.min(before.length, after.length);
  while (pre < max && before[pre] === after[pre]) pre++;
  // the edit ends at the caret at the latest
  const growth = after.length - before.length;
  pre = Math.min(pre, Math.max(0, caret - Math.max(0, growth)));
  let suf = 0;
  while (suf < max - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  return { from: pre, to: before.length - suf, insert: after.slice(pre, after.length - suf) };
}

/** The UTF-16 offset one character (code point) before / after `at` in `text`. */
export function charStep(text: string, at: number, dir: 1 | -1): number {
  if (dir < 0) {
    if (at <= 0) return 0;
    const c = text.charCodeAt(at - 1);
    return at >= 2 && c >= 0xdc00 && c <= 0xdfff ? at - 2 : at - 1;
  }
  if (at >= text.length) return text.length;
  const c = text.charCodeAt(at);
  return c >= 0xd800 && c <= 0xdbff && at + 1 < text.length ? at + 2 : at + 1;
}
