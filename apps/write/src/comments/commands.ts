// Comment operations → Rust commands (`AddComment`, `ReplyComment`, …) and
// the editor-side helpers they need: the range a new comment covers (the
// selection, or the word at the caret as in Word), positions as
// (paragraph id, char offset), and Previous / Next.

import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Block } from "../generated/Block";
import type { CommentPoint } from "../generated/CommentPoint";
import type { WriteCommand } from "../generated/WriteCommand";
import { charOffsetOf, type SyncController } from "../sync/SyncPlugin";
import { notesNode } from "../sync/fromPM";
import { nextRange, nowIso, pmRanges } from "./model";

/** A comment about to be written: its range in the editor and in the model. */
export interface CommentDraft {
  from: number;
  to: number;
  start: CommentPoint;
  end: CommentPoint;
}

/** (paragraph id, char offset) of `pos`, in a body paragraph or a note's (P9-W6: comments inside footnotes and endnotes). */
export function pointAt(state: EditorState, pos: number): CommentPoint | null {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.isTextblock) return null;
  const id = $p.parent.attrs.id as number | null;
  if (id == null || id < 0) return null;
  return { block: id, offset: charOffsetOf($p.parent, $p.parentOffset) };
}

/** The note (its id) holding `pos`, null in the body. */
export function noteOf(state: EditorState, pos: number): number | null {
  const notes = notesNode(state.doc);
  if (!notes || pos < state.doc.content.size - notes.nodeSize) return null;
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "note") return $p.node(d).attrs.id as number;
  return null;
}

const WORD = /[\p{L}\p{N}_'’-]/u;

/** The word around a collapsed selection at `pos` (Word comments the word at the caret), else the point. */
export function wordAt(state: EditorState, pos: number): [number, number] {
  const $p = state.doc.resolve(pos);
  const parent = $p.parent;
  if (!parent.isTextblock) return [pos, pos];
  const start = $p.start();
  const text = parent.textBetween(0, parent.content.size, undefined, "￼");
  // textBetween counts one char per leaf; PM positions match for text + leaves (size 1 each).
  let a = $p.parentOffset;
  let b = $p.parentOffset;
  while (a > 0 && WORD.test(text[a - 1]!)) a--;
  while (b < text.length && WORD.test(text[b]!)) b++;
  return [start + a, start + b];
}

/** The draft for a new comment on the selection (the word at the caret when it is empty), or null outside the body. */
export function draftFromSelection(state: EditorState): CommentDraft | null {
  let { from, to } = state.selection;
  if (from === to) [from, to] = wordAt(state, from);
  const start = pointAt(state, from);
  const end = pointAt(state, to);
  if (!start || !end) return null;
  // One story: both ends in the body or in the same note.
  if (noteOf(state, from) !== noteOf(state, to)) return null;
  return { from, to, start, end };
}

/** Runs `cmd` (Rust-first) and returns the ids of the comments that are new afterwards. */
async function runAndDiff(ctl: SyncController, cmd: WriteCommand): Promise<number[]> {
  const before = new Set(ctl.comments.map((c) => c.id));
  await ctl.run(cmd);
  return ctl.comments.filter((c) => !before.has(c.id)).map((c) => c.id);
}

/** `AddComment` for a draft (formatted `content` when given); the new comment's id (or null if it failed). */
export async function addComment(ctl: SyncController, draft: CommentDraft, text: string, now = Date.now(), content?: Block[]): Promise<number | null> {
  const ids = await runAndDiff(ctl, { type: "addComment", start: draft.start, end: draft.end, text, date: nowIso(now), ...(content ? { content } : {}) });
  return ids[0] ?? null;
}

export async function replyComment(ctl: SyncController, parent: number, text: string, now = Date.now(), content?: Block[]): Promise<number | null> {
  const ids = await runAndDiff(ctl, { type: "replyComment", parent, text, date: nowIso(now), ...(content ? { content } : {}) });
  return ids[0] ?? null;
}

export const editComment = (ctl: SyncController, id: number, text: string, content?: Block[]) => ctl.run({ type: "editComment", id, text, ...(content ? { content } : {}) });
export const deleteComment = (ctl: SyncController, id: number) => ctl.run({ type: "deleteComment", id });
export const deleteAllComments = (ctl: SyncController, resolvedOnly = false) => ctl.run(resolvedOnly ? { type: "deleteAllComments", resolvedOnly } : { type: "deleteAllComments" });
export const resolveComment = (ctl: SyncController, id: number, resolved: boolean) => ctl.run({ type: resolved ? "resolveComment" : "reopenComment", id });

/** Selects the start of the next / previous comment's range; returns its id. */
export function goToComment(view: EditorView, dir: 1 | -1): number | null {
  const ranges = pmRanges(view.state.doc);
  const r = nextRange(ranges, view.state.selection.from, dir);
  if (!r) return null;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, r.start + 1, r.end)).scrollIntoView();
  view.dispatch(tr);
  return r.id;
}

/** Moves the caret into comment `id`'s range (balloon click). */
export function revealComment(view: EditorView, id: number): void {
  const r = pmRanges(view.state.doc).find((x) => x.id === id);
  if (!r) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, r.start + 1)).scrollIntoView());
}
