// Arrange round 2 (P9-W4): Bring Forward ▾ / Send Backward ▾ (z-order,
// in front of / behind the text), Align ▾ with Distribute and "Align to
// Page / Margin / Selected Objects", the Selection Pane (list, rename,
// hide/show, reorder), Layout › Position (Word's More Layout Options:
// alignment, absolute and relative positions with their reference, Move
// object with text, Lock anchor, Allow overlap, Layout in table cell) and a
// drawing canvas's Fit.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Dialog, RibbonButton, RibbonMenuButton } from "@rusuite/ui-shared";
import type { Anchor } from "../generated/Anchor";
import type { Drawing } from "../generated/Drawing";
import type { HAlign } from "../generated/HAlign";
import type { HRelative } from "../generated/HRelative";
import type { VAlignPos } from "../generated/VAlignPos";
import type { VRelative } from "../generated/VRelative";
import { fitCanvas, selectedDrawing, setDrawingValue } from "../features/drawings/drawings";
import {
  alignSelected, allObjects, distributeSelected, objectName, orderSelected, selectedObjects, selectObjects, setObjectMeta, type AlignTo, type OrderOp,
} from "../features/drawings/objects";
import type { AlignMode } from "../features/drawings/geometry";
import { movedAnchor, renderedOffset, withWrap } from "../features/floating";
import { setImageAttrs } from "../features/images";
import type { WriteFeatures } from "../features/WriteFeatures";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { BUTTON, INPUT } from "./dialogs";
import { t, useT } from "../i18n";

const EMU_PER_CM = 360000;

const svg = (children: ReactNode) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
    {children}
  </svg>
);
const FORWARD_ICON = svg(<><rect x="2.5" y="2.5" width="9" height="9" strokeOpacity="0.5" /><rect x="7.5" y="7.5" width="10" height="10" fill="currentColor" fillOpacity="0.35" /></>);
const BACKWARD_ICON = svg(<><rect x="7.5" y="7.5" width="10" height="10" strokeOpacity="0.5" /><rect x="2.5" y="2.5" width="9" height="9" fill="currentColor" fillOpacity="0.35" /></>);
const PANE_ICON = svg(<><rect x="2.5" y="2.5" width="15" height="15" /><path d="M10 2.5v15M12 6h4M12 9h4M12 12h4" /></>);
const ALIGN_ICON = svg(<><path d="M3 2v16" /><rect x="5" y="4" width="10" height="4" /><rect x="5" y="11" width="6" height="4" /></>);
const FIT_ICON = svg(<><rect x="2.5" y="2.5" width="15" height="15" strokeDasharray="2 2" /><rect x="6" y="6" width="8" height="8" /></>);

/** The node of the selected picture or drawing (top level), with its position. */
function selectedObject(editor: Editor): { pos: number; node: PMNode } | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && (sel.node.type.name === "image" || sel.node.type.name === "drawing")) return { pos: sel.from, node: sel.node };
  return null;
}

const anchorOfNode = (n: PMNode): Anchor | null => (n.type.name === "drawing" ? ((n.attrs.value as Drawing).anchor ?? null) : (n.attrs.anchor as Anchor | null));

/** Sets the anchor of the object at `pos` (kept selected). */
function setAnchorAt(editor: Editor, pos: number, a: Anchor | null): void {
  const n = editor.state.doc.nodeAt(pos);
  if (!n) return;
  if (n.type.name === "image") setImageAttrs(editor.view, pos, { anchor: a });
  else {
    const d = { ...(n.attrs.value as Drawing) };
    if (a) d.anchor = a;
    else delete d.anchor;
    setDrawingValue(editor.view, pos, d);
  }
}

