// A slide with its animations (P8-8), used by the slide show, the
// presenter view and the editor's Preview: the still state of a click step
// (shapes hidden / scaled by the animations so far), the next group played
// when the step goes up by one, the automatic group when the slide was
// entered, or the whole sequence (Preview). `ShowSlide` adds the
// transition from the previous slide (two slide pictures animated with the
// Web Animations API).

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { fitScale, slidePx } from "../geometry";
import { SlideView, type DeckContext } from "../canvas/SlideView";
import { applyStates, playGroups } from "../anim/driver";
import { clickGroups, hiddenShapes, shapeStates, transitionFrames } from "../anim/playback";

/** "Play the automatic animations once": shared by the remounts of one visit of a slide (blank screen in between). */
export interface EntryToken {
  played: boolean;
}

export interface AnimatedSlideProps {
  deck: DeckContext;
  slide: Slide;
  media: ReadonlyMap<number, string>;
  mediaVersion: number;
  width: number;
  height: number;
  /** Click steps done (0 = only the automatic group). */
  step: number;
  /** Plays the automatic group (once per token), after `entryDelayMs`. */
  entry?: EntryToken;
  entryDelayMs?: number;
  /** Plays every group one after the other (the editor's Preview), then calls `onPlayed`. */
  playAll?: boolean;
  /** No animation, just the state of `step`. */
  still?: boolean;
  onPlayed?: () => void;
}

export function AnimatedSlide({ deck, slide, media, mediaVersion, width, height, step, entry, entryDelayMs = 0, playAll, still, onPlayed }: AnimatedSlideProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const groups = useMemo(() => clickGroups(slide), [slide]);
  const target = playAll ? groups.length : Math.min(step, groups.length - 1) + 1;
  /** The last plan: what was shown (`target`) and played (`from`…`target`), and whether a cleanup cut it short. */
  const prev = useRef<{ id: NodeId; target: number; from: number; delay: number; cut: boolean } | null>(null);
  const played = useRef(onPlayed);
  played.current = onPlayed;
  const px = slidePx(deck.slideSize);
  const scale = fitScale(width, height, deck.slideSize);
  const hidden = useMemo(() => hiddenShapes(shapeStates(slide, target)).join(","), [slide, target]);

  useLayoutEffect(() => {
    const p = prev.current;
    let from = target;
    let delay = 0;
    if (!still) {
      if (playAll) from = 0;
      else if (p && p.id === slide.id && target === p.target + 1) from = p.target;
      else if (p && p.id === slide.id && target === p.target && p.cut) {
        // The same plan again after a cleanup cut it short (React's StrictMode remount).
        from = p.from;
        delay = p.delay;
      } else if (entry && !entry.played && target === 1) {
        entry.played = true;
        from = 0;
        delay = entryDelayMs;
      }
    }
    const plan = { id: slide.id, target, from, delay, cut: false };
    prev.current = plan;
    const done = () => played.current?.();
    const stage = stageRef.current;
    // Under test renderers there is no Konva stage: the state is only reported.
    if (!stage?.findOne) {
      if (playAll) done();
      return;
    }
    applyStates(stage, shapeStates(slide, from));
    if (from >= target) {
      if (playAll) done();
      return;
    }
    let running = true;
    const cancel = playGroups(stage, groups.slice(from, target), delay, slidePx(deck.slideSize), () => {
      running = false;
      applyStates(stage, shapeStates(slide, target));
      done();
    });
    return () => {
      if (!running) return;
      plan.cut = true;
      cancel();
    };
  }, [slide, target, still, playAll, groups, deck.slideSize]);

  if (scale <= 0) return null;
  return (
    <div data-testid="animated-slide" data-slide={slide.id} data-step={step} data-hidden-shapes={hidden} style={{ width: px.width * scale, height: px.height * scale }}>
      <Stage ref={stageRef} width={px.width * scale} height={px.height * scale} scaleX={scale} scaleY={scale} listening={false}>
        <Layer listening={false}>
          <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} />
        </Layer>
      </Stage>
    </div>
  );
}

