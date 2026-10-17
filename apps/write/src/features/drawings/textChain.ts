// Linked text boxes (P9-W4, Word's Create Link): the first box of a chain
// holds the whole story in its nested editor; what does not fit flows into
// the next boxes in `seq` order. The first box is clipped after its last
// fitting line; every later box shows a read-only copy of the first box's
// text laid out at its own width, shifted so that it starts with the first
// line that did not fit before (lines are never cut). A click in a later
// box puts the caret at that place of the story (the first box's editor),
// and a caret drawn in the later box shows where typing goes. The copies
// are ordinary DOM, so print and PDF (clones of the editor) show the flow.

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { TextChain } from "../../generated/TextChain";
import { mergeLineRects } from "../layout/paginate";

/** A line of the story: its box (px from the text top) and the DOM point of its first character. */
export interface StoryLine {
  top: number;
  bottom: number;
  start: CharRef;
}

/** A character of the story: the path of child indices from the story root to its text node, and the offset. */
export interface CharRef {
  path: number[];
  offset: number;
}

/**
 * The lines that fit a box of `capacity` px when its first line is
 * `lines[from]`: the index after the last one (never fewer than one line,
 * Word puts at least one line in every box) and the visible window.
 */
export function fitLines(lines: readonly { top: number; bottom: number }[], from: number, capacity: number): { end: number; top: number; bottom: number } {
  if (from >= lines.length) return { end: from, top: 0, bottom: 0 };
  const top = lines[from]!.top;
  let end = from;
  while (end < lines.length && lines[end]!.bottom - top <= capacity + 0.5) end++;
  if (end === from) end = from + 1;
  return { end, top, bottom: lines[end - 1]!.bottom };
}

/**
 * The slices of a chain: for each box (capacities in `seq` order) the
 * range of lines it shows. Lines left after the last box are not shown
 * (Word: the overflow of the last box is hidden).
 */
export function chainSlices(lines: readonly { top: number; bottom: number }[], capacities: readonly number[]): { from: number; end: number }[] {
  const out: { from: number; end: number }[] = [];
  let from = 0;
  for (const cap of capacities) {
    if (from >= lines.length) {
      out.push({ from, end: from });
      continue;
    }
    const f = fitLines(lines, from, cap);
    out.push({ from, end: f.end });
    from = f.end;
  }
  return out;
}

/** The path of child indices from `root` to `node`. */
export function pathOf(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let n: Node | null = node;
  while (n && n !== root) {
    const parent: Node | null = n.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  return n === root ? path : null;
}

/** The node at `path` below `root`. */
export function nodeAt(root: Node, path: readonly number[]): Node | null {
  let n: Node | null = root;
  for (const i of path) n = n?.childNodes[i] ?? null;
  return n;
}

/** The lines of the text under `root` (positions relative to `root`'s top, unzoomed by `zoom`). */
export function storyLines(root: HTMLElement, zoom = 1): StoryLine[] {
  const top = root.getBoundingClientRect().top;
  const chars: { top: number; bottom: number; ref: CharRef }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = root.ownerDocument.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    const path = pathOf(root, n);
    if (!path) continue;
    for (let i = 0; i < text.length; i++) {
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getClientRects()[0];
      if (!r || r.height <= 0) continue;
      chars.push({ top: (r.top - top) / zoom, bottom: (r.bottom - top) / zoom, ref: { path, offset: i } });
    }
  }
  // Empty paragraphs are lines too (their break's box).
  for (const p of root.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li")) {
    if ((p.textContent ?? "").length) continue;
    const r = p.getBoundingClientRect();
    const path = pathOf(root, p);
    if (!path || r.height <= 0) continue;
    chars.push({ top: (r.top - top) / zoom, bottom: (r.bottom - top) / zoom, ref: { path, offset: 0 } });
  }
  chars.sort((a, b) => a.top - b.top || cmpRef(a.ref, b.ref));
  const lines = mergeLineRects(chars);
  return lines.map((l) => ({ top: l.top, bottom: l.bottom, start: chars[l.first]!.ref }));
}

