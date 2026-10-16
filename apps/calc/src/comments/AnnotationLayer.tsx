// The HTML layer over the grid's cells (P8-26): note boxes with their
// connector (visible notes, Show All Notes, the hovered and the selected
// one; drag to move, handles to resize), the in-place note editor with
// its font toolbar, the thread card (hover or pinned), the New Comment
// composer and the hyperlink tip. Positions come from the grid
// (`store.comments.screen`), refreshed after every frame.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ColorPicker, type Color } from "@rusuite/ui-shared";
import type { Note } from "../generated/Note";
import type { NoteRun } from "../generated/NoteRun";
import type { Thread } from "../generated/Thread";
import { cellAddress } from "../grid/address";
import { HEADER_H, HEADER_W } from "../grid/render";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import type { CellRef } from "./controller";
import { boundsFromRect, connector, formatDate, formatRuns, initialsOf, linkHref, moveBox, noteBoxRect, resizeBox, runsHave, type BoxHandle, type PxRect } from "./model";
import { domToRuns, insertLineBreak, NOTE_FONT, runsToHtml, selectionOffsets, setSelection } from "./richText";
import { resolveIcon } from "./icons";

const NOTE_BG = "#ffffe1";
const HANDLES: BoxHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<BoxHandle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
const BTN = "min-h-8 min-w-8 rounded border border-ui-border bg-ui-bg px-2 text-xs hover:bg-ui-hover disabled:opacity-40";
const sameCell = (a: CellRef | null, b: CellRef | null) => !!a && !!b && a.sheet === b.sheet && a.row === b.row && a.col === b.col;

/** Grid-root px of a sheet px rectangle (headings offset included). */
function useScreen(store: CalcStore) {
  const on = store.sheetView().showHeadings;
  const hw = on ? HEADER_W : 0;
  const hh = on ? HEADER_H : 0;
  return (r: PxRect) => {
    const p = store.comments.screen?.(r.x, r.y) ?? { x: r.x, y: r.y };
    return { x: p.x + hw, y: p.y + hh, w: r.w, h: r.h };
  };
}

function Runs({ runs }: { runs: readonly NoteRun[] }) {
  // The same markup as the editor (spans with the run fonts).
  return <span dangerouslySetInnerHTML={{ __html: runsToHtml(runs) }} />;
}

/** A note box: drawn yellow box and connector; selectable, draggable and resizable when not a mere hover preview. */
function NoteBox({ store, note, sheet, rect, interactive }: { store: CalcStore; note: Note; sheet: number; rect: PxRect; interactive: boolean }) {
  const t = useT();
  const c = store.comments;
  const at = { sheet, row: note.row, col: note.col };
  const selected = sameCell(c.selectedNote, at);
  const screen = useScreen(store);
  const geo = store.geometry(sheet);
  const box = screen(rect);
  const line = connector(note, rect, geo.col, geo.row);
  const p1 = screen({ x: line.x1, y: line.y1, w: 0, h: 0 });
  const p2 = screen({ x: line.x2, y: line.y2, w: 0, h: 0 });
  const drag = (e: ReactPointerEvent, handle: BoxHandle | null) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    c.selectedNote = at;
    store.notify();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    // Pointer deltas in grid px (the grid is CSS-zoomed).
    const z = store.sheetView().zoom / 100 || 1;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / z;
      const dy = (ev.clientY - y0) / z;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      c.preview = { at, rect: handle ? resizeBox(rect, handle, dx, dy) : moveBox(rect, dx, dy) };
      store.notify();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = c.preview;
      c.preview = null;
      if (moved && p) void c.setNoteBounds(at, boundsFromRect(note, p.rect, geo.col, geo.row));
      else store.notify();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#000" strokeWidth="1" />
      </svg>
      <div
        role="note"
        aria-label={t("calc.notes.boxLabel", { cell: cellAddress(note.row, note.col), author: note.author ?? "" })}
        data-testid="note-box"
        data-cell={cellAddress(note.row, note.col)}
        className={`absolute overflow-hidden whitespace-pre-wrap break-words border px-1 py-0.5 text-black shadow-md ${interactive ? "pointer-events-auto cursor-move" : "pointer-events-none"} ${selected ? "border-[#217346] outline-dashed outline-1 outline-[#217346]" : "border-[#767676]"}`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, background: NOTE_BG, fontFamily: NOTE_FONT.family, fontSize: `${NOTE_FONT.pt}pt`, lineHeight: 1.2 }}
        onPointerDown={interactive ? (e) => drag(e, null) : undefined}
        onDoubleClick={interactive ? () => c.editNote(at) : undefined}
      >
        <Runs runs={note.text} />
      </div>
      {selected &&
        interactive &&
        HANDLES.map((h) => {
          const x = h.includes("w") ? box.x : h.includes("e") ? box.x + box.w : box.x + box.w / 2;
          const y = h.includes("n") ? box.y : h.includes("s") ? box.y + box.h : box.y + box.h / 2;
          return (
            // A 24 px hit area (touch) around the 8 px handle.
            <div
              key={h}
              data-testid={`note-handle-${h}`}
              className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center"
              style={{ left: x - 12, top: y - 12, cursor: CURSOR[h] }}
              onPointerDown={(e) => drag(e, h)}
            >
              <span className="h-2 w-2 border border-[#217346] bg-white" />
            </div>
          );
        })}
    </>
  );
}

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18];

