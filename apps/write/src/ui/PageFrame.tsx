// The sheet the editor sits on. Print layout: page size and margins from
// the `PageSetup`, the first page's header and the last page's footer
// greyed in the margins (the pages in between get theirs from the
// pagination widgets); double-click edits them. Draft: one long sheet.

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { PageSetup } from "../generated/PageSetup";
import { headerFooterText, pageGeometry } from "../features/pagination";
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
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.view?.dom) editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, spellcheck]);
  return {
    view,
    pages,
    frame,
    ruler,
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
  children: ReactNode;
}

export function PageFrame({ page, view, pages, frame, onEditHeaderFooter, children }: PageFrameProps) {
  const t = useT();
  const g = pageGeometry(page);
  const print = view === "print";
  const hf = (which: "header" | "footer", text: string, style: React.CSSProperties) => (
    <div
      className={`page-hf page-${which}`}
      data-testid={`page-${which}`}
      data-hf={which}
      style={{ left: g.left, right: g.right, ...style }}
      title={t(`write.hfTip.${which}`)}
      onDoubleClick={() => onEditHeaderFooter(which)}
    >
      {text}
    </div>
  );
  return (
    <div
      className={`write-page relative mx-auto bg-white text-black shadow ${print ? "write-paged" : "write-draft"}`}
      data-testid="write-page"
      data-view={view}
      style={{
        width: g.width,
        maxWidth: "100%",
        minHeight: print ? g.height : undefined,
        padding: `${g.top}px ${g.right}px ${g.bottom}px ${g.left}px`,
      }}
    >
      {print && hf("header", frame ? frame.firstHeader : headerFooterText(page?.headerText, 1), { top: g.header })}
      {children}
      {print && hf("footer", frame ? frame.lastFooter : headerFooterText(page?.footerText, pages), { bottom: g.footer })}
    </div>
  );
}
