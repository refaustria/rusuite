// Home › Select › Selection Pane (P8-28): the current slide's shapes from
// top to bottom (group children indented), like PowerPoint's. Click
// selects (Ctrl/Shift+click adds), double-click (or F2) renames in place,
// the eye hides / shows a shape (hidden shapes are not drawn), Show All /
// Hide All, ▲ / ▼ (Bring Forward / Send Backward) and dragging a top-level
// row by its grip (pointer events) reorder the z-order.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RibbonIcon } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import { useShow, viewSlide, type ShowStore } from "../state/store";
import { paneRows, zOfRow } from "./selection";
import { useT } from "../i18n";

const BTN = "flex h-8 min-w-8 items-center justify-center rounded px-1 text-xs hover:bg-ui-hover disabled:opacity-40";

const Eye = ({ off }: { off: boolean }) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    {off ? <path d="M3 13L13 3" /> : <circle cx="8" cy="8" r="2" />}
  </svg>
);

export function SelectionPane({ store }: { store: ShowStore }) {
  const t = useT();
  const open = useShow(store, (s) => s.selectionPane);
  const slide = useShow(store, (s) => viewSlide(s));
  const selection = useShow(store, (s) => s.selection);
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  const [drag, setDrag] = useState<{ id: NodeId; before: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  if (!open) return null;
  const rows = slide ? paneRows(slide) : [];
  const topRows = rows.filter((r) => r.depth === 0);

  const beforeAt = (y: number) => {
    const els = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-top-row]") ?? []);
    const i = els.findIndex((el) => {
      const b = el.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return i < 0 ? els.length : i;
  };
  const onGripDown = (e: ReactPointerEvent, id: NodeId) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    store.select([id]);
    setDrag({ id, before: topRows.findIndex((r) => r.id === id) });
  };
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const before = beforeAt(e.clientY);
    if (before !== drag.before) setDrag({ ...drag, before });
  };
  const onGripUp = (e: ReactPointerEvent) => {
    if (!drag || !slide) return;
    const from = topRows.findIndex((r) => r.id === drag.id);
    let row = beforeAt(e.clientY);
    if (row > from) row -= 1;
    setDrag(null);
    if (row !== from) void store.moveShapeToZ(drag.id, zOfRow(slide, row));
  };

  const one = selection.length === 1 ? selection[0]! : null;
  const z = one !== null && slide ? slide.shapes.findIndex((s) => s.id === one) : -1;
  return (
    <aside aria-label={t("show.selPane.title")} data-testid="selection-pane" className="flex w-60 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-ui-fg">
      <div className="flex items-center gap-1 border-b border-ui-border px-2 py-1">
        <span className="flex-1 text-sm font-semibold">{t("show.selPane.title")}</span>
        <button type="button" className={BTN} title={t("show.close")} aria-label={t("show.close")} onClick={() => store.toggleSelectionPane(false)}>
          <RibbonIcon name="close" />
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-ui-border px-2 py-1">
        <button type="button" className={BTN} onClick={() => void store.setAllHidden(false)}>{t("show.selPane.showAll")}</button>
        <button type="button" className={BTN} onClick={() => void store.setAllHidden(true)}>{t("show.selPane.hideAll")}</button>
        <span className="flex-1" />
        <button type="button" className={BTN} aria-label={t("show.order.bringForward")} title={t("show.order.bringForward")} disabled={z < 0 || z >= (slide?.shapes.length ?? 0) - 1} onClick={() => void store.zOrder("bringForward")}>▲</button>
        <button type="button" className={BTN} aria-label={t("show.order.sendBackward")} title={t("show.order.sendBackward")} disabled={z <= 0} onClick={() => void store.zOrder("sendBackward")}>▼</button>
      </div>
      <ul ref={list} role="listbox" aria-multiselectable="true" aria-label={t("show.selPane.shapes")} className="min-h-0 flex-1 overflow-y-auto py-1 text-sm" data-testid="selection-list">
        {rows.length === 0 && <li className="px-3 py-2 text-xs text-ui-muted">{t("show.selPane.empty")}</li>}
        {rows.map((r) => {
          const selected = selection.includes(r.id);
          const topIndex = r.depth === 0 ? topRows.findIndex((x) => x.id === r.id) : -1;
          return (
            <li
              key={r.id}
              role="option"
              aria-selected={selected}
              data-testid="selection-row"
              data-shape-id={r.id}
              data-top-row={r.depth === 0 ? "true" : undefined}
              className={`relative flex h-8 cursor-pointer items-center gap-1 pr-1 ${selected ? "bg-ui-active" : "hover:bg-ui-hover"} ${r.hidden ? "text-ui-muted" : ""}`}
              style={{ paddingLeft: 4 + r.depth * 16 }}
              onClick={(e) => {
                if (renaming !== null) return;
                const add = e.ctrlKey || e.metaKey || e.shiftKey;
                store.select([r.depth === 0 ? r.id : r.top], add ? "toggle" : "replace");
              }}
              onDoubleClick={() => setRenaming(r.id)}
              onKeyDown={(e) => {
                if (e.key === "F2") setRenaming(r.id);
              }}
            >
              {drag && topIndex === drag.before && <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 bg-orange-600" />}
              {r.depth === 0 ? (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-4 cursor-grab items-center justify-center text-ui-muted"
                  style={{ touchAction: "none" }}
                  data-testid="selection-grip"
                  onPointerDown={(e) => onGripDown(e, r.id)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                >
                  ⋮
                </span>
              ) : (
                <span className="w-4" />
              )}
              {renaming === r.id ? (
                <input
                  autoFocus
                  aria-label={t("show.selPane.rename")}
                  defaultValue={r.name}
                  className="h-6 min-w-0 flex-1 rounded border border-ui-focus bg-ui-bg px-1 text-sm"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      void store.renameShape(r.id, e.currentTarget.value);
                      setRenaming(null);
                    } else if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={(e) => {
                    void store.renameShape(r.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate" data-testid="selection-name">{r.name}</span>
              )}
              <button
                type="button"
                className={BTN}
                aria-label={r.hidden ? t("show.selPane.show", { name: r.name }) : t("show.selPane.hide", { name: r.name })}
                aria-pressed={r.hidden}
                data-testid="selection-eye"
                onClick={(e) => {
                  e.stopPropagation();
                  void store.setShapesHidden([r.id], !r.hidden);
                }}
              >
                <Eye off={r.hidden} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
