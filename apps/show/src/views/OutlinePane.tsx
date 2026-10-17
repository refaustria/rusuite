// View › Outline View (P8-28, rich since P9-S3): the left pane shows the
// outline – per slide its number, an icon, the title and the body
// paragraphs indented by level – editable in place with the formatting of
// the runs kept (bold, italic, colour …; Ctrl+B / I / U toggle them).
// Each slide is one `contenteditable` built from its rich lines
// (`outline.ts`, `outlineDom.ts`) and rebuilt after every edit like the
// slide's own text editor: the browser only moves the caret, typing,
// Enter, Backspace / Delete and paste splice the lines. Edits go to the
// placeholders when the slide's text is left; structure changes apply at
// once, like PowerPoint: Tab / Shift+Tab (Alt+Shift+→ / ←) demote /
// promote the selected lines (a promoted body line becomes a new slide, a
// demoted title joins the previous slide), Enter after a title starts a
// new slide. Alt+Shift+↑ / ↓ move lines, Alt+Shift+− / + collapse /
// expand a slide (only its title shows), Alt+Shift+1 / 9 collapse /
// expand all. The context menu has the same commands and Show Text
// Formatting (plain text with bold titles when off).

import { useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { Theme } from "../generated/Theme";
import { useShow, type ShowStore } from "../state/store";
import { charStep, editorText, editPos, LINE_BREAK, spliceBody } from "../text/editing";
import { domToOffset, readDomText, readSelection, writeSelection } from "../canvas/richEditor";
import { docLines, lineTarget, linesDoc, linesInRange, moveLines, shiftDepth, slideLines, toggleRange, type OutlineLine } from "./outline";
import { buildOutlineDom } from "./outlineDom";
import { useT } from "../i18n";

/** A caret to place after a commit: slide, line on it, offset in the line. */
export interface OutlineFocus {
  slide: NodeId;
  line: number;
  offset: number;
}

type CollapseOp = "collapse" | "expand" | "collapseAll" | "expandAll";

const paraLen = (doc: TextBody, i: number) => editorText({ ...doc, paragraphs: [doc.paragraphs[i]!] }).length;

/** The editor-text offset of line `line`, offset `offset` of `doc` (clamped). */
export function docOffset(doc: TextBody, line: number, offset: number): number {
  const n = Math.max(0, Math.min(line, doc.paragraphs.length - 1));
  let at = 0;
  for (let i = 0; i < n; i++) at += paraLen(doc, i) + 1;
  return at + Math.min(offset, paraLen(doc, n));
}

const titleCount = (doc: TextBody) => doc.paragraphs.filter((p) => (p.props?.level ?? 0) === 0).length;

interface SlideOutlineProps {
  store: ShowStore;
  slide: Slide;
  number: number;
  current: boolean;
  collapsed: boolean;
  formatting: boolean;
  theme: Theme | undefined;
  /** Lines of the slide before (a demoted title joins after them). */
  prevCount: number;
  focus: OutlineFocus | null;
  onFocusDone: () => void;
  onFocusRequest: (f: OutlineFocus) => void;
  onCollapse: (op: CollapseOp) => void;
  /** The focused outline's Promote / Demote, for the context menu. */
  active: MutableRefObject<{ shift: (demote: boolean) => void } | null>;
}

function SlideOutline({ store, slide, number, current, collapsed, formatting, theme, prevCount, focus, onFocusDone, onFocusRequest, onCollapse, active }: SlideOutlineProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => slideLines(slide), [slide]);
  const doc = useRef<TextBody>(linesDoc(collapsed ? lines.slice(0, 1) : lines));
  /** Body lines hidden by Collapse (written back unchanged). */
  const hidden = useRef<OutlineLine[]>(collapsed ? lines.slice(1) : []);
  const dirty = useRef(false);
  const composing = useRef(false);
  const lastSel = useRef<{ start: number; end: number } | null>(null);

  const rebuild = (sel?: { start: number; end: number } | null) => {
    const root = ref.current;
    if (!root) return;
    root.replaceChildren(...buildOutlineDom(document, doc.current, { formatting, theme }));
    if (sel && document.activeElement === root) writeSelection(root, sel.start, sel.end);
  };

  // the DOM follows the slide (unless it is being edited)
  useLayoutEffect(() => {
    if (dirty.current) return;
    doc.current = linesDoc(collapsed ? lines.slice(0, 1) : lines);
    hidden.current = collapsed ? lines.slice(1) : [];
    const root = ref.current;
    rebuild(root && document.activeElement === root ? readSelection(root) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, collapsed, formatting, theme]);

  // a caret requested after a commit (structure changes move lines to other slides)
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !focus || focus.slide !== slide.id) return;
    root.focus();
    const at = docOffset(doc.current, focus.line, focus.offset);
    writeSelection(root, at, at);
    onFocusDone();
  });

  const selection = () => {
    const root = ref.current;
    const text = editorText(doc.current);
    return (root && readSelection(root)) ?? lastSel.current ?? { start: text.length, end: text.length };
  };

  const commit = async (caret?: number) => {
    if (!dirty.current) return;
    dirty.current = false;
    const all = [...docLines(doc.current), ...hidden.current];
    const pos = caret === undefined ? null : editPos(doc.current, caret);
    const ids = await store.commitOutlineLines(slide.id, all);
    const target = pos ? lineTarget(all, ids, pos, prevCount) : null;
    if (target) onFocusRequest(target);
  };

  /** The document changed: rebuilt with the caret at `start`…`end`; a new or removed title applies at once. */
  const changed = (next: TextBody, start: number, end = start) => {
    const structural = titleCount(next) !== titleCount(doc.current);
    doc.current = next;
    dirty.current = true;
    rebuild({ start, end });
    if (structural) void commit(end);
  };

  const edit = (from: number, to: number, insert: string) => {
    changed(spliceBody(doc.current, from, to, insert), from + insert.length);
  };

  /** Tab / Shift+Tab: the selected lines one level down / up (the first slide's title stays). */
  const shift = (demote: boolean) => {
    const sel = selection();
    const { first, last } = linesInRange(doc.current, sel.start, sel.end);
    const from = number === 1 && first === 0 && demote ? 1 : first;
    if (from > last) return;
    const before = docLines(doc.current);
    const after = shiftDepth(before, from, last, demote);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    const structural = after.some((l, i) => (l.depth === 0) !== (before[i]!.depth === 0));
    doc.current = linesDoc(after);
    dirty.current = true;
    rebuild(sel);
    // from the context menu (focus elsewhere) the change applies at once
    if (structural || document.activeElement !== ref.current) void commit(sel.end);
  };

  const move = (dir: -1 | 1) => {
    const sel = selection();
    const { first, last } = linesInRange(doc.current, sel.start, sel.end);
    const moved = moveLines(doc.current.paragraphs, first, last, dir);
    if (!moved) return;
    const other = dir < 0 ? first - 1 : last + 1;
    const delta = (paraLen(doc.current, other) + 1) * dir;
    changed({ ...doc.current, paragraphs: moved }, sel.start + delta, sel.end + delta);
  };

  // `beforeinput` (React's has no `inputType`): typing, Enter, deleting and pasting splice the document
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onBeforeInput = (ev: InputEvent) => {
      const type = ev.inputType;
      if (type === "insertCompositionText" || ev.isComposing) return;
      ev.preventDefault();
      if (type === "historyUndo" || type === "historyRedo") return;
      let { start: from, end: to } = selection();
      const target = typeof ev.getTargetRanges === "function" ? ev.getTargetRanges()[0] : undefined;
      if (target && root.contains(target.startContainer) && root.contains(target.endContainer)) {
        const a = domToOffset(root, target.startContainer, target.startOffset);
        const b = domToOffset(root, target.endContainer, target.endOffset);
        from = Math.min(a, b);
        to = Math.max(a, b);
      }
      const text = editorText(doc.current);
      let insert = "";
      if (type === "insertText" || type === "insertReplacementText") insert = ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "";
      else if (type === "insertParagraph") insert = "\n";
      else if (type === "insertLineBreak") insert = LINE_BREAK;
      else if (type === "insertFromPaste" || type === "insertFromDrop") insert = ev.dataTransfer?.getData("text/plain") ?? ev.data ?? "";
      else if (type.startsWith("delete")) {
        if (from === to) {
          if (type.includes("Backward")) from = charStep(text, from, -1);
          else to = charStep(text, to, 1);
        }
      } else return;
      if (from === to && insert === "") return;
      edit(from, to, insert);
    };
    root.addEventListener("beforeinput", onBeforeInput);
    return () => root.removeEventListener("beforeinput", onBeforeInput);
  });

  const alt = (e: React.KeyboardEvent) => e.altKey && e.shiftKey && !(e.ctrlKey || e.metaKey);

  return (
    <div className={`flex gap-1 rounded px-1 py-0.5 ${current ? "bg-ui-active" : ""}`} data-testid="outline-slide" data-slide-id={slide.id} data-collapsed={collapsed ? "true" : undefined}>
      <span className={`w-5 shrink-0 pt-0.5 text-right text-xs text-ui-muted ${slide.hidden ? "line-through" : ""}`}>{number}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={collapsed ? t("show.outline.expand") : t("show.outline.collapse")}
        aria-expanded={!collapsed}
        data-testid="outline-toggle"
        className="mt-1 h-4 shrink-0 text-ui-muted"
        onClick={() => void commit().then(() => onCollapse(collapsed ? "expand" : "collapse"))}
      >
        <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12">
          <rect x="0.5" y="0.5" width="13" height="11" rx="1" fill="none" stroke="currentColor" />
          {collapsed && <path d="M3 9h8" stroke="currentColor" />}
        </svg>
      </button>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={t("show.outline.slide", { n: number })}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-testid="outline-text"
        className={`min-w-0 flex-1 bg-transparent text-sm leading-6 text-ui-fg outline-none ${collapsed ? "underline decoration-dotted" : ""}`}
        onFocus={() => {
          active.current = { shift };
          if (store.getState().current !== slide.id) store.selectSlide(slide.id);
        }}
        onBlur={() => {
          const root = ref.current;
          lastSel.current = root ? readSelection(root) : null;
          void commit();
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (!mod) e.stopPropagation();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          const k = e.key;
          const done = () => {
            e.preventDefault();
            e.stopPropagation();
          };
          const then = (op: CollapseOp) => void commit().then(() => onCollapse(op));
          if (k === "Tab" && !mod && !e.altKey) {
            done();
            shift(!e.shiftKey);
          } else if (alt(e) && (k === "ArrowRight" || k === "ArrowLeft")) {
            done();
            shift(k === "ArrowRight");
          } else if (alt(e) && (k === "ArrowUp" || k === "ArrowDown")) {
            done();
            move(k === "ArrowUp" ? -1 : 1);
          } else if (alt(e) && (k === "-" || k === "_" || e.code === "Minus" || e.code === "NumpadSubtract")) {
            done();
            then("collapse");
          } else if (alt(e) && (k === "+" || k === "=" || e.code === "Equal" || e.code === "NumpadAdd")) {
            done();
            then("expand");
          } else if (alt(e) && (e.code === "Digit1" || k === "1" || k === "!")) {
            done();
            then("collapseAll");
          } else if (alt(e) && (e.code === "Digit9" || k === "9" || k === "(")) {
            done();
            then("expandAll");
          } else if (mod && !e.altKey && !e.shiftKey && ["b", "i", "u"].includes(k.toLowerCase())) {
            done();
            const sel = selection();
            const key = k.toLowerCase() === "b" ? "bold" : k.toLowerCase() === "i" ? "italic" : "underline";
            const next = toggleRange(doc.current, sel.start, sel.end, key);
            if (next !== doc.current) changed(next, sel.start, sel.end);
          } else if (mod && !e.altKey && (k === "z" || k === "Z") && !e.shiftKey && dirty.current) {
            // the typing not yet written back is undone first
            done();
            dirty.current = false;
            doc.current = linesDoc(collapsed ? lines.slice(0, 1) : lines);
            rebuild({ start: 0, end: 0 });
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          const sel = selection();
          if (text || sel.start !== sel.end) edit(sel.start, sel.end, text.replace(/\r\n?/g, "\n"));
        }}
        onCut={(e) => {
          const sel = selection();
          if (sel.start === sel.end) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", editorText(doc.current).slice(sel.start, sel.end).replace(/\u000b/g, "\n"));
          edit(sel.start, sel.end, "");
        }}
        onDrop={(e) => e.preventDefault()}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          const root = ref.current;
          if (!root) return;
          const before = editorText(doc.current);
          const after = readDomText(root);
          const sel = readSelection(root) ?? { start: after.length, end: after.length };
          if (after === before) return;
          let pre = 0;
          while (pre < Math.min(before.length, after.length) && before[pre] === after[pre]) pre++;
          let suf = 0;
          while (suf < Math.min(before.length, after.length) - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
          doc.current = spliceBody(doc.current, pre, before.length - suf, after.slice(pre, after.length - suf));
          dirty.current = true;
          rebuild(sel);
        }}
      />
    </div>
  );
}

