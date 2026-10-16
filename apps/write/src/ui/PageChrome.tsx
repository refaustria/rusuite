// The print layout's page chrome (P8-31): one absolutely positioned layer
// over the page frame drawing, for the pages near the viewport, the white
// margins (covering whatever the page gaps of the text flow show there),
// headers and footers (greyed, double-click edits them), the grey gap
// between sheets ("Page N" on hover, double-click hides / shows the white
// space), the footnote separator and continued footnotes, repeated table
// header rows and column rules. The text and the footnotes on their own
// page are the editor's (features/pagination.ts places them).

import { memo, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { PageLayout, SheetView } from "../features/pagination";
import { useT } from "../i18n";

/** Pages rendered beyond the visible ones (each side). */
const OVERSCAN = 2;

export interface PageChromeProps {
  layout: PageLayout;
  editor: Editor | null;
  onEditHeaderFooter: (which: "header" | "footer") => void;
  onToggleWhiteSpace: () => void;
}

/** The sheets intersecting frame px `[top, bottom)` (binary search; sheets are sorted). */
export function visibleSheets(sheets: readonly SheetView[], top: number, bottom: number, overscan = OVERSCAN): [number, number] {
  let lo = 0;
  let hi = sheets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const s = sheets[mid]!;
    if (s.top + s.height < top) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < sheets.length && sheets[end]!.top < bottom) end++;
  return [Math.max(0, lo - overscan), Math.min(sheets.length, end + overscan)];
}

