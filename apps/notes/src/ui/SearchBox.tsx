// Search at the top of the navigation pane (Ctrl+E, like OneNote): results while typing (120 ms after the last
// key) with page title, path and a snippet with the matches highlighted; scope this notebook / all notebooks.
// ↓/↑ choose, Enter opens the page and highlights the matches on it, Esc clears.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FOCUS_RING, formatCombo, RibbonIcon } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { SearchHit } from "../generated/SearchHit";
import { allPages, ancestors } from "../tree";
import { useT } from "../i18n";
import { useNotes } from "./hooks";

export const SEARCH_DEBOUNCE_MS = 120;
export const SEARCH_INPUT_ID = "notes-search";

/** `text` with `ranges` (UTF-16 `[start, end)`) as `<mark>`s. */
export function highlight(text: string, ranges: readonly (readonly [number, number])[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s < at) continue;
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={s}>{text.slice(s, e)}</mark>);
    at = e;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function SearchBox({ ctl, onActive, onNavigate }: { ctl: NotesController; onActive: (active: boolean) => void; onNavigate?: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"notebook" | "all">("all");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const notebook = useNotes(ctl, (s) => s.notebook);
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const seq = useRef(0);
  useEffect(() => {
    onActive(query.trim() !== "");
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const n = ++seq.current;
    const id = setTimeout(() => {
      void ctl.search(query, scope === "notebook" ? notebook : null).then((h) => {
        if (n !== seq.current) return;
        setHits(h);
        setCursor(0);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [ctl, query, scope, notebook, onActive]);
  const pathOf = (hit: SearchHit): string => {
    const nb = notebooks.find((n) => n.summary.id === hit.notebookId);
    if (!nb) return "";
    const page = allPages(nb.tree).find((p) => p.pageDoc === hit.docId);
    const chain = page ? ancestors(nb.tree, page.id).map((a) => a.title || t(a.kind === "page" ? "notes.untitled" : "notes.untitledSection")) : [];
    return [nb.summary.info.name, ...chain].join(" › ");
  };
  const openHit = (hit: SearchHit) => {
    void ctl.openHit(hit, query.trim());
    onNavigate?.();
  };
  return (
    <div className="flex flex-col gap-1 border-b border-ui-border p-2" data-testid="search">
      <div className="flex items-center gap-1 rounded border border-ui-border bg-ui-bg px-2 focus-within:border-[var(--notes-accent)]">
        <RibbonIcon name="find" />
        <input
          id={SEARCH_INPUT_ID}
          type="search"
          role="searchbox"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder={t("notes.search.placeholder", { key: formatCombo("Mod+E") })}
          aria-label={t("notes.search.label")}
          aria-controls="notes-search-results"
          value={query}
          data-testid="search-input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && hits?.length) {
              e.preventDefault();
              setCursor((c) => Math.min(hits.length - 1, c + 1));
            } else if (e.key === "ArrowUp" && hits?.length) {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter" && hits?.[cursor]) {
              e.preventDefault();
              openHit(hits[cursor]!);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setQuery("");
            }
          }}
        />
        <select aria-label={t("notes.search.scope")} className="h-6 max-w-28 rounded bg-transparent text-xs text-ui-muted" value={scope} data-testid="search-scope" onChange={(e) => setScope(e.target.value as "notebook" | "all")}>
          <option value="notebook">{t("notes.search.thisNotebook")}</option>
          <option value="all">{t("notes.search.allNotebooks")}</option>
        </select>
      </div>
      {hits && (
        <div id="notes-search-results" className="flex min-h-0 flex-col" data-testid="search-results">
          <p className="px-1 text-xs text-ui-muted" aria-live="polite" data-testid="search-count">
            {hits.length ? t("notes.search.results", { count: hits.length }) : t("notes.search.none")}
          </p>
          <ul role="listbox" aria-label={t("notes.search.label")} className="max-h-[60vh] overflow-auto">
            {hits.map((h, i) => (
              <li key={h.docId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-testid="search-hit"
                  className={`flex w-full flex-col rounded px-2 py-1 text-left hover:bg-ui-hover ${i === cursor ? "bg-ui-active" : ""} ${FOCUS_RING}`}
                  onClick={() => openHit(h)}
                >
                  <span className="truncate font-medium">{h.title ? highlight(h.title, h.titleRanges) : t("notes.untitled")}</span>
                  <span className="truncate text-xs text-ui-muted">{pathOf(h)}</span>
                  {h.snippet && <span className="line-clamp-2 text-xs">{highlight(h.snippet, h.ranges)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
