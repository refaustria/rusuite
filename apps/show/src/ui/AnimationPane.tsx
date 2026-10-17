// The Animation pane (P8-8, P9-S4): the current slide's animations in play
// order on the right of the stage, like PowerPoint's: the click number,
// the kind's star, the shape and the effect; triggered animations under a
// "Trigger:" heading per trigger, paragraph builds marked. Click (or arrow
// keys) selects an animation for the Animations tab; drag a row by its
// grip (pointer events, so touch works) to reorder (`reorderAnimation`);
// Move Earlier / Later move click steps like PowerPoint (`moveOrder`); the
// bin or Delete removes it; Timing… opens the timing dialog; Play All
// previews the slide on the stage.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RibbonIcon } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import { clickNumbers, effectKey, reorderTarget, sameStartOn, triggerKey } from "../anim/effects";
import { findShape } from "../model";
import { useShow, type ShowStore } from "../state/store";
import { EffectIcon } from "./AnimTabs";
import { useT } from "../i18n";

const BTN = "flex h-8 min-w-8 items-center justify-center rounded px-1 text-xs hover:bg-ui-hover disabled:opacity-40";

export function AnimationPane({ store }: { store: ShowStore }) {
  const t = useT();
  const open = useShow(store, (s) => s.animPane);
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const selected = useShow(store, (s) => s.animSelection);
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: NodeId; from: number; before: number } | null>(null);
  if (!open) return null;

  const slide = pres?.slides.find((s) => s.id === current) ?? null;
  const anims = slide?.animations ?? [];
  const nums = clickNumbers(anims);
  const index = anims.findIndex((a) => a.id === selected);

  /** The row the pointer is over: insert before the first row whose middle is below it. */
  const beforeAt = (y: number) => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-anim-row]") ?? []);
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };
  const onGripDown = (e: ReactPointerEvent, id: NodeId, from: number) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    store.selectAnimation(id);
    setDrag({ id, from, before: from });
  };
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const before = beforeAt(e.clientY);
    if (before !== drag.before) setDrag({ ...drag, before });
  };
  const onGripUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const to = reorderTarget(drag.from, beforeAt(e.clientY), anims.length);
    setDrag(null);
    if (to !== null) void store.reorderAnimation(drag.id, to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!anims.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const n = Math.max(0, Math.min(anims.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
      if (e.altKey) void store.moveAnimation(e.key === "ArrowDown" ? 1 : -1);
      else store.selectAnimation(anims[n]!.id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) void store.removeAnimation(selected);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <aside aria-label={t("show.animPane")} data-testid="animation-pane" className="flex w-64 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-ui-fg">
      <div className="flex items-center gap-1 border-b border-ui-border px-2 py-1">
        <span className="flex-1 text-sm font-semibold">{t("show.animPane")}</span>
        <button type="button" className={BTN} title={t("show.close")} aria-label={t("show.close")} onClick={() => store.toggleAnimPane(false)}>
          <RibbonIcon name="close" />
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-ui-border px-2 py-1">
        <button type="button" className={`${BTN} border border-ui-border px-2`} disabled={!anims.length} onClick={() => store.startPreview("animations")}>
          ▶ {t("show.playAll")}
        </button>
        <span className="ml-auto" />
        <button type="button" className={BTN} aria-label={t("show.timingDialog")} title={t("show.timingDialog")} disabled={index < 0} onClick={() => store.openDialog({ kind: "animTiming", tab: "timing" })}>
          <RibbonIcon name="options" />
        </button>
        <button type="button" className={BTN} aria-label={t("show.moveEarlier")} title={t("show.moveEarlier")} disabled={index < 0 || !store.canMoveAnimation(-1)} onClick={() => void store.moveAnimation(-1)}>
          <RibbonIcon name="chevronUp" />
        </button>
        <button type="button" className={BTN} aria-label={t("show.moveLater")} title={t("show.moveLater")} disabled={index < 0 || !store.canMoveAnimation(1)} onClick={() => void store.moveAnimation(1)}>
          <RibbonIcon name="chevronDown" />
        </button>
      </div>
      {anims.length === 0 ? (
        <p className="p-3 text-xs text-ui-muted">{t("show.noAnimations")}</p>
      ) : (
        <ol
          ref={list}
          role="listbox"
          tabIndex={0}
          aria-label={t("show.animations")}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1 outline-none"
          onKeyDown={onKeyDown}
        >
          {anims.map((a, i) => {
            const shape = slide ? findShape(slide.shapes, a.shape)?.shape : undefined;
            const name = shape?.name || t("show.shapeN", { n: a.shape });
            const effect = t(effectKey(a.effect, a.kind));
            const showNum = a.trigger === "onClick" || i === 0;
            // a heading before the first animation of each trigger
            const trigger = a.startOn && !sameStartOn(anims[i - 1]?.startOn, a.startOn) ? a.startOn : null;
            const triggerName = trigger
              ? trigger.kind === "click"
                ? (slide && findShape(slide.shapes, trigger.value)?.shape.name) || t("show.shapeN", { n: trigger.value })
                : trigger.value.name
              : "";
            return (
              <li key={`row-${a.id}`} role="presentation" className="contents">
              {trigger && (
                <div className="mt-1 flex h-6 items-center gap-1 border-t border-ui-border px-1 text-[11px] font-semibold text-ui-muted" data-testid="anim-trigger-heading">
                  ⚡ {t("show.paneTrigger", { name: triggerName })}
                </div>
              )}
              <div
                key={a.id}
                data-anim-row=""
                data-testid="anim-row"
                role="option"
                aria-selected={a.id === selected}
                aria-label={`${nums[i]} ${name}: ${effect}`}
                title={`${t(triggerKey(a.trigger))} – ${effect}`}
                className={`relative flex h-8 cursor-pointer items-center gap-1 rounded px-1 text-xs ${a.id === selected ? "bg-ui-active" : "hover:bg-ui-hover"} ${drag?.id === a.id ? "opacity-50" : ""}`}
                onClick={() => store.selectAnimation(a.id)}
              >
                {drag && drag.before === i && <span data-testid="anim-drop" className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 bg-orange-600" />}
                {drag && drag.before === anims.length && i === anims.length - 1 && (
                  <span data-testid="anim-drop" className="pointer-events-none absolute -bottom-0.5 left-0 right-0 h-0.5 bg-orange-600" />
                )}
                <span
                  className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-ui-muted"
                  aria-hidden="true"
                  data-testid="anim-grip"
                  onPointerDown={(e) => onGripDown(e, a.id, i)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                  onPointerCancel={() => setDrag(null)}
                >
                  ⋮⋮
                </span>
                <span className="w-4 shrink-0 text-right tabular-nums" data-testid="anim-number">
                  {showNum ? nums[i] : a.trigger === "afterPrevious" ? "⏱" : ""}
                </span>
                <EffectIcon kind={a.kind} effect={a.effect} size={18} />
                <span className="min-w-0 flex-1 truncate">
                  {name}
                  {a.build && <span className="ml-1 text-ui-muted" title={t("show.opt.byParagraph")} data-testid="anim-build">¶</span>}
                </span>
                <span className="shrink-0 truncate text-ui-muted">{effect}</span>
                <button
                  type="button"
                  className={BTN}
                  aria-label={t("show.removeAnim", { name })}
                  title={t("show.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void store.removeAnimation(a.id);
                  }}
                >
                  <RibbonIcon name="trash" size={14} />
                </button>
              </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
