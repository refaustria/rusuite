// "Edited by Anna, 2 min ago" (P11-N5b): the newest change of the page's CRDT history that touched a top-level
// block (any container inside it), read from the editor's mirror. Peers map to devices through the core's history
// (the notebook doc's peer → device records), devices to names through the member list.

import { isContainer, LoroDoc, LoroList, LoroMap, type Change } from "loro-crdt";

/** Container ids inside top-level block `index` of the page. */
export function blockContainers(doc: LoroDoc, index: number): Set<string> {
  const out = new Set<string>();
  const kids = doc.getMap("doc").get("children");
  if (!(kids instanceof LoroList)) return out;
  const block = kids.get(index);
  const walk = (v: unknown) => {
    if (!isContainer(v)) return;
    const c = v as { id: string };
    out.add(c.id);
    if (v instanceof LoroMap) for (const k of v.keys()) walk(v.get(k));
    else if (v instanceof LoroList) for (let i = 0; i < v.length; i++) walk(v.get(i));
  };
  walk(block);
  return out;
}

/** The newest change (≤ `limit` looked at) touching block `index`: its peer and time (Unix ms). */
export function lastEditorOfBlock(doc: LoroDoc, index: number, limit = 3000): { peer: string; at: number } | null {
  const ids = blockContainers(doc, index);
  if (ids.size === 0) return null;
  const changes: Change[] = [];
  for (const list of doc.getAllChanges().values()) changes.push(...list);
  changes.sort((a, b) => b.lamport - a.lamport);
  for (const c of changes.slice(0, limit)) {
    if (c.peer === "0") continue; // the shared page genesis
    const touched = doc.getChangedContainersIn({ peer: c.peer, counter: c.counter }, c.length);
    if (touched.some((id) => ids.has(id))) return { peer: c.peer, at: c.timestamp * 1000 };
  }
  return null;
}

/** "just now", "2 min ago", "3 h ago", or a date. */
export function relativeTime(at: number, now: number, t: (k: string, p?: Record<string, string | number>) => string, locale?: string): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return t("notes.lastEdit.justNow");
  if (s < 3600) return t("notes.lastEdit.minutes", { count: Math.round(s / 60) });
  if (s < 86400) return t("notes.lastEdit.hours", { count: Math.round(s / 3600) });
  return new Date(at).toLocaleDateString(locale);
}
