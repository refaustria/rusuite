// @mentions in threaded comments (P9-C7): typing `@` and the start of a
// name offers the document's people; picking one inserts `@Name `. The
// core records the mentions (`threadedComment/mentions`) from the text.

import type { Person } from "../generated/Person";

/** The `@query` being typed before `caret` (`start` = the `@`), `null` when none. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // The `@` starts a word, and the query has no line break and at most two spaces (first and last name).
  if (at > 0 && /[\p{L}\p{N}]/u.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query) || (query.match(/ /g) ?? []).length > 2) return null;
  return { start: at, query };
}

/** The people whose name starts (or a word of which starts) with `query`, case-insensitive, at most `max`. */
export function mentionCandidates(people: readonly Person[], query: string, max = 8): Person[] {
  const q = query.toLocaleLowerCase();
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of people) {
    const name = p.name.trim();
    if (!name || seen.has(name)) continue;
    const lower = name.toLocaleLowerCase();
    if (q === "" || lower.startsWith(q) || lower.split(/\s+/).some((w) => w.startsWith(q))) {
      seen.add(name);
      out.push(p);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** `text` with the `@query` at `start..caret` replaced by `@Name ` (and the caret after it). */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}
