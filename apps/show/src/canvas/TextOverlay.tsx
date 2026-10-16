// The in-place text editor (P8-45 S-01, replacing the `<textarea>`
// overlay; ADR 0008: no ProseMirror in Show). A `contenteditable` over
// the edited shape's text rectangle shows the text exactly as the slide
// draws it – the session's rich body laid out by the slide's own
// `layoutText` (bullets and numbers per level from the master, indents,
// fonts, sizes, colours, bold / italic per run, alignment, spacing, line
// spacing, the autofit scale computed live, vertical text turned) and
// rebuilt as DOM after every edit (`richEditor.ts`), at the slide's px
// size and scaled with the zoom, so nothing moves when editing starts or
// ends. The browser only moves the caret: typing, Enter, Backspace /
// Delete, paste (plain text) and cut arrive as `beforeinput` / clipboard
// events and splice the session's body (`text/editing.ts`); IME
// composition is left to the browser and read back when it ends. Tab /
// Shift+Tab change the list level, Ctrl+Shift+> / < grow and shrink the
// font, Ctrl+Z / Ctrl+Y undo and redo the typing; other Ctrl/Cmd keys go
// on to the shortcut layer (B / I / U, K …). Blur, Esc and Ctrl+Enter
// commit (`SetTextBody`); focus moving into the ribbon (`[data-keep-edit]`)
// keeps the session open so its formatting applies to the selection.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Shape } from "../generated/Shape";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import { emuToPx, PX_PER_PT } from "../geometry";
import { effectiveParagraph, findShape, themePalette } from "../model";
import { slideNumberOf, stableDeck } from "../design/deck";
import { textRect } from "../shapes/presets";
import { keyMove } from "../shapes/tables";
import { autofitProps, fitHeight } from "../text/autofit";
import { charStep } from "../text/editing";
import { cssFont, layoutText, measureText, type LayoutOptions, type TextLayout } from "../text/layout";
import { tableOf, useShow, type EditSession, type ShowStore } from "../state/store";
import { cellRunBase, runStyleFor, tableLayout } from "./tableLayout";
import { drawnBody, shapeTextOptions } from "./SlideView";
import { buildParagraphs, domToOffset, readDomText, readSelection, writeSelection } from "./richEditor";
import { useT } from "../i18n";

/** Absolute (slide) transform of a shape inside groups; group rotation is ignored. */
export function absoluteTransform(shape: Shape, parents: Shape[]): Transform {
  let { x, y } = shape.transform;
  for (const p of parents) {
    x += p.transform.x;
    y += p.transform.y;
  }
  return { ...shape.transform, x, y };
}

/** What the editor draws: the box (slide px), the text rectangle in it, the laid-out body. */
export interface EditorFrame {
  /** The shape's (or cell's) box in slide px and its rotation. */
  box: { x: number; y: number; w: number; h: number; rotation: number };
  /** The text rectangle relative to the box (px). */
  rect: { x: number; y: number; w: number; h: number };
  /** The body as laid out (vertical placeholders turned, live autofit scale). */
  body: TextBody;
  options: LayoutOptions;
  layout: TextLayout;
}

/** The editor frame of a session, or `null` when its shape is gone. */
export function editorFrame(store: ShowStore, e: EditSession): EditorFrame | null {
  const s = store.getState();
  const pres = s.pres;
  const slide = pres && !s.masterView ? pres.slides.find((x) => x.id === s.current) : null;
  const hit = slide ? findShape(slide.shapes, e.shape) : null;
  if (!pres || !slide || !hit) return null;
  const palette = themePalette(pres.theme);
  const tf = absoluteTransform(hit.shape, hit.parents);
  let body = store.sessionBody(e);
  const table = e.cell ? tableOf(hit.shape) : null;
  if (table && e.cell) {
    const cell = tableLayout(table, pres.theme, palette, pres.tableStyles).cells.find((c) => c.row === e.cell!.row && c.col === e.cell!.col);
    if (!cell) return null;
    const box = { x: emuToPx(tf.x) + cell.x, y: emuToPx(tf.y) + cell.y, w: cell.w, h: cell.h, rotation: 0 };
    const options: LayoutOptions = {
      width: cell.w,
      height: cell.h,
      measure: measureText,
      runStyle: runStyleFor(undefined, pres.theme, palette, cellRunBase(table, e.cell.row, e.cell.col, palette, pres.tableStyles)),
      paragraphProps: (p) => effectiveParagraph(undefined, p),
    };
    return { box, rect: { x: 0, y: 0, w: cell.w, h: cell.h }, body, options, layout: layoutText(body, options) };
  }
  const deck = stableDeck(pres);
  const ctx = { deck, slide, palette, asMaster: false, slideNumber: slideNumberOf(deck, slide.id) };
  // live autofit: shrink as the slide will after the commit; a growing shape grows with the text
  const fit = autofitProps(pres, slide, hit.shape, body);
  if (fit) body = { ...body, props: fit };
  let h = tf.h;
  if (body.props.autofit === "resize" && hit.parents.length === 0) h = Math.max(h, fitHeight(pres, slide, hit.shape, body) ?? h);
  const w = emuToPx(tf.w);
  const hp = emuToPx(h);
  const r = textRect(hit.shape, w, hp);
  const box = { x: emuToPx(tf.x), y: emuToPx(tf.y), w, h: hp, rotation: tf.rotationDeg || 0 };
  const shown = drawnBody(ctx, hit.shape, body);
  const options = shapeTextOptions(ctx, hit.shape, r.w, r.h);
  return { box, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, body: shown, options, layout: layoutText(shown, options) };
}

