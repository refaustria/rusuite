// View › Reading View (P8-28): the slide show inside the window (no
// fullscreen), with transitions and animations, driven by the same state
// machine as the show (keys, clicks), and a status bar: slide counter,
// Previous, a Menu (go to a slide, End Show), Next, and buttons back to
// the Normal view and the Slide Sorter and to start the slide show. Esc
// returns to the Normal view.

import { useCallback, useMemo, useRef, useState } from "react";
import type { Slide } from "../generated/Slide";
import { useShow, type ShowStore } from "../state/store";
import { deckOf } from "../design/deck";
import { initialShow, reduceShow, type ShowAction, type ShowState } from "../present/showState";
import { showMeta, showSlideIds } from "../present/SlideShow";
import { nextVisit, ShowSlide, type SlideVisit } from "../present/AnimatedSlide";
import { clickAction } from "../present/showState";
import { useShowKeys } from "../present/Presenter";
import { useT } from "../i18n";

const BAR_PX = 32;

export function ReadingView({ store, onPresent }: { store: ShowStore; onPresent: () => void }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const [ids] = useState(() => showSlideIds(store.getState().pres?.slides ?? [], store.getState().current));
  const slides = useMemo(() => ids.map((id) => pres?.slides.find((s) => s.id === id)).filter((s): s is Slide => !!s), [ids, pres]);
  const [show, setShow] = useState<ShowState>(() => initialShow(ids.length, Math.max(0, ids.indexOf(store.getState().current ?? -1)), showMeta(slides)));
  const [menu, setMenu] = useState(false);
  const showRef = useRef(show);
  showRef.current = show;
  const leave = useCallback(() => store.setView("normal"), [store]);
  const dispatch = useCallback(
    (a: ShowAction) => {
      const next = reduceShow(showRef.current, a);
      if (next === "exit") {
        leave();
        return;
      }
      showRef.current = next;
      setShow(next);
      const id = ids[next.index];
      if (id !== undefined && store.getState().current !== id) store.selectSlide(id);
    },
    [ids, leave, store],
  );
  useShowKeys(dispatch);
  const visitRef = useRef<SlideVisit | null>(null);
  const visit = nextVisit(visitRef.current, show.index, show.step);
  visitRef.current = visit;
  const deck = useMemo(() => (pres ? deckOf(pres) : null), [pres]);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight - BAR_PX });
  const box = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth || window.innerWidth, height: el.clientHeight || window.innerHeight - BAR_PX });
    measure();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(el);
  }, []);
  if (!pres || !deck || !slides.length) return null;
  const blank = show.ended ? "black" : show.blank;
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-xs hover:bg-white/15";
  return (
    <div role="dialog" aria-label={t("show.view.reading")} data-testid="reading-view" data-step={show.step} className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <div
        ref={box}
        className={`relative flex min-h-0 flex-1 cursor-pointer items-center justify-center ${blank === "white" ? "bg-white" : ""}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          dispatch(clickAction(e.clientX - r.left, r.width || window.innerWidth));
        }}
      >
        {blank === "none" && <ShowSlide deck={deck} slides={slides} visit={visit} step={show.step} media={store.media} mediaVersion={mediaVersion} width={size.width} height={size.height} />}
        {show.ended && <span className="absolute inset-x-0 top-6 text-center text-sm text-white/70">{t("show.endClick")}</span>}
      </div>
      <div className="relative flex items-center gap-1 bg-neutral-800 px-2 text-xs" style={{ height: BAR_PX }} data-testid="reading-bar">
        <span data-testid="reading-counter">{t("show.slideOf", { n: show.index + 1, count: slides.length })}</span>
        <span className="ml-auto" />
        <button type="button" className={btn} aria-label={t("show.reading.previous")} title={t("show.reading.previous")} onClick={() => dispatch({ type: "prev" })}>◀</button>
        <button type="button" className={btn} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {t("show.reading.menu")}
        </button>
        <button type="button" className={btn} aria-label={t("show.reading.next")} title={t("show.reading.next")} onClick={() => dispatch({ type: "next" })}>▶</button>
        <span className="mx-2 h-4 w-px bg-white/30" />
        <button type="button" className={btn} onClick={leave}>{t("show.master.normal")}</button>
        <button type="button" className={btn} onClick={() => store.setView("sorter")}>{t("show.view.sorter")}</button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            store.setView("normal");
            onPresent();
          }}
        >
          {t("show.slideShow")}
        </button>
        {menu && (
          <div role="menu" aria-label={t("show.reading.menu")} className="absolute bottom-full right-24 mb-1 max-h-80 w-56 overflow-auto rounded bg-neutral-700 py-1 shadow-lg">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className="block h-8 w-full truncate px-3 text-left hover:bg-white/15"
                onClick={() => {
                  setMenu(false);
                  dispatch({ type: "goto", index: i });
                }}
              >
                {i + 1}. {slideTitle(s) || t("show.slideN", { n: i + 1 })}
              </button>
            ))}
            <div className="my-1 h-px bg-white/20" />
            <button type="button" role="menuitem" className="block h-8 w-full px-3 text-left hover:bg-white/15" onClick={leave}>
              {t("show.reading.end")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The text of a slide's title placeholder. */
export function slideTitle(s: Slide): string {
  const title = s.shapes.find((x) => x.placeholder === "title" || x.placeholder === "centeredTitle");
  const body = title?.kind.kind === "auto" ? title.kind.value.text : null;
  return body ? body.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").trim() : "";
}