/** The in-place note editor with Excel's small font toolbar (bold, italic, size, colour). */
function NoteEditor({ store, rect, runs: initial }: { store: CalcStore; rect: PxRect; runs: NoteRun[] }) {
  const t = useT();
  const c = store.comments;
  const ref = useRef<HTMLDivElement>(null);
  const runs = useRef<NoteRun[]>(initial);
  const [html, setHtml] = useState(() => runsToHtml(initial, true));
  const [, setTick] = useState(0);
  const screen = useScreen(store);
  const box = screen(rect);
  const headerH = store.sheetView().showHeadings ? HEADER_H : 0;
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
  }, [html]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = runs.current.reduce((n, r) => n + r.text.length, 0);
    setSelection(el, len, len);
  }, []);
  const read = () => {
    if (ref.current) runs.current = domToRuns(ref.current);
  };
  const commit = () => {
    if (done.current) return;
    done.current = true;
    read();
    void c.commitNote(runs.current).then(() => store.focusGrid());
  };
  const apply = (props: Parameters<typeof formatRuns>[3]) => {
    const el = ref.current;
    if (!el) return;
    read();
    const sel = selectionOffsets(el) ?? { start: 0, end: 0 };
    runs.current = formatRuns(runs.current, sel.start, sel.end, props);
    setHtml(runsToHtml(runs.current, true));
    requestAnimationFrame(() => {
      el.focus();
      setSelection(el, sel.start, sel.end);
      setTick((n) => n + 1);
    });
  };
  const sel = () => (ref.current && selectionOffsets(ref.current)) ?? { start: 0, end: 0 };
  const isOn = (p: "bold" | "italic") => runsHave(runs.current, sel().start, sel().end, p);
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <>
      <div
        role="toolbar"
        aria-label={t("calc.notes.fontToolbar")}
        data-testid="note-toolbar"
        className="pointer-events-auto absolute z-10 flex items-center gap-1 rounded border border-ui-border bg-ui-panel p-1 text-ui-fg shadow"
        style={{ left: box.x, top: box.y - 38 >= headerH ? box.y - 38 : box.y + box.h + 4 }}
        onMouseDown={keep}
      >
        <button type="button" className={`${BTN} font-bold`} aria-pressed={isOn("bold")} aria-label={t("fmt.bold")} onClick={() => apply({ bold: !isOn("bold") })}>
          B
        </button>
        <button type="button" className={`${BTN} italic`} aria-pressed={isOn("italic")} aria-label={t("fmt.italic")} onClick={() => apply({ italic: !isOn("italic") })}>
          I
        </button>
        <select
          aria-label={t("fmt.fontSize")}
          className="h-8 rounded border border-ui-border bg-ui-bg px-1 text-xs"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) apply({ size: Number(e.target.value) * 100 });
            e.target.value = "";
          }}
        >
          <option value="">{t("fmt.fontSize")}</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <ColorPicker label={t("fmt.textColor")} kind="text" onSelect={(color: Color | null) => apply({ color: color ?? undefined })} />
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={t("calc.notes.editorLabel")}
        data-testid="note-editor"
        contentEditable
        suppressContentEditableWarning
        className="pointer-events-auto absolute z-10 overflow-auto whitespace-pre-wrap break-words border border-[#217346] px-1 py-0.5 text-black shadow-md outline-none"
        style={{ left: box.x, top: box.y, width: box.w, minHeight: box.h, background: NOTE_BG, fontFamily: NOTE_FONT.family, fontSize: `${NOTE_FONT.pt}pt`, lineHeight: 1.2 }}
        onInput={read}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            commit();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (ref.current) insertLineBreak(ref.current);
            read();
          }
        }}
        onBlur={(e) => {
          // Clicks on the toolbar keep the editor.
          if (e.relatedTarget && (e.currentTarget.parentElement?.contains(e.relatedTarget as Node) ?? false)) return;
          commit();
        }}
      />
    </>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7719aa] text-xs font-semibold text-white">
      {initialsOf(name)}
    </span>
  );
}