/** The rendered frame px range of the scroll container's viewport. */
function useVisibleRange(ref: React.RefObject<HTMLDivElement | null>, layout: PageLayout): [number, number] {
  const [range, setRange] = useState<[number, number]>(() => visibleSheets(layout.sheets, 0, 1200));
  useEffect(() => {
    const el = ref.current;
    const scroller = el?.closest(".write-scroll") as HTMLElement | null;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const z = el.offsetWidth > 0 ? r.width / el.offsetWidth || 1 : 1;
      const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const next = visibleSheets(layout.sheets, (view.top - r.top) / z, (view.bottom - r.top) / z);
      setRange((cur) => (cur[0] === next[0] && cur[1] === next[1] ? cur : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, layout]);
  return range;
}

/** The HTML of a note's element (a continued footnote), without the editor's placement. */
function noteHtml(editor: Editor | null, id: number): string {
  const el = editor?.view.dom.querySelector<HTMLElement>(`.note[data-note-id="${id}"]`);
  if (!el) return "";
  const c = el.cloneNode(true) as HTMLElement;
  c.removeAttribute("style");
  c.classList.remove("note-paged");
  c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
  return c.outerHTML;
}

/** A clone of a table's header rows at a page top: HTML and the table's left / width (frame px). */
function tableHeader(editor: Editor | null, pos: number, frame: HTMLElement | null): { html: string; left: number; width: number } | null {
  if (!editor || !frame) return null;
  let el: HTMLElement | null = null;
  try {
    el = editor.view.nodeDOM(pos) as HTMLElement | null;
  } catch {
    el = null;
  }
  const table = el?.matches?.("table") ? el : el?.querySelector?.("table");
  if (!table) return null;
  const fr = frame.getBoundingClientRect();
  const z = frame.offsetWidth > 0 ? fr.width / frame.offsetWidth || 1 : 1;
  const r = table.getBoundingClientRect();
  const c = table.cloneNode(true) as HTMLElement;
  c.querySelectorAll(".page-spacer, .page-colbreak").forEach((e) => e.remove());
  c.querySelectorAll("tr:not([data-header])").forEach((e) => e.remove());
  c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
  c.style.margin = "0";
  c.style.width = `${r.width / z}px`;
  return { html: c.outerHTML, left: (r.left - fr.left) / z, width: r.width / z };
}

const Sheet = memo(function Sheet({ s, last, layout, editor, frame, onEditHeaderFooter, onToggleWhiteSpace }: {
  s: SheetView;
  last: boolean;
  layout: PageLayout;
  editor: Editor | null;
  frame: HTMLElement | null;
  onEditHeaderFooter: (which: "header" | "footer") => void;
  onToggleWhiteSpace: () => void;
}) {
  const t = useT();
  const g = s.geo;
  const side = { left: g.left, right: g.right };
  const bottomEnd = s.top + s.height;
  const hf = (which: "header" | "footer", text: string, style: React.CSSProperties) =>
    layout.hide ? null : (
      <div
        className={`page-hf page-${which}`}
        data-testid={s.index === 0 && which === "header" ? "page-header" : last && which === "footer" ? "page-footer" : undefined}
        data-hf={which}
        data-page={s.index + 1}
        style={{ ...side, ...style }}
        title={t(`write.hfTip.${which}`)}
        onDoubleClick={(e) => {
          e.preventDefault();
          onEditHeaderFooter(which);
        }}
      >
        {text}
      </div>
    );
  const repeat = s.repeat ? tableHeader(editor, s.repeat.pos, frame) : null;
  return (
    <>
      <div className="page-cover" style={{ top: s.top, height: Math.max(0, s.bodyTop - s.top) }}>
        {hf("header", s.header, { top: g.header })}
      </div>
      {s.contentEnd < s.notesTop - 0.5 && <div className="page-cover page-fill" style={{ top: s.contentEnd, height: s.notesTop - s.contentEnd }} />}
      {s.notes.length > 0 && (
        <div
          className={`page-note-sep${s.notes[0]!.from > 0 ? " page-note-sep-cont" : ""}`}
          data-testid="page-note-separator"
          data-page={s.index + 1}
          style={{ top: s.notesTop + 5, left: g.left, ...(s.notes[0]!.from > 0 ? { right: g.right } : {}) }}
        />
      )}
      {s.notes
        .filter((n) => n.from > 0)
        .map((n) => (
          <div key={`c${n.id}`} className="page-note-cont tiptap-content" style={{ top: n.top, left: g.left, right: g.right, height: n.to - n.from }}>
            <div style={{ marginTop: -n.from }} dangerouslySetInnerHTML={{ __html: noteHtml(editor, n.id) }} />
          </div>
        ))}
      {repeat && s.repeat && (
        <div className="page-repeat tiptap-content" data-testid="page-repeat-header" style={{ top: s.repeat.top, left: repeat.left, width: repeat.width, height: s.repeat.height }} dangerouslySetInnerHTML={{ __html: repeat.html }} />
      )}
      {(s.rules ?? []).map((r, i) =>
        r.xs.map((x, j) => <div key={`r${i}:${j}`} className="page-column-rule" style={{ top: r.top, height: r.height, left: g.left + x }} />),
      )}
      <div className="page-cover" style={{ top: s.bodyBottom, height: Math.max(0, bottomEnd - s.bodyBottom) }}>
        {hf("footer", s.footer, { bottom: g.footer })}
      </div>
      {!last && (
        <div
          className={`page-gap${layout.hide ? " page-gap-hidden" : ""}`}
          data-page={s.index + 2}
          style={{ top: bottomEnd, height: layout.gap }}
          title={t(layout.hide ? "write.page.showWhiteSpace" : "write.page.hideWhiteSpace", { n: s.index + 2 })}
          onDoubleClick={(e) => {
            e.preventDefault();
            onToggleWhiteSpace();
          }}
        >
          <span className="page-gap-label">{t("write.page.label", { n: s.index + 2 })}</span>
        </div>
      )}
    </>
  );
});

export function PageChrome({ layout, editor, onEditHeaderFooter, onToggleWhiteSpace }: PageChromeProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [from, to] = useVisibleRange(ref, layout);
  const n = layout.sheets.length;
  return (
    <div
      className="page-chrome"
      ref={ref}
      aria-hidden="true"
      data-testid="page-chrome"
      data-pages={n}
      // The body box of every sheet (frame px), for tests and tools: "top,bottom;top,bottom…".
      data-bodies={layout.sheets.map((s) => `${Math.round(s.bodyTop)},${Math.round(s.bodyBottom)}`).join(";")}
      style={{ height: layout.height }}
    >
      {layout.sheets.slice(from, to).map((s) => (
        <Sheet
          key={s.index}
          s={s}
          last={s.index === n - 1}
          layout={layout}
          editor={editor}
          frame={ref.current?.parentElement ?? null}
          onEditHeaderFooter={onEditHeaderFooter}
          onToggleWhiteSpace={onToggleWhiteSpace}
        />
      ))}
    </div>
  );
}
