// Over the editor stage (P8-8): the animation number badges next to the
// animated shapes (while the Animations tab or the Animation pane is
// shown, like PowerPoint; a badge selects its animation) and the Preview
// of the Transitions / Animations tabs, played on the stage itself.

import { useEffect, useMemo } from "react";
import type { Slide } from "../generated/Slide";
import { badgesByShape } from "../anim/effects";
import { clickGroups, clickSteps, transitionFrames } from "../anim/playback";
import { boundsPx } from "../geometry";
import { findShape } from "../model";
import { AnimatedSlide, ShowSlide, type SlideVisit } from "../present/AnimatedSlide";
import { useShow, type ShowStore } from "../state/store";
import type { DeckContext } from "./SlideView";
import { useT } from "../i18n";

export function AnimBadges({ store, slide, scale }: { store: ShowStore; slide: Slide; scale: number }) {
  const t = useT();
  const tab = useShow(store, (s) => s.ribbonTab);
  const pane = useShow(store, (s) => s.animPane);
  const selected = useShow(store, (s) => s.animSelection);
  const badges = useMemo(() => badgesByShape(slide.animations ?? []), [slide.animations]);
  if ((tab !== "animations" && !pane) || badges.size === 0) return null;
  return (
    <>
      {[...badges].map(([shapeId, list]) => {
        const hit = findShape(slide.shapes, shapeId);
        if (!hit) return null;
        const b = boundsPx(hit.top.transform);
        return (
          <div
            key={shapeId}
            className="absolute z-10 flex flex-col gap-0.5"
            style={{ left: Math.max(0, b.x * scale - 22), top: Math.max(0, b.y * scale) }}
          >
            {list.map((badge) => (
              <button
                key={badge.id}
                type="button"
                data-testid="anim-badge"
                aria-label={t("show.animBadge", { n: badge.n })}
                aria-pressed={badge.id === selected}
                className={`flex h-5 min-w-5 items-center justify-center rounded-sm border px-0.5 text-[11px] leading-none shadow-sm ${badge.id === selected ? "border-orange-700 bg-orange-600 text-white" : "border-gray-400 bg-white text-gray-800"}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => store.selectAnimation(badge.id)}
              >
                {badge.n}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** A black slide: what a transition preview of the first slide comes from. */
const blackSlide = (id: number): Slide => ({ id, layout: "blank", shapes: [], background: { kind: "fill", value: { kind: "solid", value: { kind: "rgb", value: "000000" } } } });

export function StagePreview({ store, deck, slides, index, width, height }: {
  store: ShowStore;
  deck: DeckContext;
  slides: Slide[];
  index: number;
  width: number;
  height: number;
}) {
  const preview = useShow(store, (s) => s.preview);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const slide = slides[index];
  const seq = preview?.seq ?? 0;
  const pair = useMemo(() => (slide ? [slides[index - 1] ?? blackSlide(-1), slide] : []), [slides, index, slide]);
  const visit = useMemo<SlideVisit>(
    () => ({
      index: 1,
      forward: true,
      from: 0,
      fromStep: pair[0] ? clickSteps(pair[0]) : 0,
      seq,
      entry: { played: true },
      transition: { played: false },
    }),
    [pair, seq],
  );
  // The transition preview ends by itself (ShowSlide has no "done" callback).
  useEffect(() => {
    if (preview?.kind !== "transition" || !slide) return;
    const timer = window.setTimeout(() => store.endPreview(), transitionFrames(slide.transition).durationMs + 60);
    return () => window.clearTimeout(timer);
  }, [preview, slide, store]);
  // Esc or a click stops it.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.endPreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, store]);
  if (!preview || !slide) return null;
  return (
    <div
      className="absolute inset-0 z-20 bg-black"
      data-testid="stage-preview"
      data-kind={preview.kind}
      onPointerDown={(e) => {
        e.stopPropagation();
        store.endPreview();
      }}
    >
      {preview.kind === "transition" ? (
        <ShowSlide key={seq} deck={deck} slides={pair} visit={visit} step={0} media={store.media} mediaVersion={mediaVersion} width={width} height={height} />
      ) : (
        <AnimatedSlide
          key={seq}
          deck={deck}
          slide={slide}
          media={store.media}
          mediaVersion={mediaVersion}
          width={width}
          height={height}
          step={Math.max(0, clickGroups(slide).length - 1)}
          playAll
          onPlayed={() => store.endPreview()}
        />
      )}
    </div>
  );
}