/** Bring Forward ▾ and Send Backward ▾ (Word's Arrange group). */
export function orderMenus(editor: Editor): ReactNode {
  const obj = selectedObject(editor);
  const floating = !!obj && !!anchorOfNode(obj.node);
  const run = (op: OrderOp) => () => orderSelected(editor.view, op);
  const wrap = (w: "inFront" | "behind") => () => {
    if (!obj) return;
    setAnchorAt(editor, obj.pos, withWrap(anchorOfNode(obj.node), w));
  };
  return (
    <>
      <RibbonMenuButton
        label={t("write.order.bringForward")}
        icon={FORWARD_ICON}
        disabled={!obj}
        menu={[
          { id: "forward", label: t("write.order.bringForward"), disabled: !floating, onSelect: run("forward") },
          { id: "front", label: t("write.order.bringToFront"), disabled: !floating, onSelect: run("front") },
          { id: "inFront", label: t("write.order.inFrontOfText"), onSelect: wrap("inFront") },
        ]}
      />
      <RibbonMenuButton
        label={t("write.order.sendBackward")}
        icon={BACKWARD_ICON}
        disabled={!obj}
        menu={[
          { id: "backward", label: t("write.order.sendBackward"), disabled: !floating, onSelect: run("backward") },
          { id: "back", label: t("write.order.sendToBack"), disabled: !floating, onSelect: run("back") },
          { id: "behind", label: t("write.order.behindText"), onSelect: wrap("behind") },
        ]}
      />
    </>
  );
}

let alignTo: AlignTo = "margin";

const ALIGN_LABEL: Record<AlignMode, string> = {
  left: "write.alignObj.left",
  center: "write.alignObj.center",
  right: "write.alignObj.right",
  top: "write.alignObj.vtop",
  middle: "write.alignObj.vcenter",
  bottom: "write.alignObj.vbottom",
};

/**
 * Align ▾: the six alignments, Distribute Horizontally / Vertically and what
 * they line up with (page, margin, the selected objects — Word's default
 * with several objects selected). `single` aligns one object semantically
 * (relative to the page or margin, kept when the text moves).
 */
export function alignObjectsMenu(editor: Editor, single: (mode: AlignMode, to: "page" | "margin") => void): ReactNode {
  const objs = selectedObjects(editor.state);
  const to: AlignTo = objs.length > 1 && alignTo !== "page" ? "selected" : alignTo === "selected" ? "margin" : alignTo;
  const align = (mode: AlignMode) => () => {
    if (objs.length > 1 || !objs.length) alignSelected(editor.view, mode, to);
    else single(mode, to === "page" ? "page" : "margin");
  };
  const modes: AlignMode[] = ["left", "center", "right", "top", "middle", "bottom"];
  return (
    <RibbonMenuButton
      label={t("write.alignObjects")}
      icon={ALIGN_ICON}
      size="large"
      menu={[
        ...modes.map((m) => ({ id: m, label: t(ALIGN_LABEL[m]), onSelect: align(m) })),
        { separator: true as const },
        { id: "distH", label: t("write.distribute.h"), disabled: !objs.length, onSelect: () => distributeSelected(editor.view, "h", to) },
        { id: "distV", label: t("write.distribute.v"), disabled: !objs.length, onSelect: () => distributeSelected(editor.view, "v", to) },
        { separator: true as const },
        { id: "toPage", label: t("write.alignTo.page"), checked: to === "page", onSelect: () => void (alignTo = "page") },
        { id: "toMargin", label: t("write.alignTo.margin"), checked: to === "margin", onSelect: () => void (alignTo = "margin") },
        { id: "toSelected", label: t("write.alignTo.selected"), checked: to === "selected", disabled: objs.length < 2, onSelect: () => void (alignTo = "selected") },
      ]}
    />
  );
}

/** Selection Pane toggle (Alt+F10). */
export function selectionPaneButton(features: WriteFeatures): ReactNode {
  return <RibbonButton label={t("write.selectionPane")} icon={PANE_ICON} shortcut="Alt+F10" onClick={() => features.ui.set({ selectionPane: !features.ui.getState().selectionPane })} />;
}