/** One comment (first or reply) with Edit/Delete. */
function CommentItem({ name, date, text, onEdit, onDelete, testId }: { name: string; date: string; text: string; onEdit: (v: string) => void; onDelete?: () => void; testId: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  return (
    <div className="flex gap-2" data-testid={testId}>
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{name || t("calc.comments.unknownAuthor")}</span>
          <span className="text-xs text-ui-muted">{formatDate(date)}</span>
        </div>
        {editing ? (
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              onEdit(value);
            }}
          >
            <textarea aria-label={t("calc.comments.editLabel")} className="min-h-12 rounded border border-ui-border bg-ui-bg p-1 text-sm" value={value} onChange={(e) => setValue(e.target.value)} />
            <div className="flex justify-end gap-1">
              <button type="button" className={BTN} onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className={BTN}>
                {t("cmd.save")}
              </button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
        )}
        {!editing && (
          <div className="mt-0.5 flex gap-2 text-xs">
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
              {t("calc.comments.edit")}
            </button>
            {onDelete && (
              <button type="button" className="underline-offset-2 hover:underline" onClick={onDelete}>
                {t("cmd.delete")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A thread: first comment, replies, Resolve/Reopen, Delete thread, reply box. Used by the card and the pane. */
export function ThreadView({ store, sheet, thread }: { store: CalcStore; sheet: number; thread: Thread }) {
  const t = useT();
  const c = store.comments;
  const at = { sheet, row: thread.row, col: thread.col };
  const [reply, setReply] = useState("");
  const send = () => {
    c.reply(at, reply);
    setReply("");
  };
  return (
    <div className={`flex flex-col gap-2 ${thread.resolved ? "opacity-80" : ""}`} data-testid="thread" data-cell={cellAddress(thread.row, thread.col)}>
      <div className="flex items-center justify-between gap-2 text-xs text-ui-muted">
        <span>{cellAddress(thread.row, thread.col)}{thread.resolved ? ` · ${t("calc.comments.resolved")}` : ""}</span>
        <span className="flex gap-1">
          <button type="button" className={`${BTN} flex items-center gap-1`} aria-pressed={!!thread.resolved} onClick={() => void c.resolve(at, !thread.resolved)}>
            {resolveIcon(12)}
            {thread.resolved ? t("calc.comments.reopen") : t("calc.comments.resolve")}
          </button>
          <button type="button" className={BTN} aria-label={t("calc.comments.deleteThread")} onClick={() => void c.deleteThreads(at)}>
            {t("cmd.delete")}
          </button>
        </span>
      </div>
      <CommentItem testId="comment-first" name={thread.author.name} date={thread.date} text={thread.text} onEdit={(v) => void c.editComment(at, thread.id, v)} />
      {(thread.replies ?? []).map((r) => (
        <CommentItem key={r.id} testId="comment-reply" name={r.author.name} date={r.date} text={r.text} onEdit={(v) => void c.editComment(at, r.id, v)} onDelete={() => void c.deleteReply(at, r.id)} />
      ))}
      {!thread.resolved && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            aria-label={t("calc.comments.replyLabel")}
            placeholder={t("calc.comments.replyPlaceholder")}
            className="h-8 min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-2 text-sm"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className={BTN} disabled={!reply.trim()}>
            {t("calc.comments.post")}
          </button>
        </form>
      )}
    </div>
  );
}

function Card({ store, x, y, children, label, testId }: { store: CalcStore; x: number; y: number; children: ReactNode; label: string; testId: string }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      data-testid={testId}
      className="pointer-events-auto absolute z-20 w-72 rounded-lg border border-ui-border bg-ui-panel p-3 text-ui-fg shadow-xl"
      style={{ left: x, top: y }}
      onPointerEnter={() => store.comments.holdHover(true)}
      onPointerLeave={() => store.comments.holdHover(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          store.comments.pin(null);
          store.comments.cancelCompose();
          store.focusGrid();
        }
      }}
    >
      {children}
    </div>
  );
}

/** The New Comment composer. */
function Composer({ store, x, y }: { store: CalcStore; x: number; y: number }) {
  const t = useT();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const user = store.comments.currentUser();
  return (
    <Card store={store} x={x} y={y} label={t("calc.comments.new")} testId="comment-composer">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void store.comments.postComment(text).then(() => store.focusGrid());
        }}
      >
        <div className="flex items-center gap-2">
          <Avatar name={user?.name ?? "?"} />
          <span className="text-sm font-semibold">{user?.name}</span>
        </div>
        <textarea
          ref={ref}
          aria-label={t("calc.comments.textLabel")}
          placeholder={t("calc.comments.placeholder")}
          className="min-h-16 rounded border border-ui-border bg-ui-bg p-1 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            } else if (e.key === "Escape") {
              store.comments.cancelCompose();
              store.focusGrid();
            }
          }}
        />
        <div className="flex justify-end gap-1">
          <button type="button" className={BTN} onClick={() => store.comments.cancelCompose()}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={!text.trim()}>
            {t("calc.comments.post")}
          </button>
        </div>
      </form>
    </Card>
  );
}