const cmpRef = (a: CharRef, b: CharRef): number => {
  for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
  return a.path.length - b.path.length || a.offset - b.offset;
};

/** The index of the line holding `ref` (the last line starting at or before it). */
export function lineOf(lines: readonly StoryLine[], ref: CharRef): number {
  let k = 0;
  for (let i = 0; i < lines.length; i++) if (cmpRef(lines[i]!.start, ref) <= 0) k = i;
  return k;
}

/** One box of a chain as its node view sees it. */
export interface ChainMember {
  id: number;
  chain: TextChain;
  /** The text area (`.drawing-text`) of the box. */
  area: HTMLElement;
  /** The first box's nested editor (null for later boxes). */
  editor: Editor | null;
  /** The element the copy of the story goes into (later boxes). */
  host: HTMLElement | null;
}

const PAD = 2;

/** A chained text area never scrolls (the overflow continues in the next box). */
function keepTop(e: Event): void {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollTop) el.scrollTop = 0;
}

class Chains {
  private members = new Map<number, ChainMember>();
  private frame = 0;

  register(m: ChainMember): void {
    this.members.set(m.id, m);
    m.area.addEventListener("scroll", keepTop);
    m.editor?.on("update", this.schedule);
    m.editor?.on("selectionUpdate", this.schedule);
    m.editor?.on("blur", this.schedule);
    this.schedule();
  }

  unregister(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    m.editor?.off("update", this.schedule);
    m.editor?.off("selectionUpdate", this.schedule);
    m.editor?.off("blur", this.schedule);
    m.area.removeEventListener("scroll", keepTop);
    this.members.delete(id);
    this.schedule();
  }

  schedule = (): void => {
    if (this.frame || typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layoutAll();
    });
  };

  /** Lays every chain out now (tests and the print snapshot call it). */
  layoutAll(): void {
    const byChain = new Map<number, ChainMember[]>();
    for (const m of this.members.values()) {
      if (!m.area.isConnected) continue;
      byChain.set(m.chain.id, [...(byChain.get(m.chain.id) ?? []), m]);
    }
    for (const list of byChain.values()) layoutChain(list.sort((a, b) => a.chain.seq - b.chain.seq));
  }

  /** The first box of chain `id`. */
  head(id: number): ChainMember | null {
    for (const m of this.members.values()) if (m.chain.id === id && m.chain.seq === 0) return m;
    return null;
  }

  /** Every registered box of chain `id` in `seq` order. */
  of(id: number): ChainMember[] {
    return [...this.members.values()].filter((m) => m.chain.id === id).sort((a, b) => a.chain.seq - b.chain.seq);
  }
}

export const chains = new Chains();

const zoomOf = (el: HTMLElement) => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1);

/** The inner height (px) of a text area (its padding = the text insets). */
function capacity(area: HTMLElement): number {
  const cs = getComputedStyle(area);
  return area.clientHeight - parseFloat(cs.paddingTop || "0") - parseFloat(cs.paddingBottom || "0");
}

