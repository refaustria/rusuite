// The slide show screen: a frontend-only render of the model (ADR 0008),
// used full-window by F5 and in the audience window of the presenter view.
// Fullscreen via the Fullscreen API, falling back to a full-window overlay;
// the slide is scaled to the screen. Keys and clicks become `ShowAction`s
// (showState.ts); a blanked screen and the "End of slide show" slide are
// drawn here; the mouse pointer hides after 3 s without movement. The
// slide itself is a `ShowSlide` (P8-8): its transition when moving forward,
// its animations step by step.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Layer, Stage } from "react-konva";
import type { Slide } from "../generated/Slide";
import { fitScale, slidePx } from "../geometry";
import { SlideView, type DeckContext } from "../canvas/SlideView";
import { clickAction, keyAction, type ShowAction, type ShowState } from "./showState";
import { nextVisit, ShowSlide, type SlideVisit } from "./AnimatedSlide";
import { ShowOverlay } from "./ShowOverlay";
import { stopShowSounds } from "./sounds";
import { InkLayer, SeeAll, ToolBar, slideBox, toolsCapture, typingIn, useToolKeys, useTools, zoomTransform, type ToolsState } from "./ShowTools";
import { linkAction } from "../links/regions";
import type { Hyperlink } from "../generated/Hyperlink";
import { useT } from "../i18n";
import { lockLandscape, swipeAction, tapAction, TouchShowOverlay } from "./TouchShow";

export const IDLE_CURSOR_MS = 3000;

/** A touch screen (phones, tablets, touch laptops). */
const touchScreen = () => typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;

/** One slide scaled into `width` × `height` (letterboxed by the caller). */
export function SlideImage({
  deck, slide, media, mediaVersion, width, height,
}: { deck: DeckContext; slide: Slide; media: ReadonlyMap<number, string>; mediaVersion: number; width: number; height: number }) {
  const scale = fitScale(width, height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  if (scale <= 0) return null;
  return (
    <Stage width={px.width * scale} height={px.height * scale} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} />
      </Layer>
    </Stage>
  );
}

/** Keys of the show on `window` (capture phase, before the editor's shortcuts). */
export function useShowKeys(onAction: (a: ShowAction) => void, enabled = true) {
  const ref = useRef(onAction);
  ref.current = onAction;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e)) return;
      const a = keyAction(e.key);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current(a);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}

export interface PresenterProps {
  deck: DeckContext;
  slides: Slide[];
  media: ReadonlyMap<number, string>;
  mediaVersion: number;
  show: ShowState;
  onAction: (a: ShowAction) => void;
  /** Leaving fullscreen (Esc) ends the show (single-window show); else it only leaves fullscreen. */
  fullscreenExits?: boolean;
  /** Drawn over the slide (the notes overlay of the single-window fallback). */
  overlay?: ReactNode;
  /** The slide-show tools (pointer options, ink, see all slides, zoom; P8-28): the main window's show. */
  tools?: boolean;
  /** More buttons of the tool bar (the rehearsal's). */
  toolbarExtra?: ReactNode;
  /** A link to a custom show was followed (P9-S3). */
  onCustomShow?: (id: number, returnAfter: boolean) => void;
  /** Set Up Slide Show › Pen color (`#RRGGBB`). */
  penColor?: string;
  /** The tools' state owned by the caller (the show keeps the ink to offer saving it at the end; P9-S5). */
  toolsState?: [ToolsState, (f: (s: ToolsState) => ToolsState) => void];
  /** The audience window of the presenter view: the presenter's ink, laser pointer and zoom, read-only. */
  mirror?: ToolsState;
  /** Slide Show › Show Media Controls (default shown). */
  mediaControls?: boolean;
}

const NO_FIRES: string[] = [];
const NO_SET = () => undefined;