/** The widest character of a body (stacked text is one character wide). */
function widestChar(f: EditorFrame): number {
  let w = 1;
  const scale = f.layout.scale || 1;
  for (const p of f.body.paragraphs) {
    for (const r of p.runs) {
      const s = f.options.runStyle(r.props, p.props?.level ?? 0);
      const font = cssFont(s, s.sizePx * scale, s.fontFamily);
      for (const ch of Array.from(r.text)) w = Math.max(w, f.options.measure(ch, font));
    }
  }
  return Math.ceil(w) + 1;
}

/** The key of what the editor's DOM shows (rebuilt when it changes). */
const frameKey = (f: EditorFrame) => JSON.stringify([f.body.paragraphs, f.layout.paragraphs, f.layout.scale]);

interface Snapshot {
  text: string;
  body: TextBody | undefined;
  start: number;
  end: number;
}

export function TextOverlay({ store, scale }: { store: ShowStore; scale: number }) {
  const t = useT();
  const editing = useShow(store, (s) => s.editing);
  useShow(store, (s) => s.pres);
  const revision = useShow(store, (s) => s.revision);
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const builtKey = useRef("");
  const backward = useRef(false);
  const history = useRef<{ undo: Snapshot[]; redo: Snapshot[]; last: string; at: number }>({ undo: [], redo: [], last: "", at: 0 });
  const frame = editing ? editorFrame(store, editing) : null;
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const snapshot = (): Snapshot | null => {
    const e = store.getState().editing;
    return e ? { text: e.text, body: e.body, start: e.start, end: e.end } : null;
  };
  /** Applies one edit (an undo step unless it continues the typing before it). */
  const edit = (from: number, to: number, insert: string, kind: string) => {
    const h = history.current;
    const now = Date.now();
    const typing = kind === "insertText" && h.last === "insertText" && now - h.at < 1500 && insert !== " ";
    const snap = snapshot();
    if (!typing && snap) h.undo.push(snap);
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
    h.last = kind;
    h.at = now;
    store.editText(from, to, insert);
  };
  const step = (dir: "undo" | "redo") => {
    const h = history.current;
    const from = dir === "undo" ? h.undo : h.redo;
    const to = dir === "undo" ? h.redo : h.undo;
    const snap = from.pop();
    const cur = snapshot();
    if (!snap || !cur) return;
    to.push(cur);
    h.last = dir;
    store.restoreEdit(snap.text, snap.body, snap.start, snap.end);
  };
  /** The editor's selection (DOM) as offsets, falling back to the session's. */
  const selection = () => {
    const root = ref.current;
    const sel = root ? readSelection(root) : null;
    const e = store.getState().editing;
    return sel ?? { start: e?.start ?? 0, end: e?.end ?? 0, backward: false };
  };
  const syncSelection = () => {
    const e = store.getState().editing;
    const root = ref.current;
    if (!e || !root || composing.current) return;
    const sel = readSelection(root);
    if (!sel) return;
    backward.current = sel.backward;
    if (sel.start !== e.start || sel.end !== e.end) store.updateEdit(e.text, sel.start, sel.end);
  };
  const rebuild = (root: HTMLElement, f: EditorFrame) => {
    root.replaceChildren(...buildParagraphs(document, f.body, f.layout, f.options));
    builtKey.current = frameKey(f);
  };

  // A new session (or cell): focus, place the caret, forget the undo history.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    history.current = { undo: [], redo: [], last: "", at: 0 };
    root.focus();
    const e = store.getState().editing;
    if (e) writeSelection(root, e.start, e.end);
  }, [editing?.shape, editing?.cell?.row, editing?.cell?.col, store]);

  // After a ribbon command (new revision) the focus returns to the editor.
  useLayoutEffect(() => {
    const root = ref.current;
    const e = store.getState().editing;
    if (!root || !e || document.activeElement === root) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) return;
    root.focus();
    writeSelection(root, e.start, e.end, backward.current);
  }, [revision, store]);

  // The DOM follows the session's body; the selection follows the session's.
  useLayoutEffect(() => {
    const root = ref.current;
    const f = frameRef.current;
    const e = store.getState().editing;
    if (!root || !f || !e || composing.current) return;
    let restore = false;
    if (frameKey(f) !== builtKey.current) {
      rebuild(root, f);
      restore = true;
    }
    if (!restore && document.activeElement === root) {
      const sel = readSelection(root);
      restore = !sel || sel.start !== e.start || sel.end !== e.end;
    }
    if (restore && document.activeElement === root) writeSelection(root, e.start, e.end, backward.current);
  });

  // Native listeners: `beforeinput` (React's `onBeforeInput` has no `inputType`) and the selection.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onBeforeInput = (ev: InputEvent) => {
      const e = store.getState().editing;
      if (!e) return;
      const type = ev.inputType;
      if (type === "insertCompositionText" || ev.isComposing) return;
      ev.preventDefault();
      if (type === "historyUndo" || type === "historyRedo") {
        step(type === "historyUndo" ? "undo" : "redo");
        return;
      }
      let { start: from, end: to } = selection();
      const target = typeof ev.getTargetRanges === "function" ? ev.getTargetRanges()[0] : undefined;
      if (target && root.contains(target.startContainer) && root.contains(target.endContainer)) {
        const a = domToOffset(root, target.startContainer, target.startOffset);
        const b = domToOffset(root, target.endContainer, target.endOffset);
        from = Math.min(a, b);
        to = Math.max(a, b);
      }
      let insert = "";
      if (type === "insertText" || type === "insertReplacementText") insert = ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "";
      else if (type === "insertParagraph" || type === "insertLineBreak") insert = "\n";
      else if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromYank") insert = ev.dataTransfer?.getData("text/plain") ?? ev.data ?? "";
      else if (type.startsWith("delete")) {
        if (from === to) {
          if (type.includes("Backward")) from = charStep(e.text, from, -1);
          else to = charStep(e.text, to, 1);
        }
      } else return; // formatting by the browser (Ctrl+B in a contenteditable …): the ribbon and the shortcuts do that
      if (from === to && insert === "") return;
      edit(from, to, insert, type);
    };
    const onSelection = () => syncSelection();
    root.addEventListener("beforeinput", onBeforeInput);
    document.addEventListener("selectionchange", onSelection);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      document.removeEventListener("selectionchange", onSelection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing !== null && frame !== null, store]);

  if (!editing || !frame) return null;
  const f = frame;
  const props = f.body.props;
  const vert = props.vert ?? "horizontal";
  const rotated = vert === "rotate90" || vert === "rotate270";
  const lw = rotated ? f.rect.h : f.rect.w;
  const lh = rotated ? f.rect.w : f.rect.h;
  const ins = props.insets;
  const cols = Math.max(1, props.columns ?? 1);
  const anchor = props.anchor;
  const { box } = f;
  const turn = box.rotation ? ` translate(${box.w / 2}px, ${box.h / 2}px) rotate(${box.rotation}deg) translate(${-box.w / 2}px, ${-box.h / 2}px)` : "";
  const commit = () => void store.commitEdit();

  return (
    <div
      data-testid="text-overlay-box"
      data-cell={editing.cell ? `${editing.cell.row},${editing.cell.col}` : undefined}
      data-anchor={anchor}
      data-rotation={box.rotation || undefined}
      className="pointer-events-none absolute"
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.w,
        height: box.h,
        transformOrigin: "0 0",
        transform: `scale(${scale})${turn}`,
        outline: `${1 / scale}px dashed #3b82f6`,
      }}
    >
      <div className="pointer-events-auto absolute" style={{ left: f.rect.x, top: f.rect.y, width: f.rect.w, height: f.rect.h }}>
        <div
          data-testid="text-overlay-frame"
          data-vert={vert}
          className="absolute flex flex-col"
          style={{
            left: 0,
            top: 0,
            width: lw,
            height: lh,
            boxSizing: "border-box",
            padding: `${emuToPx(ins.top)}px ${emuToPx(ins.right)}px ${emuToPx(ins.bottom)}px ${emuToPx(ins.left)}px`,
            justifyContent: cols > 1 ? "flex-start" : anchor === "middle" ? "center" : anchor === "bottom" ? "flex-end" : "flex-start",
            transformOrigin: "0 0",
            transform: vert === "rotate90" ? `translate(${f.rect.w}px, 0px) rotate(90deg)` : vert === "rotate270" ? `translate(0px, ${f.rect.h}px) rotate(-90deg)` : undefined,
          }}
        >
          <div
            ref={ref}
            role="textbox"
            aria-multiline="true"
            aria-label={t("show.shapeText")}
            data-testid="text-overlay"
            data-rich-text=""
            contentEditable
            suppressContentEditableWarning
            tabIndex={-1}
            spellCheck={false}
            className="shrink-0 outline-none"
            style={{
              whiteSpace: props.wrap || vert === "stacked" ? "pre-wrap" : "pre",
              overflowWrap: "anywhere",
              wordBreak: vert === "stacked" ? "break-all" : undefined,
              width: vert === "stacked" ? widestChar(f) : undefined,
              margin: vert === "stacked" ? "0 auto" : undefined,
              textAlign: vert === "stacked" ? "center" : undefined,
              columnCount: cols > 1 ? cols : undefined,
              columnGap: cols > 1 ? emuToPx(props.columnSpacing ?? 0) : undefined,
              columnFill: cols > 1 ? "auto" : undefined,
              height: cols > 1 ? Math.max(1, lh - emuToPx(ins.top + ins.bottom)) : undefined,
              cursor: "text",
            }}
            onKeyDown={(e) => {
              const mod = e.ctrlKey || e.metaKey;
              // Ctrl/Cmd combinations go on to the shortcut layer (B / I / U, K, S, P …: its entries for text fields);
              // the keys the editor handles itself stop here
              if (!mod) e.stopPropagation();
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              const cur = store.getState().editing;
              if (!cur) return;
              const sel = selection();
              const move = cur.cell && !mod && !e.altKey ? keyMove(e.key, e.shiftKey, cur.text, sel.start, sel.end) : null;
              if (move) {
                e.preventDefault();
                store.updateEdit(cur.text, sel.start, sel.end);
                void store.moveCellEdit(move);
              } else if (e.key === "Escape" || (e.key === "Enter" && mod)) {
                e.preventDefault();
                e.stopPropagation();
                commit();
              } else if (e.key === "Tab" && !mod && !e.altKey) {
                e.preventDefault();
                store.updateEdit(cur.text, sel.start, sel.end);
                void store.indent(e.shiftKey ? -1 : 1);
              } else if (mod && e.shiftKey && (e.key === ">" || e.key === "<" || e.code === "Period" || e.code === "Comma")) {
                e.preventDefault();
                e.stopPropagation();
                store.updateEdit(cur.text, sel.start, sel.end);
                const first = f.body.paragraphs[0]?.runs[0]?.props;
                const size = Math.round((f.options.runStyle(first, f.body.paragraphs[0]?.props?.level ?? 0).sizePx / PX_PER_PT) * 100);
                void store.stepFont(e.key === ">" || e.code === "Period" ? 1 : -1, size);
              } else if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
                e.preventDefault();
                e.stopPropagation();
                step(e.key === "y" || e.key === "Y" || e.shiftKey ? "redo" : "undo");
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              const sel = selection();
              if (text || sel.start !== sel.end) edit(sel.start, sel.end, text, "paste");
            }}
            onCopy={(e) => {
              const cur = store.getState().editing;
              const sel = selection();
              if (!cur || sel.start === sel.end) return;
              e.preventDefault();
              e.clipboardData.setData("text/plain", cur.text.slice(sel.start, sel.end));
            }}
            onCut={(e) => {
              const cur = store.getState().editing;
              const sel = selection();
              if (!cur || sel.start === sel.end) return;
              e.preventDefault();
              e.clipboardData.setData("text/plain", cur.text.slice(sel.start, sel.end));
              edit(sel.start, sel.end, "", "cut");
            }}
            onDragStart={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            onCompositionStart={() => {
              composing.current = true;
              const snap = snapshot();
              if (snap) history.current.undo.push(snap);
              history.current.last = "composition";
            }}
            onCompositionEnd={() => {
              composing.current = false;
              const root = ref.current;
              const cur = store.getState().editing;
              if (!root || !cur) return;
              // what the browser composed: read back, spliced into the body, the DOM rebuilt
              const text = readDomText(root);
              const sel = readSelection(root) ?? { start: text.length, end: text.length, backward: false };
              builtKey.current = "";
              store.updateEdit(text, sel.start, sel.end);
              const fr = frameRef.current;
              if (text === cur.text && fr) {
                rebuild(root, fr);
                writeSelection(root, sel.start, sel.end);
              }
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next && next.closest("[data-keep-edit]")) return;
              commit();
            }}
          />
        </div>
      </div>
    </div>
  );
}