export function AnnotationLayer({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const sheet = useCalc(store, (s) => s.activeSheet);
  const [, setFrame] = useState(0);
  const lastKey = useRef("");
  useEffect(() => {
    store.comments.positioner = () => {
      const p = store.comments.screen?.(0, 0);
      const key = p ? `${p.x},${p.y}` : "";
      if (key !== lastKey.current) {
        lastKey.current = key;
        setFrame((n) => n + 1);
      }
    };
    return () => {
      store.comments.positioner = null;
    };
  }, [store]);
  const c = store.comments;
  const geo = store.geometry(sheet);
  const screen = useScreen(store);
  const cellBox = (row: number, col: number) => screen({ x: geo.col.offset(col), y: geo.row.offset(row), w: geo.col.size(col), h: geo.row.size(row) });
  const editing = c.editing?.sheet === sheet ? c.editing : null;
  const shown = c.shownNotes(sheet).filter((n) => !(editing && editing.row === n.row && editing.col === n.col));
  const rectOf = (n: Note) => (c.preview && c.preview.at.sheet === sheet && c.preview.at.row === n.row && c.preview.at.col === n.col ? c.preview.rect : noteBoxRect(n, geo.col, geo.row));
  const persistent = (n: Note) => c.showAllNotes || !!n.visible || sameCell(c.selectedNote, { sheet, row: n.row, col: n.col });
  // The thread card: pinned, else the hovered cell's (not while composing or editing a note).
  const cardAt = c.pinned?.sheet === sheet ? c.pinned : c.hover?.sheet === sheet && !c.composing && !editing ? c.hover : null;
  const thread = cardAt ? c.thread(cardAt) : undefined;
  const link = c.hover?.sheet === sheet && !thread && !c.note(c.hover) ? c.hover : null;
  const linkObj = link ? c.link(link) : undefined;
  const composing = c.composing?.sheet === sheet ? c.composing : null;
  const on = store.sheetView().showHeadings;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ clipPath: `inset(${on ? HEADER_H : 0}px 0 0 ${on ? HEADER_W : 0}px)` }} data-testid="annotation-layer">
      {shown.map((n) => (
        <NoteBox key={`${n.row}:${n.col}`} store={store} note={n} sheet={sheet} rect={rectOf(n)} interactive={persistent(n)} />
      ))}
      {editing && <NoteEditor key={`${editing.row}:${editing.col}`} store={store} runs={editing.runs} rect={noteBoxRect(c.note(editing) ?? { row: editing.row, col: editing.col }, geo.col, geo.row)} />}
      {thread && cardAt && (() => {
        const b = cellBox(cardAt.row, cardAt.col);
        return (
          <Card store={store} x={b.x + b.w + 6} y={b.y} label={t("calc.comments.threadLabel", { cell: cellAddress(cardAt.row, cardAt.col) })} testId="thread-card">
            <ThreadView store={store} sheet={sheet} thread={thread} />
          </Card>
        );
      })()}
      {composing && (() => {
        const b = cellBox(composing.row, composing.col);
        return <Composer key={`${composing.row}:${composing.col}`} store={store} x={b.x + b.w + 6} y={b.y} />;
      })()}
      {link && (() => {
        const b = cellBox(link.row, link.col);
        const href = linkObj ? linkHref(linkObj.target) : null;
        const text = linkObj?.tooltip ?? (linkObj?.target.kind === "location" ? linkObj.target.location : href) ?? "";
        return (
          <div role="tooltip" data-testid="link-tip" className="absolute z-20 max-w-80 rounded border border-ui-border bg-ui-panel px-2 py-1 text-xs text-ui-fg shadow" style={{ left: b.x + 8, top: b.y + b.h + 2 }}>
            {text && <div className="truncate">{text}</div>}
            <div className="text-ui-muted">{t("calc.link.followTip")}</div>
          </div>
        );
      })()}
    </div>
  );
}
