// Comments as the UI needs them: threads (a root and its replies) in the
// order of their anchors, pane filters, author colours and initials,
// relative dates and the balloon layout that keeps balloons next to
// their text without overlapping.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Comment } from "../generated/Comment";
import { formatDate } from "@rusuite/ui-shared";
import { t } from "../i18n";

export interface Thread {
  root: Comment;
  replies: Comment[];
}

export type CommentFilter = "all" | "open" | "resolved";

/** The plain text of a comment (paragraphs joined by `\n`). */
export function commentText(c: Comment): string {
  return (c.content ?? []).flatMap((b) => (b.kind === "paragraph" ? [b.value.inlines.map((i) => (i.kind === "run" ? i.value.text : "")).join("")] : [])).join("\n");
}

/** Threads in the order of `order` (root ids by anchor position), unanchored ones last. */
export function threads(comments: Comment[], order: number[] = []): Thread[] {
  const byRoot = new Map<number, Thread>();
  for (const c of comments) if (c.parent == null) byRoot.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.parent != null) byRoot.get(c.parent)?.replies.push(c);
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...byRoot.values()].sort((a, b) => (rank.get(a.root.id) ?? 1e9) - (rank.get(b.root.id) ?? 1e9) || a.root.id - b.root.id);
}

/** The threads a pane filter shows. */
export function filterThreads(list: Thread[], filter: CommentFilter): Thread[] {
  if (filter === "all") return list;
  return list.filter((th) => (filter === "resolved") === !!th.root.resolved);
}

/** The root of `id`'s thread. */
export function rootOf(comments: Comment[], id: number): number {
  return comments.find((c) => c.id === id)?.parent ?? id;
}

/** Word's initials: the first letter of up to three words. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");
}

/** Light author colours (highlight), with a darker variant for the selected comment and the avatar. */
export const AUTHOR_COLORS: { light: string; dark: string }[] = [
  { light: "#fde68a", dark: "#d97706" },
  { light: "#bfdbfe", dark: "#2563eb" },
  { light: "#bbf7d0", dark: "#16a34a" },
  { light: "#fbcfe8", dark: "#db2777" },
  { light: "#ddd6fe", dark: "#7c3aed" },
  { light: "#fed7aa", dark: "#ea580c" },
  { light: "#a5f3fc", dark: "#0891b2" },
  { light: "#e5e7eb", dark: "#4b5563" },
];

/** A stable colour index for an author name. */
export function authorColor(author: string): { light: string; dark: string } {
  let h = 0;
  for (const ch of author.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length]!;
}

