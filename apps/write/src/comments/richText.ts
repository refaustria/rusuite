// Formatted comment content (P9-W6): the balloon editor's document (a
// small Tiptap editor: paragraphs, bold / italic / underline / strike,
// links and @mentions) ↔ the model's comment blocks (paragraphs of runs; a
// mention is an `@Name` run in Word's `Mention` style linking to
// `mailto:` the person, as Word writes it), and the @ picker's people.

import type { JSONContent } from "@tiptap/core";
import type { Block } from "../generated/Block";
import type { Comment } from "../generated/Comment";
import type { Inline } from "../generated/Inline";
import type { Person } from "../generated/Person";
import type { Run } from "../generated/Run";

export const MENTION_STYLE = "Mention";

/** A person the @ picker offers. */
export interface MentionTarget {
  name: string;
  /** The address the mention links to (`mailto:`); the name when the account has no e-mail. */
  email: string;
}

type Mark = NonNullable<JSONContent["marks"]>[number];

/** Whether a run is an @mention (an `@…` run linking to `mailto:`). */
export function isMention(r: Run): boolean {
  return r.text.startsWith("@") && r.link?.target.kind === "email";
}

/** Comment blocks → the balloon editor's document. */
export function commentToPM(content: Block[] | undefined): JSONContent {
  const paras: JSONContent[] = [];
  for (const b of content ?? []) {
    if (b.kind !== "paragraph") continue;
    const nodes: JSONContent[] = [];
    for (const i of b.value.inlines ?? []) {
      if (i.kind === "break") {
        nodes.push({ type: "hardBreak" });
        continue;
      }
      if (i.kind !== "run" || !i.value.text) continue;
      const r = i.value;
      const marks: Mark[] = [];
      const p = r.props ?? {};
      if (p.bold) marks.push({ type: "bold" });
      if (p.italic) marks.push({ type: "italic" });
      if (p.underline && p.underline !== "none") marks.push({ type: "underline" });
      if (p.strike) marks.push({ type: "strike" });
      if (r.link) {
        const t = r.link.target;
        const href = t.kind === "url" ? t.value : t.kind === "email" ? `mailto:${t.value.address}` : `#${t.value}`;
        marks.push({ type: "link", attrs: { href, class: isMention(r) ? "comment-mention" : null } });
      }
      // Line breaks inside a run's text become hard breaks.
      r.text.split("\n").forEach((part, k) => {
        if (k > 0) nodes.push({ type: "hardBreak" });
        if (part) nodes.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
      });
    }
    paras.push(nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" });
  }
  return { type: "doc", content: paras.length ? paras : [{ type: "paragraph" }] };
}

/** The run of a text node of the balloon editor. */
function runOf(n: JSONContent): Run {
  const run: Run = { text: n.text ?? "" };
  const props: NonNullable<Run["props"]> = {};
  for (const m of n.marks ?? []) {
    if (m.type === "bold") props.bold = true;
    else if (m.type === "italic") props.italic = true;
    else if (m.type === "underline") props.underline = "single";
    else if (m.type === "strike") props.strike = true;
    else if (m.type === "link") {
      const href = String(m.attrs?.href ?? "");
      if (href.startsWith("mailto:")) {
        run.link = { target: { kind: "email", value: { address: decodeURIComponent(href.slice(7).split("?")[0]!) } } };
        if (run.text.startsWith("@")) run.style = MENTION_STYLE;
      } else if (href.startsWith("#")) run.link = { target: { kind: "bookmark", value: href.slice(1) } };
      else if (href) run.link = { target: { kind: "url", value: href } };
    }
  }
  if (Object.keys(props).length) run.props = props;
  return run;
}

const sameRun = (a: Run, b: Run) => JSON.stringify({ ...a, text: "" }) === JSON.stringify({ ...b, text: "" });

/** The balloon editor's document → comment blocks (temporary ids from `nextId`; runs of one format merged). */
export function pmToCommentBlocks(doc: JSONContent, nextId: () => number): Block[] {
  const out: Block[] = [];
  for (const p of doc.content ?? []) {
    if (p.type !== "paragraph") continue;
    const inlines: Inline[] = [];
    for (const n of p.content ?? []) {
      if (n.type === "hardBreak") {
        inlines.push({ kind: "break", value: "line" });
        continue;
      }
      if (n.type !== "text" || !n.text) continue;
      const run = runOf(n);
      const prev = inlines[inlines.length - 1];
      if (prev?.kind === "run" && sameRun(prev.value, run) && !run.style) prev.value.text += run.text;
      else inlines.push({ kind: "run", value: run });
    }
    out.push({ kind: "paragraph", value: { id: nextId(), inlines } });
  }
  // No trailing empty paragraphs (Enter before posting).
  while (out.length > 1) {
    const last = out[out.length - 1]!;
    if (last.kind === "paragraph" && !last.value.inlines.length) out.pop();
    else break;
  }
  return out.length ? out : [{ kind: "paragraph", value: { id: nextId(), inlines: [] } }];
}

/** The plain text of the balloon editor's document (paragraphs joined by `\n`). */
export function pmText(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((p) => (p.content ?? []).map((n) => (n.type === "hardBreak" ? "\n" : (n.text ?? ""))).join(""))
    .join("\n")
    .trim();
}

/** Whether the document holds formatting, links or mentions (plain text otherwise). */
export function hasFormatting(blocks: Block[]): boolean {
  return blocks.some((b) => b.kind === "paragraph" && b.value.inlines.some((i) => i.kind === "break" || (i.kind === "run" && (!!i.value.link || !!i.value.style || Object.keys(i.value.props ?? {}).length > 0))));
}

/** The query after an `@` right before the caret (`"@ann"` → `"ann"`), else null. */
export function mentionQuery(textBefore: string): string | null {
  const m = /(?:^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(textBefore);
  return m ? m[1]! : null;
}

/**
 * Who `@` offers: the document's authors (comment authors, the people of
 * `people.xml`, the document author) and the current user, once each, the
 * ones matching `query` (start of any word of the name, or of the e-mail).
 */
export function mentionCandidates(
  comments: Comment[],
  people: Person[],
  author: string | null | undefined,
  user: string | null | undefined,
  query: string,
): MentionTarget[] {
  const byName = new Map<string, MentionTarget>();
  const add = (name: string | null | undefined, email?: string | null) => {
    const n = name?.trim();
    if (!n) return;
    const key = n.toLowerCase();
    const cur = byName.get(key);
    if (cur) {
      if (email && !cur.email.includes("@")) cur.email = email;
      return;
    }
    byName.set(key, { name: n, email: email || n });
  };
  for (const p of people) add(p.author, p.userId?.includes("@") ? p.userId : null);
  for (const c of comments) add(c.author);
  add(author);
  add(user);
  const q = query.toLowerCase();
  return [...byName.values()]
    .filter((t) => !q || t.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || t.name.toLowerCase().startsWith(q) || t.email.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
