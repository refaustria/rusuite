// The overlay text editor (ADR 0008: no ProseMirror in Show): a
// `<textarea>` over the edited shape with matching font, size, colour and
// alignment, rotated with the shape and placed at the top, middle or
// bottom of the box like the shape's text anchor. Tab / Shift+Tab change
// the list level of the selected paragraphs; Ctrl+Shift+> / < grow and
// shrink the font. Blur, Esc and Ctrl+Enter commit (`SetTextBody`); focus
// moving into the toolbar (`[data-keep-edit]`) keeps the session open so
// toolbar formatting applies to the textarea selection.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Shape } from "../generated/Shape";
import type { Transform } from "../generated/Transform";
import { emuToPx, PX_PER_PT } from "../geometry";
import { css, effectiveParagraph, effectiveRun, findShape, fontFamily, placeholderDef, textOf, themePalette } from "../model";
import { useShow, type ShowStore } from "../state/store";
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

export function TextOverlay({ store, scale }: { store: ShowStore; scale: number }) {
  const t = useT();
  const editing = useShow(store, (s) => s.editing);
  const pres = useShow(store, (s) => s.pres);
  const revision = useShow(store, (s) => s.revision);
  const ref = useRef<HTMLTextAreaElement>(null);
  const slide = pres?.slides.find((s) => s.id === store.getState().current) ?? null;
  const hit = editing && slide ? findShape(slide.shapes, editing.shape) : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const e = store.getState().editing;
    if (e) el.setSelectionRange(e.start, e.end);
    // Only when the session starts.
  }, [editing?.shape]);

  // After a toolbar command (new revision) return the focus to the editor.
  useLayoutEffect(() => {
    const el = ref.current;
    const e = store.getState().editing;
    if (!el || !e || document.activeElement === el) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) return;
    el.focus();
    el.setSelectionRange(e.start, e.end);
  }, [revision, store]);

  // The textarea grows with its text; the wrapper places it by the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  if (!editing || !hit || !pres || !slide) return null;
  const tf = absoluteTransform(hit.shape, hit.parents);
  const body = textOf(hit.shape);
  const def = placeholderDef(pres, slide, hit.shape);
  const run = effectiveRun(def, body?.paragraphs[0]?.runs[0]?.props);
  const para = effectiveParagraph(def, body?.paragraphs[0]?.props);
  const palette = themePalette(pres.theme);
  const ins = body?.props.insets ?? { left: 91440, top: 45720, right: 91440, bottom: 45720 };
  const fontPx = ((run.size ?? 1800) / 100) * PX_PER_PT * scale;

  const commit = () => void store.commitEdit();
  const sync = (el: HTMLTextAreaElement) => store.updateEdit(el.value, el.selectionStart, el.selectionEnd);

  const anchor = body?.props.anchor ?? "top";
  const boxH = Math.max(emuToPx(tf.h) * scale, fontPx * 1.4);
  return (
    <div
      data-testid="text-overlay-box"
      data-anchor={anchor}
      className="absolute flex flex-col border border-dashed border-blue-500 bg-white/70"
      style={{
        left: emuToPx(tf.x) * scale,
        top: emuToPx(tf.y) * scale,
        width: emuToPx(tf.w) * scale,
        minHeight: boxH,
        justifyContent: anchor === "middle" ? "center" : anchor === "bottom" ? "flex-end" : "flex-start",
        transform: tf.rotationDeg ? `rotate(${tf.rotationDeg}deg)` : undefined,
        transformOrigin: "center",
        padding: `${emuToPx(ins.top) * scale}px ${emuToPx(ins.right) * scale}px ${emuToPx(ins.bottom) * scale}px ${emuToPx(ins.left) * scale}px`,
        boxSizing: "border-box",
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        aria-label={t("show.shapeText")}
        data-testid="text-overlay"
        value={editing.text}
        spellCheck={false}
        onChange={(e) => sync(e.currentTarget)}
        onSelect={(e) => sync(e.currentTarget)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const mod = e.ctrlKey || e.metaKey;
          if (e.key === "Escape" || (e.key === "Enter" && mod)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Tab" && !mod && !e.altKey) {
            e.preventDefault();
            sync(e.currentTarget);
            void store.indent(e.shiftKey ? -1 : 1);
          } else if (mod && e.shiftKey && (e.key === ">" || e.key === "<" || e.code === "Period" || e.code === "Comma")) {
            e.preventDefault();
            sync(e.currentTarget);
            void store.stepFont(e.key === ">" || e.code === "Period" ? 1 : -1, run.size ?? 1800);
          }
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (next && next.closest("[data-keep-edit]")) return;
          commit();
        }}
        className="w-full shrink-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
        style={{
          fontFamily: fontFamily(run.font, pres.theme),
          fontSize: fontPx,
          fontWeight: run.bold ? 700 : 400,
          fontStyle: run.italic ? "italic" : "normal",
          lineHeight: 1.2,
          color: css(run.color, palette) ?? "#000",
          textAlign: para.alignment === "justify" ? "justify" : (para.alignment ?? "left"),
        }}
      />
    </div>
  );
}