/** Fit (a selected drawing canvas shrinks to its members). */
export function fitCanvasButton(editor: Editor, d: Drawing): ReactNode {
  if (d.kind !== "canvas") return null;
  return (
    <RibbonButton
      label={t("write.canvas.fit")}
      icon={FIT_ICON}
      size="large"
      disabled={!d.children?.length}
      onClick={() => {
        const sel = selectedDrawing(editor.state);
        if (!sel || sel.value.kind !== "canvas") return;
        const fit = fitCanvas(sel.value);
        if (!fit) return;
        let next = fit.canvas;
        const a = sel.value.anchor;
        const el = editor.view.nodeDOM(sel.pos) as HTMLElement | null;
        if (a && el) {
          const o = renderedOffset(el, 0);
          next = { ...next, anchor: movedAnchor(a, o.x, o.y, fit.dx / 9525, fit.dy / 9525) };
        }
        setDrawingValue(editor.view, sel.pos, next);
      }}
    />
  );
}

// ----- Selection Pane ------------------------------------------------------------------------

/** The rows of the Selection Pane: every object, the top-most first (z-order, then later in the document). */
export function paneRows(objs: { pos: number; node: PMNode }[]): { pos: number; node: PMNode; name: string; hidden: boolean; z: number }[] {
  return objs
    .map((o, i) => ({
      pos: o.pos,
      node: o.node,
      name: objectName(o.node, i + 1),
      hidden: o.node.type.name === "image" ? !!o.node.attrs.hidden : !!(o.node.attrs.value as Drawing).hidden,
      z: anchorOfNode(o.node)?.z ?? 0,
      i,
    }))
    .sort((a, b) => b.z - a.z || b.i - a.i);
}

