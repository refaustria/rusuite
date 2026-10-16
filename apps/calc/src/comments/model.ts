// Notes, threaded comments and hyperlinks (P8-26): pure helpers for the
// grid indicators, the note box geometry, rich note text, navigation
// between annotations and following links.

import type { CellView } from "../generated/CellView";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { NameInfo } from "../generated/NameInfo";
import type { Note } from "../generated/Note";
import type { NoteBounds } from "../generated/NoteBounds";
import type { NoteRun } from "../generated/NoteRun";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { SheetInfo } from "../generated/SheetInfo";
import type { Thread } from "../generated/Thread";
import type { AxisGeometry } from "../grid/geometry";
import { goToTarget, type GoToTarget } from "../names/names";

/** Excel's default note box (points, from the cell's top-right corner): 128 × 74 px, 15 px right, 10 px up. */
export const DEFAULT_NOTE_BOUNDS: NoteBounds = { x: 11.25, y: -7.5, w: 96, h: 55.5 };

/** Indicator colours: red note triangle, purple comment marker. */
export const NOTE_RED = "#d0021b";
export const COMMENT_PURPLE = "#7719aa";

const PT_PX = 4 / 3;

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cell as a `row:col` key. */
export const cellKey = (row: number, col: number) => `${row}:${col}`;

// --- indicators ---------------------------------------------------------------------------------

/** One indicator to draw: the cell's top-right corner (sheet px) and its kind. */
export interface Indicator {
  row: number;
  col: number;
  /** Right edge and top edge of the cell, sheet px. */
  x: number;
  y: number;
  kind: "note" | "comment" | "resolved";
}

/**
 * The indicators of the cells in `rows × cols` (sheet px corners): a red
 * triangle for a note, a purple marker for a thread (outlined when
 * resolved). A cell with both shows the comment's marker, as Excel does.
 */
export function indicators(
  cells: Map<number, Map<number, CellView>>, colGeo: AxisGeometry, rowGeo: AxisGeometry,
  rows: [number, number], cols: [number, number],
): Indicator[] {
  const out: Indicator[] = [];
  for (const [r, row] of cells) {
    if (r < rows[0] || r > rows[1]) continue;
    for (const [c, cell] of row) {
      if (c < cols[0] || c > cols[1] || (!cell.note && !cell.comment)) continue;
      const kind = cell.comment === "resolved" ? "resolved" : cell.comment === "open" ? "comment" : "note";
      out.push({ row: r, col: c, x: colGeo.offset(c + 1), y: rowGeo.offset(r), kind });
    }
  }
  return out;
}

