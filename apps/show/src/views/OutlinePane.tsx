// View › Outline View (P8-28): the left pane shows the text outline – per
// slide its number, an icon and the title, the body paragraphs indented by
// level – editable in place. Each slide is one text field (first line =
// title, indented lines = body; see `outline.ts`); typing edits the
// placeholders through the normal text commands when the field is left,
// Enter starts a new line, Tab / Shift+Tab demote / promote the selected
// lines (a promoted body line becomes a new slide, a demoted title joins
// the previous slide).

import { useEffect, useRef, useState } from "react";
import type { NodeId } from "../generated/NodeId";
import { useShow, type ShowStore } from "../state/store";
import { outlineOf, outlineText, shiftLines } from "./outline";
import { useT } from "../i18n";

function SlideOutline({ store, id, number, text, hidden, current }: { store: ShowStore; id: NodeId; number: number; text: string; hidden: boolean; current: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState(text);
  const dirty = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!dirty.current) setDraft(text);
  }, [text]);
  // grow with the text
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
  }, [draft]);
  const commit = (value: string) => {
    if (!dirty.current) return;
    dirty.current = false;
    void store.commitOutline(id, value);
  };
  return (
    <div className={`flex gap-1 rounded px-1 py-0.5 ${current ? "bg-ui-active" : ""}`} data-testid="outline-slide" data-slide-id={id}>
      <span className={`w-5 shrink-0 pt-1 text-right text-xs text-ui-muted ${hidden ? "line-through" : ""}`}>{number}</span>
      <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12" className="mt-1.5 shrink-0 text-ui-muted">
        <rect x="0.5" y="0.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" />
      </svg>
      <textarea
        ref={ref}
        aria-label={t("show.outline.slide", { n: number })}
        data-testid="outline-text"
        rows={1}
        spellCheck
        className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm leading-6 text-ui-fg outline-none [tab-size:2em] first-line:font-semibold"
        value={draft}
        onFocus={() => {
          if (store.getState().current !== id) store.selectSlide(id);
        }}
        onChange={(e) => {
          dirty.current = true;
          setDraft(e.currentTarget.value);
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
          const el = e.currentTarget;
          const r = shiftLines(el.value, el.selectionStart, el.selectionEnd, !e.shiftKey);
          if (r.text === el.value) return;
          dirty.current = true;
          setDraft(r.text);
          // structure changes (new / joined slides) apply at once, like PowerPoint
          void store.commitOutline(id, r.text).then(() => {
            dirty.current = false;
          });
          requestAnimationFrame(() => el.setSelectionRange(r.start, r.end));
        }}
      />
    </div>
  );
}

export function OutlinePane({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  if (!pres) return <nav aria-label={t("show.view.outline")} className="w-72 shrink-0 border-r border-ui-border bg-ui-panel" />;
  const outline = outlineOf(pres);
  return (
    <nav aria-label={t("show.view.outline")} data-testid="outline-pane" className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-ui-border bg-ui-panel p-2">
      {outline.map((o, i) => (
        <SlideOutline key={o.id} store={store} id={o.id} number={i + 1} text={outlineText(o)} hidden={o.hidden} current={o.id === current} />
      ))}
    </nav>
  );
}