export function Presenter({ deck, slides, media, mediaVersion, show, onAction, fullscreenExits = true, overlay, tools: toolsOn = false, toolbarExtra, onCustomShow, penColor, toolsState, mirror, mediaControls = true }: PresenterProps) {
  const t = useT();
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [idle, setIdle] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const enterFullscreen = () => {
    if (document.fullscreenElement) return;
    try {
      void root.current?.requestFullscreen?.()?.catch(() => undefined);
    } catch {
      // Fullscreen unavailable: the overlay still covers the window.
    }
  };

  useEffect(() => {
    enterFullscreen();
    // phones and tablets: landscape while the show runs (P10-M5; refused or unsupported: ignored)
    const unlock = touchScreen() ? lockLandscape() : () => undefined;
    const onFs = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current && fullscreenExits) actionRef.current({ type: "exit" }); // the user left fullscreen (Esc)
    };
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("resize", onResize);
      unlock();
      if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => undefined);
    };
  }, [fullscreenExits]);

  // The pointer hides after 3 s without movement.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    const onMove = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_CURSOR_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // The audience window cannot go fullscreen on its own (no user gesture yet): the first key or click does it.
  const act = (a: ShowAction) => {
    if (!fullscreenExits && !entered.current) enterFullscreen();
    onAction(a);
  };
  // the tools' keys first: they take Esc while zoomed / drawing
  const own = useTools(penColor);
  const [tools, setTools] = mirror ? [mirror, NO_SET] : (toolsState ?? own);
  const zoomed = toolsOn || !!mirror;
  const pointerAt = useRef({ x: 0.5, y: 0.5 });
  useToolKeys(setTools, slides[show.index]?.id, pointerAt, toolsOn);
  useShowKeys(act);

  // The visit of the current slide survives a blank screen (its transition and entry play once).
  const visitRef = useRef<SlideVisit | null>(null);
  const lastStep = useRef(show.step);
  const visit = nextVisit(visitRef.current, show.index, lastStep.current);
  visitRef.current = visit;
  useEffect(() => {
    lastStep.current = show.step;
  });

  // the slide shown before the current one (the action button "Return")
  const lastViewed = useRef<{ index: number; prev: number | null }>({ index: show.index, prev: null });
  if (lastViewed.current.index !== show.index) lastViewed.current = { index: show.index, prev: lastViewed.current.index };
  const follow = (link: Hyperlink) => {
    const a = linkAction(link, slides.map((s) => s.id));
    switch (a.kind) {
      case "goto": return act({ type: "goto", index: a.index });
      case "first": return act({ type: "first" });
      case "last": return act({ type: "last" });
      case "next": return act({ type: "next" });
      case "previous": return act({ type: "prev" });
      case "back": {
        const prev = lastViewed.current.prev;
        return prev === null ? undefined : act({ type: "goto", index: prev });
      }
      case "end": return act({ type: "exit" });
      case "customShow": return onCustomShow?.(a.id, a.returnAfter);
      default: return undefined;
    }
  };

  // triggers fired on the current slide (a click on a trigger shape, a media bookmark), in order
  const [fires, setFires] = useState<{ index: number; keys: string[] }>({ index: show.index, keys: [] });
  const fired = fires.index === show.index ? fires.keys : NO_FIRES;
  const onTrigger = (key: string) => setFires((f) => ({ index: show.index, keys: [...(f.index === show.index ? f.keys : []), key] }));
  useEffect(() => () => stopShowSounds(), []);

  // ----- touch (P10-M5): swipes, taps on the thirds, a long press for the show menu
  const press = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const tapTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);
  /** The last pointer was a finger (its click is a tap; its long press opens the menu). */
  const lastTouch = useRef(0);
  const swiped = useRef(0);
  const [touchMenu, setTouchMenu] = useState(false);

  const slide = slides[show.index];
  const blank = show.ended ? "black" : show.blank;
  return (
    <div
      ref={root}
      role="dialog"
      aria-label={t("show.presentation")}
      data-testid="presenter"
      data-blank={show.blank}
      data-step={show.step}
      data-fired={fired.join(" ") || undefined}
      data-ended={show.ended ? "true" : undefined}
      data-idle={idle ? "true" : undefined}
      className={`fixed inset-0 z-50 flex select-none items-center justify-center ${blank === "white" ? "bg-white" : "bg-black"} ${idle ? "cursor-none" : "cursor-pointer"}`}
      data-tool={toolsOn ? tools.mode : undefined}
      data-zoom={zoomed && tools.zoom > 1 ? tools.zoom : undefined}
      style={{ touchAction: "none" }}
      onPointerMove={(e) => {
        pointerAt.current = { x: e.clientX / (window.innerWidth || 1), y: e.clientY / (window.innerHeight || 1) };
      }}
      onPointerDownCapture={(e) => {
        // also under the ink layer, which keeps its presses: its long press opens the menu too
        if (e.pointerType === "touch") lastTouch.current = Date.now();
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        // a new press: the click of an earlier swipe is no longer pending
        swiped.current = 0;
        press.current = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() } : null;
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p || p.id !== e.pointerId || mirror || (toolsOn && toolsCapture(tools))) return;
        const a = swipeAction(e.clientX - p.x, e.clientY - p.y);
        if (!a) {
          // A tap shortly after a swipe may get no click from the browser (it ends the "fling"): if none comes,
          // the tap acts on its own. A click (also one a link or button keeps) cancels this in the capture phase.
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 10 && Date.now() - p.t < 500) {
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            const w = r.width || window.innerWidth;
            window.clearTimeout(tapTimer.current);
            tapTimer.current = window.setTimeout(() => {
              tapTimer.current = 0;
              act(tapAction(x, w));
            }, 350);
          }
          return;
        }
        swiped.current = Date.now();
        act(a);
      }}
      onClickCapture={() => {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = 0;
      }}
      onPointerCancel={() => (press.current = null)}
      onContextMenu={(e) => {
        // a long press (touch): the show menu; a right click keeps the browser's
        if (Date.now() - lastTouch.current > 1500 || mirror) return;
        e.preventDefault();
        press.current = null;
        setTouchMenu(true);
      }}
      onClick={(e) => {
        if (toolsOn && toolsCapture(tools)) return;
        if (Date.now() - swiped.current < 600) return;
        const r = e.currentTarget.getBoundingClientRect();
        const w = r.width || window.innerWidth;
        const touchTap = (e.nativeEvent as PointerEvent).pointerType === "touch" || Date.now() - lastTouch.current < 800;
        act(touchTap ? tapAction(e.clientX - r.left, w) : clickAction(e.clientX - r.left, w));
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center" style={{ transform: zoomed ? zoomTransform(tools, size.width, size.height) : undefined, transformOrigin: "0 0" }}>
        {blank === "none" && slide && (
          <ShowSlide deck={deck} slides={slides} visit={visit} step={show.step} media={media} mediaVersion={mediaVersion} width={size.width} height={size.height} fired={fired} />
        )}
        {blank === "none" && slide && !show.ended && <ShowOverlay key={slide.id} deck={deck} slide={slide} step={show.step} media={media} width={size.width} height={size.height} onLink={follow} fired={fired} onTrigger={onTrigger} controls={mediaControls} />}
        {zoomed && blank === "none" && slide && !show.ended && (
          <InkLayer tools={tools} setTools={setTools} slide={slide} box={slideBox(deck, size.width, size.height)} scale={slideBox(deck, size.width, size.height).scale} readOnly={!!mirror} />
        )}
      </div>
      {toolsOn && tools.seeAll && (
        <SeeAll
          deck={deck}
          slides={slides}
          media={media}
          current={show.index}
          width={size.width}
          onPick={(i) => {
            setTools((s) => ({ ...s, seeAll: false }));
            act({ type: "goto", index: i });
          }}
        />
      )}
      {toolsOn && !show.ended && (
        <ToolBar tools={tools} setTools={setTools} visible={!idle} onPrev={() => act({ type: "prev" })} onNext={() => act({ type: "next" })} extra={toolbarExtra} />
      )}
      {show.ended && (
        <span className="absolute left-0 right-0 top-6 text-center text-sm text-white/70" data-testid="presenter-end">
          {t("show.endClick")}
        </span>
      )}
      {blank === "none" && !show.ended && (
        <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-white/40" data-testid="presenter-counter">
          {show.index + 1} / {slides.length}
        </span>
      )}
      {overlay}
      {touchMenu && (
        <TouchShowOverlay
          deck={deck}
          slides={slides}
          media={media}
          current={show.index}
          width={size.width}
          tools={toolsOn ? tools : undefined}
          setTools={toolsOn ? setTools : undefined}
          onGoto={(i) => {
            setTouchMenu(false);
            act({ type: "goto", index: i });
          }}
          onExit={() => {
            setTouchMenu(false);
            act({ type: "exit" });
          }}
          onClose={() => setTouchMenu(false)}
        />
      )}
    </div>
  );
}