export function SelectionPane({ editor, features }: { editor: Editor; features: WriteFeatures }) {
  const tr = useT();
  const ui = features.ui;
  const open = useSyncExternalStore(ui.subscribe, () => ui.getState().selectionPane);
  const state = useThrottledEditorState({ editor, selector: ({ editor: e }) => e.state });
  const [renaming, setRenaming] = useState<number | null>(null);
  if (!open) return null;
  const rows = paneRows(allObjects(state));
  const selected = new Set(selectedObjects(state).map((o) => o.pos));
  const select = (pos: number, add: boolean) => {
    const cur = selectedObjects(editor.state).map((o) => o.pos);
    selectObjects(editor.view, add && cur.length ? [...cur.filter((p) => p !== pos), pos] : [pos]);
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  };
  const setAll = (hidden: boolean) => rows.forEach((r) => setObjectMeta(editor.view, r.pos, { hidden }));
  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-sm text-ui-fg" role="complementary" aria-label={tr("write.selectionPane")} data-testid="selection-pane">
      <div className="flex items-center justify-between border-b border-ui-border px-2 py-1">
        <span className="font-medium">{tr("write.selectionPane")}</span>
        <button type="button" className="h-8 min-w-8 rounded border border-ui-border bg-ui-bg px-2 text-xs hover:bg-ui-hover" aria-label={tr("common.close")} onClick={() => ui.set({ selectionPane: false })}>
          ×
        </button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-ui-border p-1">
        <button type="button" className={BUTTON} onClick={() => setAll(false)}>
          {tr("write.pane.showAll")}
        </button>
        <button type="button" className={BUTTON} onClick={() => setAll(true)}>
          {tr("write.pane.hideAll")}
        </button>
        <button type="button" className={BUTTON} aria-label={tr("write.order.bringForward")} title={tr("write.order.bringForward")} disabled={!selected.size} onClick={() => orderSelected(editor.view, "forward")}>
          ▲
        </button>
        <button type="button" className={BUTTON} aria-label={tr("write.order.sendBackward")} title={tr("write.order.sendBackward")} disabled={!selected.size} onClick={() => orderSelected(editor.view, "backward")}>
          ▼
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-1" role="listbox" aria-label={tr("write.pane.objects")} aria-multiselectable="true">
        {!rows.length && <li className="px-2 py-1 text-xs text-ui-muted">{tr("write.pane.empty")}</li>}
        {rows.map((r) => (
          <li
            key={r.pos}
            role="option"
            aria-selected={selected.has(r.pos)}
            data-testid="pane-row"
            className={`flex items-center gap-1 rounded px-1 py-0.5 ${selected.has(r.pos) ? "bg-ui-selected" : "hover:bg-ui-hover"}`}
            onClick={(e) => select(r.pos, e.ctrlKey || e.metaKey || e.shiftKey)}
            onDoubleClick={() => setRenaming(r.pos)}
          >
            {renaming === r.pos ? (
              <RenameField
                value={r.name}
                onDone={(name) => {
                  setRenaming(null);
                  if (name != null && name !== r.name) setObjectMeta(editor.view, r.pos, { name: name.trim() || null });
                }}
              />
            ) : (
              <span className={`flex-1 truncate ${r.hidden ? "text-ui-muted" : ""}`}>{r.name}</span>
            )}
            <button
              type="button"
              className="h-6 w-6 rounded text-xs hover:bg-ui-hover"
              aria-label={tr(r.hidden ? "write.pane.show" : "write.pane.hide", { name: r.name })}
              aria-pressed={r.hidden}
              onClick={(e) => {
                e.stopPropagation();
                setObjectMeta(editor.view, r.pos, { hidden: !r.hidden });
              }}
            >
              {r.hidden ? "—" : "👁"}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RenameField({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const tr = useT();
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      aria-label={tr("write.pane.rename")}
      className={`${INPUT} h-6 flex-1`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(v);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(v)}
    />
  );
}

// ----- Layout › Position ---------------------------------------------------------------------

export type PosMode = "align" | "absolute" | "relative";

/** The values of the Position tab. */
export interface LayoutValues {
  hMode: PosMode;
  hAlign: HAlign;
  hAlignTo: HRelative;
  hAbs: string;
  hAbsTo: HRelative;
  hPct: string;
  hPctTo: HRelative;
  vMode: PosMode;
  vAlign: VAlignPos;
  vAlignTo: VRelative;
  vAbs: string;
  vAbsTo: VRelative;
  vPct: string;
  vPctTo: VRelative;
  moveWithText: boolean;
  lockAnchor: boolean;
  allowOverlap: boolean;
  layoutInCell: boolean;
}

export const H_ALIGN_TO: HRelative[] = ["margin", "page", "column", "character", "leftMargin", "rightMargin", "insideMargin", "outsideMargin"];
export const H_PCT_TO: HRelative[] = ["margin", "page", "leftMargin", "rightMargin", "insideMargin", "outsideMargin"];
export const V_ALIGN_TO: VRelative[] = ["margin", "page", "line", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"];
export const V_ABS_TO: VRelative[] = ["margin", "page", "paragraph", "line", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"];
export const V_PCT_TO: VRelative[] = ["margin", "page", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"];

const cmText = (emu: number) => String(Math.round((emu / EMU_PER_CM) * 100) / 100);
const num = (s: string) => Number(s.trim().replace(",", "."));

/** The Position tab's values of an anchor. */
export function layoutValues(a: Anchor): LayoutValues {
  const h = a.h.place;
  const v = a.v.place;
  return {
    hMode: h.kind === "align" ? "align" : h.kind === "percent" ? "relative" : "absolute",
    hAlign: h.kind === "align" ? h.value : "left",
    hAlignTo: h.kind === "align" ? a.h.relativeTo : "column",
    hAbs: h.kind === "offset" ? cmText(h.value) : "0",
    hAbsTo: h.kind === "offset" ? a.h.relativeTo : "column",
    hPct: h.kind === "percent" ? String(h.value / 1000) : "0",
    hPctTo: h.kind === "percent" ? a.h.relativeTo : "page",
    vMode: v.kind === "align" ? "align" : v.kind === "percent" ? "relative" : "absolute",
    vAlign: v.kind === "align" ? v.value : "top",
    vAlignTo: v.kind === "align" ? a.v.relativeTo : "page",
    vAbs: v.kind === "offset" ? cmText(v.value) : "0",
    vAbsTo: v.kind === "offset" ? a.v.relativeTo : "paragraph",
    vPct: v.kind === "percent" ? String(v.value / 1000) : "0",
    vPctTo: v.kind === "percent" ? a.v.relativeTo : "page",
    moveWithText: a.v.relativeTo === "paragraph" || a.v.relativeTo === "line",
    lockAnchor: !!a.locked,
    allowOverlap: a.allowOverlap,
    layoutInCell: a.layoutInCell ?? true,
  };
}

/** The anchor of the Position tab's values (`base` gives wrapping, distances, z-order), or null when a number is not valid. */
export function anchorOfLayout(v: LayoutValues, base: Anchor): Anchor | null {
  const h =
    v.hMode === "align"
      ? { relativeTo: v.hAlignTo, place: { kind: "align" as const, value: v.hAlign } }
      : v.hMode === "absolute"
        ? Number.isFinite(num(v.hAbs)) ? { relativeTo: v.hAbsTo, place: { kind: "offset" as const, value: Math.round(num(v.hAbs) * EMU_PER_CM) } } : null
        : Number.isFinite(num(v.hPct)) ? { relativeTo: v.hPctTo, place: { kind: "percent" as const, value: Math.round(num(v.hPct) * 1000) } } : null;
  let vp =
    v.vMode === "align"
      ? { relativeTo: v.vAlignTo, place: { kind: "align" as const, value: v.vAlign } }
      : v.vMode === "absolute"
        ? Number.isFinite(num(v.vAbs)) ? { relativeTo: v.vAbsTo, place: { kind: "offset" as const, value: Math.round(num(v.vAbs) * EMU_PER_CM) } } : null
        : Number.isFinite(num(v.vPct)) ? { relativeTo: v.vPctTo, place: { kind: "percent" as const, value: Math.round(num(v.vPct) * 1000) } } : null;
  if (!h || !vp) return null;
  // Move object with text: positions from the paragraph; unchecked, an absolute position from the paragraph becomes one from the page.
  if (!v.moveWithText && (vp.relativeTo === "paragraph" || vp.relativeTo === "line")) vp = { ...vp, relativeTo: "page" };
  const out: Anchor = { ...base, h, v: vp, allowOverlap: v.allowOverlap };
  if (v.lockAnchor) out.locked = true;
  else delete out.locked;
  if (v.layoutInCell) delete out.layoutInCell;
  else out.layoutInCell = false;
  return out;
}

export function LayoutDialog({ open, anchor, onSubmit, onClose }: { open: boolean; anchor: Anchor | null; onSubmit: (a: Anchor) => void; onClose: () => void }) {
  const tr = useT();
  const [v, setV] = useState<LayoutValues | null>(anchor ? layoutValues(anchor) : null);
  useEffect(() => {
    if (open) setV(anchor ? layoutValues(anchor) : null);
  }, [open, anchor]);
  const set = (p: Partial<LayoutValues>) => setV((cur) => (cur ? { ...cur, ...p } : cur));
  const result = v && anchor ? anchorOfLayout(v, anchor) : null;
  const sel = <T extends string>(label: string, value: T, options: T[], key: (o: T) => string, on: (o: T) => void, disabled = false) => (
    <select aria-label={label} className={`${INPUT} w-36`} value={value} disabled={disabled} onChange={(e) => on(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {tr(key(o))}
        </option>
      ))}
    </select>
  );
  const axis = (which: "h" | "v") => {
    if (!v) return null;
    const isH = which === "h";
    const mode = isH ? v.hMode : v.vMode;
    const name = tr(isH ? "write.layout.horizontal" : "write.layout.vertical");
    const radio = (m: PosMode, label: string) => (
      <label className="flex w-36 items-center gap-1">
        <input type="radio" name={`pos-${which}`} checked={mode === m} onChange={() => set(isH ? { hMode: m } : { vMode: m })} />
        {label}
      </label>
    );
    return (
      <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2" aria-label={name}>
        <legend className="px-1 text-xs font-medium">{name}</legend>
        <div className="flex items-center gap-2">
          {radio("align", tr("write.layout.alignment"))}
          {isH
            ? sel(tr("write.layout.hAlign"), v.hAlign, ["left", "center", "right"] as HAlign[], (o) => `write.layout.h.${o}`, (o) => set({ hAlign: o }), mode !== "align")
            : sel(tr("write.layout.vAlign"), v.vAlign, ["top", "center", "bottom"] as VAlignPos[], (o) => `write.layout.v.${o}`, (o) => set({ vAlign: o }), mode !== "align")}
          <span className="text-xs">{tr("write.layout.relativeTo")}</span>
          {isH
            ? sel(tr("write.layout.hAlignTo"), v.hAlignTo, H_ALIGN_TO, (o) => `write.rel.${o}`, (o) => set({ hAlignTo: o }), mode !== "align")
            : sel(tr("write.layout.vAlignTo"), v.vAlignTo, V_ALIGN_TO, (o) => `write.rel.${o}`, (o) => set({ vAlignTo: o }), mode !== "align")}
        </div>
        <div className="flex items-center gap-2">
          {radio("absolute", tr("write.layout.absolute"))}
          <input aria-label={tr(isH ? "write.layout.hAbs" : "write.layout.vAbs")} className={`${INPUT} w-36`} disabled={mode !== "absolute"} value={isH ? v.hAbs : v.vAbs} onChange={(e) => set(isH ? { hAbs: e.target.value } : { vAbs: e.target.value })} />
          <span className="text-xs">{tr(isH ? "write.layout.toTheRightOf" : "write.layout.below")}</span>
          {isH
            ? sel(tr("write.layout.hAbsTo"), v.hAbsTo, H_ALIGN_TO, (o) => `write.rel.${o}`, (o) => set({ hAbsTo: o }), mode !== "absolute")
            : sel(tr("write.layout.vAbsTo"), v.vAbsTo, V_ABS_TO, (o) => `write.rel.${o}`, (o) => set({ vAbsTo: o }), mode !== "absolute")}
        </div>
        <div className="flex items-center gap-2">
          {radio("relative", tr("write.layout.relative"))}
          <input aria-label={tr(isH ? "write.layout.hPct" : "write.layout.vPct")} className={`${INPUT} w-36`} disabled={mode !== "relative"} value={isH ? v.hPct : v.vPct} onChange={(e) => set(isH ? { hPct: e.target.value } : { vPct: e.target.value })} />
          <span className="text-xs">{tr("write.layout.relativeTo")}</span>
          {isH
            ? sel(tr("write.layout.hPctTo"), v.hPctTo, H_PCT_TO, (o) => `write.rel.${o}`, (o) => set({ hPctTo: o }), mode !== "relative")
            : sel(tr("write.layout.vPctTo"), v.vPctTo, V_PCT_TO, (o) => `write.rel.${o}`, (o) => set({ vPctTo: o }), mode !== "relative")}
        </div>
      </fieldset>
    );
  };
  const check = (key: "moveWithText" | "lockAnchor" | "allowOverlap" | "layoutInCell") =>
    v && (
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={v[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<LayoutValues>)} />
        {tr(`write.layout.${key}`)}
      </label>
    );
  return (
    <Dialog open={open} title={tr("write.layout.title")} onClose={onClose}>
      <form
        className="flex flex-col gap-2 text-sm"
        data-testid="layout-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (result) onSubmit(result);
        }}
      >
        {!anchor ? (
          <p className="text-xs text-ui-muted">{tr("write.layout.inline")}</p>
        ) : (
          <>
            {axis("h")}
            {axis("v")}
            <fieldset className="grid grid-cols-2 gap-1 rounded border border-ui-border p-2">
              <legend className="px-1 text-xs font-medium">{tr("write.layout.options")}</legend>
              {check("moveWithText")}
              {check("allowOverlap")}
              {check("lockAnchor")}
              {check("layoutInCell")}
            </fieldset>
          </>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button type="submit" className={BUTTON} disabled={!result}>
            {tr("common.ok")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {tr("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The Layout dialog for the selected picture or drawing (Position ▾ › More Layout Options…). */
export function LayoutDialogHost({ editor, features }: { editor: Editor; features: WriteFeatures }) {
  const ui = features.ui;
  const dialog = useSyncExternalStore(ui.subscribe, () => ui.getState().dialog);
  const obj = dialog === "layout" ? selectedObject(editor) : null;
  const anchor = obj ? anchorOfNode(obj.node) : null;
  const close = () => {
    ui.openDialog(null);
    editor.commands.focus();
  };
  return (
    <LayoutDialog
      open={dialog === "layout"}
      anchor={anchor}
      onClose={close}
      onSubmit={(a) => {
        if (obj) setAnchorAt(editor, obj.pos, a);
        close();
      }}
    />
  );
}