export function OutlinePane({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(new Set());
  const [formatting, setFormatting] = useState(false);
  const [focus, setFocus] = useState<OutlineFocus | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; slide: NodeId | null } | null>(null);
  const active = useRef<{ shift: (demote: boolean) => void } | null>(null);
  if (!pres) return <nav aria-label={t("show.view.outline")} className="w-72 shrink-0 border-r border-ui-border bg-ui-panel" />;
  const slides = pres.slides;
  const collapse = (id: NodeId | null, op: CollapseOp) => {
    if (op === "collapseAll") setCollapsed(new Set(slides.map((s) => s.id)));
    else if (op === "expandAll") setCollapsed(new Set());
    else if (id !== null) {
      const next = new Set(collapsed);
      if (op === "collapse") next.add(id);
      else next.delete(id);
      setCollapsed(next);
    }
  };
  const items = (id: NodeId | null): ContextMenuItem[] => [
    { id: "promote", label: t("show.outline.promote"), shortcut: "Shift+Tab", disabled: !active.current, onSelect: () => active.current?.shift(false) },
    { id: "demote", label: t("show.outline.demote"), shortcut: "Tab", disabled: !active.current, onSelect: () => active.current?.shift(true) },
    { separator: true },
    { id: "collapse", label: t("show.outline.collapse"), shortcut: "Alt+Shift+−", disabled: id === null || collapsed.has(id), onSelect: () => collapse(id, "collapse") },
    { id: "expand", label: t("show.outline.expand"), shortcut: "Alt+Shift++", disabled: id === null || !collapsed.has(id), onSelect: () => collapse(id, "expand") },
    { id: "collapseAll", label: t("show.outline.collapseAll"), shortcut: "Alt+Shift+1", onSelect: () => collapse(null, "collapseAll") },
    { id: "expandAll", label: t("show.outline.expandAll"), shortcut: "Alt+Shift+9", onSelect: () => collapse(null, "expandAll") },
    { separator: true },
    { id: "formatting", label: `${formatting ? "✓ " : ""}${t("show.outline.formatting")}`, onSelect: () => setFormatting(!formatting) },
  ];
  return (
    <nav
      aria-label={t("show.view.outline")}
      data-testid="outline-pane"
      data-formatting={formatting ? "true" : undefined}
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-ui-border bg-ui-panel p-2"
      onContextMenu={(e) => {
        e.preventDefault();
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-slide-id]");
        setMenu({ at: { x: e.clientX, y: e.clientY }, slide: el ? Number(el.dataset.slideId) : current });
      }}
    >
      {slides.map((s, i) => (
        <SlideOutline
          key={s.id}
          store={store}
          slide={s}
          number={i + 1}
          current={s.id === current}
          collapsed={collapsed.has(s.id)}
          formatting={formatting}
          theme={pres.theme}
          prevCount={i > 0 ? slideLines(slides[i - 1]!).length : 0}
          focus={focus}
          onFocusDone={() => setFocus(null)}
          onFocusRequest={setFocus}
          onCollapse={(op) => collapse(s.id, op)}
          active={active}
        />
      ))}
      <ContextMenu at={menu?.at ?? null} label={t("show.view.outline")} items={menu ? items(menu.slide) : []} onClose={() => setMenu(null)} />
    </nav>
  );
}
