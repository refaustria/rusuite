// The sheet the editor sits on. Print layout: page size and margins from
// the `PageSetup`; once the pagination has laid the pages out, the frame is
// as tall as all sheets and the page chrome (`PageChrome`) draws margins,
// headers, footers and gaps. Draft: one long sheet.

import type { NoteSeparators } from "../generated/NoteSeparators";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { PageChrome } from "./PageChrome";
import type { PageSetup } from "../generated/PageSetup";
import type { Section } from "../generated/Section";
import { sectionFrames } from "../features/layout/sectionFrames";
import { sheetLeft } from "./PageChrome";
import { headerFooterText, pageGeometry, type PageLayout } from "../features/pagination";
import type { WriteFeatures, WriteView } from "../features/WriteFeatures";
import { useT } from "../i18n";

/**
 * App glue: view mode and page count for the frame, the find bar and
 * header/footer openers, and the spell check attribute (re-applied when
 * the View › Spelling toggle changes).
 */
export function useWriteChrome(features: WriteFeatures, editor: Editor | null) {
  const ui = features.ui;
  const view = useSyncExternalStore(ui.subscribe, () => ui.getState().view);
  const pages = useSyncExternalStore(ui.subscribe, () => ui.getState().pages);
  const spellcheck = useSyncExternalStore(ui.subscribe, () => ui.getState().spellcheck);
  const frame = useSyncExternalStore(ui.subscribe, () => ui.getState().frame);
  const ruler = useSyncExternalStore(ui.subscribe, () => ui.getState().ruler);
  const layout = useSyncExternalStore(ui.subscribe, () => ui.getState().layout);
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.view?.dom) editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, spellcheck]);
  return {
    view,
    pages,
    frame,
    ruler,
    layout,
    onToggleWhiteSpace: useCallback(() => ui.set({ hideWhiteSpace: !ui.getState().hideWhiteSpace }), [ui]),
    onFind: useCallback(() => ui.openFind(false), [ui]),
    onReplace: useCallback(() => ui.openFind(true), [ui]),
    onEditHeaderFooter: useCallback((which: "header" | "footer") => ui.openDialog("headerFooter", which), [ui]),
  };
}

export interface PageFrameProps {
  page: PageSetup | null;
  view: WriteView;
  pages: number;
  /** Header of the first page / footer of the last page from the section layout (else `page`'s texts). */
  frame?: { firstHeader: string; lastFooter: string } | null;
  onEditHeaderFooter: (which: "header" | "footer") => void;
  /** The print layout's pages (the chrome draws every sheet). */
  layout?: PageLayout | null;
  editor?: Editor | null;
  onToggleWhiteSpace?: () => void;
  /** The document's sections: mixed page widths centre every sheet in a frame as wide as the widest page (W-18). */
  sections?: Section[];
  /** Custom note separators (P9-W6); default: Word's lines. */
  separators?: NoteSeparators;
  children: ReactNode;
}

export function PageFrame({ page, view, pages, frame, onEditHeaderFooter, layout, editor = null, onToggleWhiteSpace, sections = [], separators, children }: PageFrameProps) {
  const t = useT();
  const g = pageGeometry(page);
  const print = view === "print";
  const frames = sectionFrames(sections, page);
  // Print layout: as wide as the widest page; the editor's text column is the first section's, centred on its sheet.
  const width = print ? frames.width : g.width;
  const padLeft = print ? frames.padLeft : g.left;
  const padRight = print ? frames.padRight : g.right;
  const hf = (which: "header" | "footer", text: string, style: React.CSSProperties) => (
    <div
      className={`page-hf page-${which}`}
      data-testid={`page-${which}`}
      data-hf={which}
      style={{ left: padLeft, right: padRight, ...style }}
      title={t(`write.hfTip.${which}`)}
      onDoubleClick={() => onEditHeaderFooter(which)}
    >
      {text}
    </div>
  );
  const paged = print && layout && layout.sheets.length > 0 ? layout : null;
  const mixed = !!paged && frames.mixed;
  return (
    <div
      className={`write-page relative mx-auto text-black ${mixed ? "write-mixed" : "bg-white shadow"} ${print ? "write-paged" : "write-draft"}${paged?.hide ? " write-nowhitespace" : ""}`}
      data-testid="write-page"
      data-view={view}
      data-pages={print ? (paged?.sheets.length ?? pages) : undefined}
      style={{
        width,
        // Print layout keeps the page's width (Word: a narrow window scrolls, the lines never re-wrap, W-24); draft
        // view wraps to the window.
        maxWidth: print ? undefined : "100%",
        flexShrink: print ? 0 : undefined,
        minHeight: paged ? paged.height : print ? g.height : undefined,
        padding: paged ? `${paged.origin}px ${padRight}px 0 ${padLeft}px` : `${g.top}px ${padRight}px ${g.bottom}px ${padLeft}px`,
      }}
    >
      {mixed && (
        // Each sheet's own white page (the frame itself is transparent), below the text.
        <div className="page-sheets" aria-hidden="true">
          {paged.sheets.map((s) => (
            <div key={s.index} className="page-sheet" data-page={s.index + 1} style={{ top: s.top, height: s.height, left: sheetLeft(width, s.geo.width), width: s.geo.width }} />
          ))}
        </div>
      )}
      {print && !paged && hf("header", frame ? frame.firstHeader : headerFooterText(page?.headerText, 1), { top: g.header })}
      {children}
      {print && !paged && hf("footer", frame ? frame.lastFooter : headerFooterText(page?.footerText, pages), { bottom: g.footer })}
      {paged && <PageChrome layout={paged} editor={editor} separators={separators} onEditHeaderFooter={onEditHeaderFooter} onToggleWhiteSpace={onToggleWhiteSpace ?? (() => undefined)} frameWidth={mixed ? width : undefined} />}
    </div>
  );
}