/** "just now", "5 min ago", "3 h ago", else the date (and time today/yesterday aside). */
export function relativeDate(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("write.comments.justNow");
  if (min < 60) return t("write.comments.minutesAgo", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("write.comments.hoursAgo", { count: h });
  const d = new Date(ms);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return formatDate(d, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** The full date and time (tooltips). */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : formatDate(new Date(ms), { dateStyle: "medium", timeStyle: "short" });
}

/** The current time as written to comments (ISO 8601, UTC, seconds). */
export function nowIso(now: number = Date.now()): string {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ----- ranges in the editor document ---------------------------------------------

export interface PmRange {
  id: number;
  /** Position of the start marker. */
  start: number;
  /** Position of the end marker. */
  end: number;
}

type Mark = [start: boolean, id: number, offset: number];
/** Markers of one top-level node (offsets inside it), cached per (immutable) node: an edit re-scans one block. */
const markCache = new WeakMap<PMNode, Mark[]>();
function marksOf(node: PMNode): Mark[] {
  let m = markCache.get(node);
  if (!m) {
    const out: Mark[] = [];
    node.descendants((n, pos) => {
      if (n.type.name === "commentStart") out.push([true, n.attrs.id as number, pos + 1]);
      else if (n.type.name === "commentEnd") out.push([false, n.attrs.id as number, pos + 1]);
      return true;
    });
    markCache.set(node, (m = out));
  }
  return m;
}

/** Every comment range of a ProseMirror document (start marker before its end), in start order. */
export function pmRanges(doc: PMNode): PmRange[] {
  const starts = new Map<number, number>();
  const done = new Set<number>();
  const out: PmRange[] = [];
  doc.forEach((child, offset) => {
    for (const [start, id, at] of marksOf(child)) {
      const pos = offset + at;
      if (start) {
        if (!starts.has(id)) starts.set(id, pos);
      } else if (!done.has(id) && starts.has(id)) {
        done.add(id);
        out.push({ id, start: starts.get(id)!, end: pos });
      }
    }
  });
  return out.sort((a, b) => a.start - b.start || a.id - b.id);
}

/** The innermost range containing `pos` (between its markers), else null. */
export function rangeAt(ranges: PmRange[], pos: number): PmRange | null {
  let best: PmRange | null = null;
  for (const r of ranges) {
    if (r.start < pos && pos <= r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
  }
  return best;
}

/** The next (`dir` 1) or previous (-1) range relative to `pos`, wrapping around. */
export function nextRange(ranges: PmRange[], pos: number, dir: 1 | -1): PmRange | null {
  if (!ranges.length) return null;
  if (dir > 0) return ranges.find((r) => r.start >= pos) ?? ranges[0]!;
  const before = ranges.filter((r) => r.start < pos - 1);
  return before[before.length - 1] ?? ranges[ranges.length - 1]!;
}

// ----- balloon layout ------------------------------------------------------------

export interface BalloonBox {
  id: number;
  /** Where the balloon wants to be (its anchor's top). */
  anchor: number;
  height: number;
}

/**
 * Word's margin layout: balloons in anchor order, each at its anchor
 * unless that would overlap the one before (then just below it). The
 * active balloon sits exactly at its anchor; the ones above it move up as
 * far as needed (never above `top`), the ones below move down.
 */
export function layoutBalloons(boxes: BalloonBox[], gap = 8, active: number | null = null, top = 0, pageGaps: [number, number][] = []): Map<number, number> {
  const tops = stackBalloons(boxes, gap, active, top);
  if (!pageGaps.length) return tops;
  return avoidPageGaps(boxes, tops, gap, pageGaps);
}

/**
 * Print layout (P9-W6): no balloon sits in a page gap or crosses a page
 * bottom — Word's markup area is per page. In anchor order, a balloon that
 * would overlap a gap `[gapTop, gapBottom)` moves to the top of the next
 * page (below the gap) and pushes the following ones down.
 */
export function avoidPageGaps(boxes: BalloonBox[], tops: Map<number, number>, gap: number, pageGaps: [number, number][]): Map<number, number> {
  const sorted = [...boxes].sort((a, b) => (tops.get(a.id) ?? a.anchor) - (tops.get(b.id) ?? b.anchor) || a.id - b.id);
  const gaps = [...pageGaps].sort((a, b) => a[0] - b[0]);
  const out = new Map<number, number>();
  let floor = -Infinity;
  for (const b of sorted) {
    let y = Math.max(tops.get(b.id) ?? b.anchor, floor);
    // Gaps are sorted and y only grows: one pass moves it below every gap it would overlap.
    for (const [g0, g1] of gaps) if (y < g1 && y + b.height > g0) y = g1 + gap;
    out.set(b.id, y);
    floor = y + b.height + gap;
  }
  return out;
}

function stackBalloons(boxes: BalloonBox[], gap: number, active: number | null, top: number): Map<number, number> {
  const sorted = [...boxes].sort((a, b) => a.anchor - b.anchor || a.id - b.id);
  const tops = sorted.map((b) => Math.max(top, b.anchor));
  const k = active == null ? -1 : sorted.findIndex((b) => b.id === active);
  if (k < 0) {
    for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + sorted[i - 1]!.height + gap);
  } else {
    for (let i = k + 1; i < sorted.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + sorted[i - 1]!.height + gap);
    for (let i = k - 1; i >= 0; i--) tops[i] = Math.min(tops[i]!, tops[i + 1]! - gap - sorted[i]!.height);
    // Pushed above the top: everything moves down again, in order.
    if (tops[0]! < top) {
      tops[0] = top;
      for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + sorted[i - 1]!.height + gap);
    }
  }
  return new Map(sorted.map((b, i) => [b.id, tops[i]!]));
}

// ----- remembered user (ADR 0009: kept in this browser / app only) ----------------

const USER_KEY = "rusuite.write.user";

export interface CommentUser {
  name: string;
  initials: string;
}

export function loadUser(): CommentUser | null {
  try {
    const raw = globalThis.localStorage?.getItem(USER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CommentUser>;
    return typeof v.name === "string" && v.name.trim() ? { name: v.name.trim(), initials: typeof v.initials === "string" ? v.initials : "" } : null;
  } catch {
    return null;
  }
}

export function saveUser(user: CommentUser | null): void {
  try {
    if (user) globalThis.localStorage?.setItem(USER_KEY, JSON.stringify(user));
    else globalThis.localStorage?.removeItem(USER_KEY);
  } catch {
    // Storage unavailable (private mode): the name lasts for this session.
  }
}
