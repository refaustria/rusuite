// Touch selection (P10-M4, docs/ui.md "Write touch"): in touch mode a text selection gets two round handles at its
// ends (24 px, 44 px hit area; dragging one moves that end character by character and scrolls near the edges) and a
// floating bar above it with Bold, Italic, Underline, Highlight, Link, Copy, Cut, Paste, Comment and "⋯" (the
// editor's context menu, a sheet on phones). The bar follows the selection, stays inside the visible area (above
// the command bar and the keyboard) and hides while a handle is dragged.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Icon, RibbonIcon, readViewport, VISUAL_VIEWPORT_EVENT } from "@rusuite/ui-shared";
import { resolvedRunAt } from "../features/fontBox";
import { toggleRun, type RunSwitch } from "../features/wordKeys";
import { setTextStyle } from "../sync/editorCommands";
import type { WriteFeatures } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";
import { contextItems, openEditorMenu } from "../ui/EditorContextMenu";
import { useT } from "../i18n";
import { isTouchMode, subscribeTouchMode } from "./touchMode";
import { autoScrollSpeed, barPosition, type Box } from "./selection";

/** Visual size and hit area (px) of a selection handle. */
export const HANDLE_PX = 24;
export const HANDLE_HIT_PX = 44;

interface Geometry {
  start: { x: number; y: number; top: number };
  end: { x: number; y: number; top: number };
  sel: Box;
  bounds: Box;
}

/** The visible part of the editor's scroll area: below its top, above the command bar and the keyboard. */
export function visibleBounds(editor: Editor): Box {
  const scroll = (editor.view.dom as HTMLElement).closest<HTMLElement>(".write-scroll");
  const vv = readViewport();
  const r = scroll?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  let bottom = Math.min(r.bottom, vv.top + vv.height);
  const bar = document.querySelector<HTMLElement>('[data-testid="command-bar"]');
  if (bar) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
  return { left: Math.max(0, r.left), top: Math.max(r.top, vv.top), right: Math.min(window.innerWidth, r.right), bottom };
}

function geometry(editor: Editor): Geometry | null {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const view = editor.view;
  try {
    const a = view.coordsAtPos(selection.from, 1);
    const b = view.coordsAtPos(selection.to, -1);
    const bounds = visibleBounds(editor);
    const sel = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
    if (sel.bottom < bounds.top || sel.top > bounds.bottom) return null;
    return { start: { x: a.left, y: a.bottom, top: a.top }, end: { x: b.right, y: b.bottom, top: b.top }, sel, bounds };
  } catch {
    return null;
  }
}