/** Lays one chain out (members sorted by `seq`, the first one first). */
function layoutChain(list: ChainMember[]): void {
  const head = list[0];
  const story = head?.editor?.view.dom as HTMLElement | undefined;
  if (!head || head.chain.seq !== 0 || !story) {
    for (const m of list) m.host?.replaceChildren();
    return;
  }
  story.style.clipPath = "";
  // The browser scrolls the clipped text area to the caret; the story starts at the box's top.
  head.area.scrollTop = 0;
  const z = zoomOf(head.area);
  const lines = storyLines(story, z);
  const cap0 = capacity(head.area);
  const first = fitLines(lines, 0, cap0);
  const next = first.end;
  const selection = caretRef(head.editor!, story);
  if (next < lines.length) story.style.clipPath = `inset(0 0 calc(100% - ${first.bottom + PAD}px) 0)`;
  head.area.dataset.chainOverflow = next < lines.length ? "1" : "";
  let nextRef: CharRef | null = next < lines.length ? lines[next]!.start : null;
  for (const m of list.slice(1)) {
    const host = m.host;
    if (!host) continue;
    if (!nextRef) {
      host.replaceChildren();
      continue;
    }
    const copy = story.cloneNode(true) as HTMLElement;
    copy.removeAttribute("contenteditable");
    copy.removeAttribute("data-testid");
    copy.classList.remove("ProseMirror-focused");
    copy.classList.add("chain-copy");
    copy.setAttribute("aria-hidden", "true");
    copy.style.clipPath = "";
    copy.style.marginTop = "0px";
    host.replaceChildren(copy);
    const own = storyLines(copy, zoomOf(m.area));
    const from = lineOf(own, nextRef);
    const fit = fitLines(own, from, capacity(m.area));
    copy.style.marginTop = `${-own[from]!.top}px`;
    copy.style.clipPath = `inset(${Math.max(0, own[from]!.top - PAD)}px 0 calc(100% - ${fit.bottom + PAD}px) 0)`;
    host.dataset.from = String(from);
    // The caret of the story, when it lies in this box.
    if (selection) {
      const line = lineOf(own, selection);
      if (line >= from && line < fit.end) drawCaret(host, copy, selection, own[from]!.top);
    }
    nextRef = fit.end < own.length ? own[fit.end]!.start : null;
  }
}

/** The caret of `editor` (focused, collapsed) as a character reference in `story`, or null. */
function caretRef(editor: Editor, story: HTMLElement): CharRef | null {
  if (!editor.isFocused || !editor.state.selection.empty) return null;
  try {
    const at = editor.view.domAtPos(editor.state.selection.head);
    let node: Node = at.node;
    let offset = at.offset;
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[offset] ?? node.childNodes[offset - 1];
      if (child?.nodeType === Node.TEXT_NODE) {
        node = child;
        offset = child === node.childNodes[offset] ? 0 : (child.textContent ?? "").length;
      }
    }
    const path = pathOf(story, node);
    return path ? { path, offset } : null;
  } catch {
    return null;
  }
}

/** Draws a caret in `host` at `ref` of the copy (shifted up by `shift`). */
function drawCaret(host: HTMLElement, copy: HTMLElement, ref: CharRef, shift: number): void {
  const node = nodeAt(copy, ref.path);
  if (!node) return;
  const range = copy.ownerDocument.createRange();
  const len = (node.textContent ?? "").length;
  range.setStart(node, Math.min(ref.offset, len));
  range.setEnd(node, Math.min(ref.offset, len));
  const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
  const base = copy.getBoundingClientRect();
  const z = zoomOf(host);
  const caret = copy.ownerDocument.createElement("span");
  caret.className = "chain-caret";
  caret.style.left = `${(r.left - base.left) / z}px`;
  caret.style.top = `${(r.top - base.top) / z - shift}px`;
  caret.style.height = `${Math.max(8, r.height / z)}px`;
  host.append(caret);
}

/**
 * A click in a later box of a chain: the story position under the pointer
 * (in the first box's editor), which gets the caret. Returns whether it
 * was handled.
 */
export function clickInFollower(member: ChainMember, x: number, y: number): boolean {
  const head = chains.head(member.chain.id);
  const copy = member.host?.querySelector<HTMLElement>(".chain-copy");
  const story = head?.editor?.view.dom as HTMLElement | undefined;
  if (!head?.editor || !copy || !story) return false;
  const doc = copy.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || !copy.contains(node)) {
    head.editor.commands.focus("end");
    return true;
  }
  const path = pathOf(copy, node);
  const target = path ? nodeAt(story, path) : null;
  if (!target) return false;
  try {
    const p = head.editor.view.posAtDOM(target, offset);
    const view = head.editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, p)));
    view.focus();
    return true;
  } catch {
    return false;
  }
}