/** A visit of a slide in the show: which slide was left for it, and whether the transition and entry play. */
export interface SlideVisit {
  index: number;
  /** Moved forward to it (the transition and the automatic animations play). */
  forward: boolean;
  /** The slide left (`-1` = none: the show started here). */
  from: number;
  /** Click step the left slide was on. */
  fromStep: number;
  seq: number;
  entry: EntryToken;
  /** The transition to it played (or was skipped). */
  transition: EntryToken;
}

/** Tracks visits across renders (`ref` holds the last one; a new index starts a new visit). */
export function nextVisit(last: SlideVisit | null, index: number, lastStep: number): SlideVisit {
  if (last && last.index === index) return last;
  return {
    index,
    forward: !last || index > last.index,
    from: last ? last.index : -1,
    fromStep: lastStep,
    seq: (last?.seq ?? 0) + 1,
    entry: { played: false },
    transition: { played: false },
  };
}

export interface ShowSlideProps {
  deck: DeckContext;
  slides: Slide[];
  visit: SlideVisit;
  step: number;
  media: ReadonlyMap<number, string>;
  mediaVersion: number;
  width: number;
  height: number;
}

const animatable = (el: HTMLElement | null): el is HTMLElement & { animate: Element["animate"] } => !!el && typeof el.animate === "function";

/** The current slide of the show with the transition from the previous one. */
export function ShowSlide({ deck, slides, visit, step, media, mediaVersion, width, height }: ShowSlideProps) {
  const slide = slides[visit.index];
  const old = visit.forward && visit.from >= 0 ? slides[visit.from] : undefined;
  const frames = useMemo(() => (old ? transitionFrames(slide?.transition) : transitionFrames(null)), [old, slide?.transition]);
  // The transition of a visit plays once (not again after a blank screen).
  const [playing, setPlaying] = useState<number | null>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (visit.transition.played) return;
    visit.transition.played = true;
    if (frames.durationMs > 0 && old) setPlaying(visit.seq);
  }, [visit, frames, old]);

  useLayoutEffect(() => {
    if (playing === null) return;
    const opts: KeyframeAnimationOptions = { duration: frames.durationMs, easing: "ease-in-out", fill: "both" };
    const anims = [
      frames.incoming && animatable(inRef.current) ? inRef.current.animate(frames.incoming, opts) : null,
      frames.outgoing && animatable(outRef.current) ? outRef.current.animate(frames.outgoing, opts) : null,
    ].filter((a): a is Animation => !!a);
    if (!anims.length) {
      setPlaying(null);
      return;
    }
    let alive = true;
    void Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (alive) setPlaying(null);
    });
    return () => {
      alive = false;
      anims.forEach((a) => a.cancel());
    };
  }, [playing, frames]);

  if (!slide) return null;
  const scale = fitScale(width, height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  const box = { width: px.width * scale, height: px.height * scale };
  const showOld = playing === visit.seq && old;
  return (
    <div className="relative overflow-hidden" style={box} data-testid="show-slide" data-transition={showOld ? slide.transition?.kind : undefined}>
      <div ref={inRef} className="absolute inset-0" style={{ zIndex: 1 }}>
        <AnimatedSlide
          deck={deck}
          slide={slide}
          media={media}
          mediaVersion={mediaVersion}
          width={width}
          height={height}
          step={step}
          entry={visit.entry}
          entryDelayMs={old ? frames.durationMs : 0}
        />
      </div>
      {showOld && (
        <div ref={outRef} className="absolute inset-0" style={{ zIndex: frames.outgoingOnTop ? 2 : 0 }}>
          <AnimatedSlide deck={deck} slide={old} media={media} mediaVersion={mediaVersion} width={width} height={height} step={visit.fromStep} still />
        </div>
      )}
    </div>
  );
}