function BarButton({ label, pressed, onClick, children, testId }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded px-2 text-ui-fg ${pressed ? "bg-ui-active" : "hover:bg-ui-hover"}`}
      // The editor keeps the focus and the selection (and the keyboard stays open).
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const HIGHLIGHT = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M5 13l7-9 3 2.5-6 9.5H5z" />
    <path d="M3 18h14" strokeWidth="2.5" stroke="#f5d90a" />
  </svg>
);
const LINK = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" />
    <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" />
  </svg>
);
const COMMENT = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
  </svg>
);

export function TouchSelection({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const touch = useSyncExternalStore(subscribeTouchMode, isTouchMode);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, setTick] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const [barSize, setBarSize] = useState({ w: 0, h: 0 });

  const update = useCallback(() => {
    if (editor.isDestroyed || !isTouchMode()) return setGeo(null);
    setGeo(geometry(editor));
    setSheetOpen(!!document.querySelector("[data-bottom-sheet], [role=dialog], [role=menu]"));
    setTick((n) => n + 1);
  }, [editor]);

  useEffect(() => {
    if (!touch) {
      setGeo(null);
      return;
    }
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    editor.on("transaction", later);
    editor.on("focus", later);
    editor.on("blur", later);
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    window.addEventListener(VISUAL_VIEWPORT_EVENT, later);
    window.visualViewport?.addEventListener("resize", later);
    // Sheets and dialogs open and close outside the editor's transactions.
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: false });
    const root = (editor.view.dom as HTMLElement).closest("[data-rs-app]");
    if (root) mo.observe(root, { childList: true });
    // The page re-lays out after zoom and pagination changes.
    const zoomEl = (editor.view.dom as HTMLElement).closest(".write-zoom");
    const ro = typeof ResizeObserver === "undefined" || !zoomEl ? null : new ResizeObserver(later);
    if (zoomEl) ro?.observe(zoomEl);
    later();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", later);
      editor.off("focus", later);
      editor.off("blur", later);
      window.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
      window.removeEventListener(VISUAL_VIEWPORT_EVENT, later);
      window.visualViewport?.removeEventListener("resize", later);
      mo.disconnect();
      ro?.disconnect();
    };
  }, [editor, touch, update]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w !== barSize.w || h !== barSize.h) setBarSize({ w, h });
  });

  // ----- handle dragging --------------------------------------------------------------------------------------
  const drag = useRef<{ which: "start" | "end"; fixed: number; dy: number; x: number; y: number; frame: number; id: number } | null>(null);
  const moveTo = useCallback(
    (x: number, y: number) => {
      const d = drag.current;
      if (!d || editor.isDestroyed) return;
      const view = editor.view;
      const hit = view.posAtCoords({ left: x, top: y - d.dy });
      if (!hit || hit.pos === d.fixed) return;
      const sel = TextSelection.between(view.state.doc.resolve(d.fixed), view.state.doc.resolve(hit.pos));
      if (sel.eq(view.state.selection)) return;
      view.dispatch(view.state.tr.setSelection(sel).setMeta("addToHistory", false));
    },
    [editor],
  );
  const scrollLoop = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const scroll = (editor.view.dom as HTMLElement).closest<HTMLElement>(".write-scroll");
    const b = visibleBounds(editor);
    const v = autoScrollSpeed(d.y, b.top, b.bottom);
    if (scroll && v) {
      scroll.scrollTop += v;
      moveTo(d.x, d.y);
    }
    d.frame = requestAnimationFrame(scrollLoop);
  }, [editor, moveTo]);
  const onHandleDown = (which: "start" | "end") => (e: React.PointerEvent<HTMLElement>) => {
    const g = geo;
    const { selection } = editor.state;
    if (!g || selection.empty) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const point = which === "start" ? g.start : g.end;
    // The finger holds the handle below the line: aim at the line's middle.
    const dy = e.clientY - (point.top + point.y) / 2;
    drag.current = { which, fixed: which === "start" ? selection.to : selection.from, dy, x: e.clientX, y: e.clientY, frame: 0, id: e.pointerId };
    drag.current.frame = requestAnimationFrame(scrollLoop);
    setDragging(which);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    d.x = e.clientX;
    d.y = e.clientY;
    moveTo(e.clientX, e.clientY);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    cancelAnimationFrame(d.frame);
    drag.current = null;
    setDragging(null);
    update();
  };

  if (!touch || !geo) return null;
  // Pressed for the selection's first character (the caret rule would read the text before the selection).
  const { from } = editor.state.selection;
  const first = editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, Math.min(from + 1, editor.state.doc.content.size))));
  const s = resolvedRunAt(first, ctl.styles);
  const highlight = editor.state.doc.nodeAt(from)?.marks.find((m) => m.type.name === "textStyle")?.attrs.highlight ?? null;
  const sw = (kind: RunSwitch) => () => {
    editor.commands.focus();
    toggleRun(editor, ctl.styles, kind);
  };
  // Copy / Cut / Paste: the context menu's commands.
  const run = (id: string) => () => {
    for (const i of contextItems(editor, ctl, features)) if ("id" in i && i.id === id) i.onSelect();
  };
  const pos = barPosition(geo.sel, barSize.w || 300, barSize.h || 48, geo.bounds, HANDLE_HIT_PX);
  const handle = (which: "start" | "end") => {
    const p = which === "start" ? geo.start : geo.end;
    if (p.y < geo.bounds.top - 4 || p.y > geo.bounds.bottom + 4) return null;
    return (
      <div
        key={which}
        role="slider"
        aria-label={t(which === "start" ? "write.touch.handleStart" : "write.touch.handleEnd")}
        aria-valuenow={which === "start" ? editor.state.selection.from : editor.state.selection.to}
        tabIndex={-1}
        data-testid={`selection-handle-${which}`}
        className="write-sel-handle"
        style={{ left: p.x - HANDLE_HIT_PX / 2, top: p.y - 6, width: HANDLE_HIT_PX, height: HANDLE_HIT_PX }}
        onPointerDown={onHandleDown(which)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <span aria-hidden="true" style={{ width: HANDLE_PX, height: HANDLE_PX }} />
      </div>
    );
  };
  return (
    <>
      {handle("start")}
      {handle("end")}
      {!dragging && !sheetOpen && (
        <div
          ref={bar}
          role="toolbar"
          aria-label={t("write.touch.selectionBar")}
          data-testid="selection-bar"
          className="fixed z-40 flex max-w-[calc(100vw-16px)] items-center rounded-lg border border-ui-border bg-ui-panel p-0.5 shadow-lg"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="flex min-w-0 items-center overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <BarButton label={t("fmt.bold")} pressed={!!s.bold} onClick={sw("bold")}>
              <Icon name="bold" size={18} />
            </BarButton>
            <BarButton label={t("fmt.italic")} pressed={!!s.italic} onClick={sw("italic")}>
              <Icon name="italic" size={18} />
            </BarButton>
            <BarButton label={t("fmt.underline")} pressed={!!s.underline && s.underline !== "none"} onClick={sw("underline")}>
              <Icon name="underline" size={18} />
            </BarButton>
            <BarButton
              label={t("write.highlight")}
              pressed={!!highlight}
              onClick={() => {
                editor.commands.focus();
                setTextStyle(editor, { highlight: highlight ? null : { kind: "rgb", value: "FFFF00" } });
              }}
            >
              {HIGHLIGHT}
            </BarButton>
            <BarButton label={t("write.link.insertDots")} onClick={() => features.ui.openDialog("link")}>
              {LINK}
            </BarButton>
            <BarButton label={t("cmd.copy")} onClick={run("copy")}>
              <RibbonIcon name="copy" size={18} />
            </BarButton>
            <BarButton label={t("cmd.cut")} onClick={run("cut")}>
              <RibbonIcon name="cut" size={18} />
            </BarButton>
            <BarButton label={t("cmd.paste")} onClick={run("paste")}>
              <RibbonIcon name="paste" size={18} />
            </BarButton>
            <BarButton label={t("write.comments.new")} onClick={() => features.newComment()}>
              {COMMENT}
            </BarButton>
          </div>
          <BarButton
            label={t("write.touch.more")}
            testId="selection-bar-more"
            onClick={() => openEditorMenu(editor.view.dom as HTMLElement, (geo.sel.left + geo.sel.right) / 2, (geo.sel.top + geo.sel.bottom) / 2)}
          >
            <RibbonIcon name="more" size={18} />
          </BarButton>
        </div>
      )}
    </>
  );
}