/** Draws indicators (canvas, sheet px shifted by the viewport scroll). */
export function drawIndicators(ctx: CanvasRenderingContext2D, list: Indicator[], scrollX: number, scrollY: number): void {
  for (const i of list) {
    const x = i.x - scrollX;
    const y = i.y - scrollY;
    ctx.beginPath();
    if (i.kind === "note") {
      // Excel's 6 px red triangle in the corner.
      ctx.moveTo(x - 6, y + 1);
      ctx.lineTo(x - 1, y + 1);
      ctx.lineTo(x - 1, y + 6);
      ctx.closePath();
      ctx.fillStyle = NOTE_RED;
      ctx.fill();
    } else {
      // The comment marker: a small speech bubble below the selection border.
      ctx.rect(x - 9.5, y + 2.5, 7, 5.5);
      ctx.moveTo(x - 8, y + 8);
      ctx.lineTo(x - 9, y + 10);
      ctx.lineTo(x - 5.5, y + 8);
      if (i.kind === "comment") {
        ctx.fillStyle = COMMENT_PURPLE;
        ctx.fill();
      } else {
        ctx.strokeStyle = COMMENT_PURPLE;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}

// --- note boxes -----------------------------------------------------------------------------------

/** The note's box in sheet px: its bounds (or the default) from the cell's top-right corner. */
export function noteBoxRect(note: Pick<Note, "row" | "col" | "bounds">, colGeo: AxisGeometry, rowGeo: AxisGeometry): PxRect {
  const b = note.bounds ?? DEFAULT_NOTE_BOUNDS;
  const cx = colGeo.offset(note.col + 1);
  const cy = rowGeo.offset(note.row);
  return { x: Math.max(0, cx + b.x * PT_PX), y: Math.max(0, cy + b.y * PT_PX), w: Math.max(8, b.w * PT_PX), h: Math.max(8, b.h * PT_PX) };
}

/** The bounds (points, from the cell's top-right corner) of a box at sheet px `r`. */
export function boundsFromRect(note: Pick<Note, "row" | "col">, r: PxRect, colGeo: AxisGeometry, rowGeo: AxisGeometry): NoteBounds {
  const cx = colGeo.offset(note.col + 1);
  const cy = rowGeo.offset(note.row);
  const pt = (px: number) => Math.round((px / PT_PX) * 4) / 4;
  return { x: pt(r.x - cx), y: pt(r.y - cy), w: Math.max(6, pt(r.w)), h: Math.max(6, pt(r.h)) };
}

/** The connector from the cell's top-right corner to the nearest point of the box (sheet px). */
export function connector(note: Pick<Note, "row" | "col">, box: PxRect, colGeo: AxisGeometry, rowGeo: AxisGeometry): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = colGeo.offset(note.col + 1);
  const y1 = rowGeo.offset(note.row);
  const x2 = Math.min(Math.max(x1, box.x), box.x + box.w);
  const y2 = Math.min(Math.max(y1, box.y), box.y + box.h);
  return { x1, y1, x2, y2 };
}

export type BoxHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** `r` moved by `(dx, dy)` (clamped to the sheet's top-left). */
export function moveBox(r: PxRect, dx: number, dy: number): PxRect {
  return { ...r, x: Math.max(0, r.x + dx), y: Math.max(0, r.y + dy) };
}

/** `r` resized at `handle` by `(dx, dy)`; at least 20 × 16 px. */
export function resizeBox(r: PxRect, handle: BoxHandle, dx: number, dy: number): PxRect {
  let { x, y, w, h } = r;
  if (handle.includes("e")) w += dx;
  if (handle.includes("s")) h += dy;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (w < 20) {
    if (handle.includes("w")) x -= 20 - w;
    w = 20;
  }
  if (h < 16) {
    if (handle.includes("n")) y -= 16 - h;
    h = 16;
  }
  return { x, y, w, h };
}

// --- rich text ----------------------------------------------------------------------------------

/** The text of runs. */
export function runsText(runs: readonly NoteRun[]): string {
  return runs.map((r) => r.text).join("");
}

const sameFont = (a?: RunProperties, b?: RunProperties) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Merges adjacent runs with the same font, drops empty ones. */
export function normalizeRuns(runs: readonly NoteRun[]): NoteRun[] {
  const out: NoteRun[] = [];
  for (const r of runs) {
    if (r.text === "") continue;
    const last = out[out.length - 1];
    if (last && sameFont(last.font, r.font)) last.text += r.text;
    else out.push(r.font && Object.keys(r.font).length ? { text: r.text, font: { ...r.font } } : { text: r.text });
  }
  return out;
}

/** The font patch `props` applied to characters `start..end` of the runs (the whole text when `start === end`). */
export function formatRuns(runs: readonly NoteRun[], start: number, end: number, props: RunProperties): NoteRun[] {
  const total = runsText(runs).length;
  const [a, b] = start === end ? [0, total] : [Math.min(start, end), Math.max(start, end)];
  const out: NoteRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const s = pos;
    const e = pos + r.text.length;
    pos = e;
    const cut = (from: number, to: number, apply: boolean) => {
      if (to <= from) return;
      const text = r.text.slice(from - s, to - s);
      const font = apply ? clean({ ...(r.font ?? {}), ...props }) : r.font;
      out.push(font && Object.keys(font).length ? { text, font } : { text });
    };
    cut(s, Math.max(s, Math.min(e, a)), false);
    cut(Math.max(s, a), Math.min(e, b), true);
    cut(Math.min(e, Math.max(s, b)), e, false);
  }
  return normalizeRuns(out);
}

/** Drops `false`/`undefined` toggles so that un-bolding goes back to the note font. */
function clean(f: RunProperties): RunProperties {
  const out: RunProperties = { ...f };
  for (const k of ["bold", "italic", "strike"] as const) if (out[k] === false) delete out[k];
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === null) delete (out as Record<string, unknown>)[k];
  return out;
}

/** Whether every character of `start..end` (all text when empty) has `prop` on. */
export function runsHave(runs: readonly NoteRun[], start: number, end: number, prop: "bold" | "italic"): boolean {
  const total = runsText(runs).length;
  const [a, b] = start === end ? [0, total] : [Math.min(start, end), Math.max(start, end)];
  let pos = 0;
  let any = false;
  for (const r of runs) {
    const s = pos;
    pos += r.text.length;
    if (pos <= a || s >= b) continue;
    any = true;
    if (!r.font?.[prop]) return false;
  }
  return any;
}

/** A new note's text: Excel starts it with the author's name in bold. */
export function newNoteRuns(author: string): NoteRun[] {
  return author ? [{ text: `${author}:`, font: { bold: true } }, { text: "\n" }] : [];
}

// --- threads -------------------------------------------------------------------------------------

/** `"Ann Lee"` → `"AL"`. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (w: string) => w[0]!.toUpperCase();
  return words.length === 1 ? first(words[0]!) : first(words[0]!) + first(words[words.length - 1]!);
}

/** An ISO date as written by Excel (`2026-10-16T09:30:00.00`, local time). */
export function isoNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.00`;
}

/** A thread's date for display (`""` when unparsable). */
export function formatDate(iso: string, locale?: string): string {
  const d = new Date(iso.replace(/\.(\d\d)$/, ".$10"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Annotations in Excel's Next/Previous order: by row, then column. */
export function sortedCells<T extends { row: number; col: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** The next (`dir` 1) or previous (-1) annotated cell after `from`, wrapping around; `null` without any. */
export function stepCell<T extends { row: number; col: number }>(list: readonly T[], from: { row: number; col: number }, dir: 1 | -1): T | null {
  const s = sortedCells(list);
  if (s.length === 0) return null;
  const cmp = (a: { row: number; col: number }) => a.row - from.row || a.col - from.col;
  if (dir === 1) return s.find((x) => cmp(x) > 0) ?? s[0]!;
  return [...s].reverse().find((x) => cmp(x) < 0) ?? s[s.length - 1]!;
}

/** Excel's pane order: threads of the sheet by cell, open ones first when `openFirst`. */
export function paneThreads(threads: readonly Thread[], filter: "all" | "open" | "resolved"): Thread[] {
  return sortedCells(threads).filter((t) => filter === "all" || (filter === "open" ? !t.resolved : !!t.resolved));
}

// --- hyperlinks ----------------------------------------------------------------------------------

/** The link covering a cell. */
export function linkAt(links: readonly Hyperlink[], row: number, col: number): Hyperlink | undefined {
  return links.find((h) => row >= h.r0 && row <= h.r1 && col >= h.c0 && col <= h.c1);
}

/** The external URL of a target (`mailto:` with an encoded subject), `null` for a place in the workbook. */
export function linkHref(t: LinkTarget): string | null {
  switch (t.kind) {
    case "url":
      return t.url;
    case "email":
      return `mailto:${t.address}${t.subject ? `?subject=${encodeURIComponent(t.subject)}` : ""}`;
    case "location":
      return null;
  }
}

/** Whether an external URL may be followed (no `javascript:` / `data:` URLs). */
export function safeHref(href: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())?.[1]?.toLowerCase();
  return scheme === undefined || ["http", "https", "mailto", "ftp", "file", "tel"].includes(scheme);
}

/** A URL typed in the Link dialog: `www.x.at` → `http://www.x.at` (as Excel does); empty stays empty. */
export function normalizeUrl(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^www\./i.test(t)) return `http://${t}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  return t;
}

/** What following a link does: open an external URL, or go to a place in the workbook (`null`: nowhere). */
export type FollowAction = { kind: "external"; href: string } | ({ kind: "internal" } & GoToTarget);

export function followAction(t: LinkTarget, names: readonly NameInfo[], sheets: readonly SheetInfo[], activeSheet: number): FollowAction | null {
  if (t.kind === "location") {
    const target = goToTarget(t.location, names, sheets, activeSheet);
    return target ? { kind: "internal", ...target } : null;
  }
  const href = linkHref(t)!;
  return safeHref(href) ? { kind: "external", href } : null;
}

/** The text a link shows when Text to Display is left empty. */
export function defaultLinkText(t: LinkTarget): string {
  switch (t.kind) {
    case "url":
      return t.url;
    case "email":
      return `mailto:${t.address}`;
    case "location":
      return t.location;
  }
}

/** Opens an external link with a real anchor element (no `window.open`, mobile guardrail 4). */
export function openExternal(href: string, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  a.remove();
}
