// Runs a slide show from the main window (P7-8). `mode: "single"` is the
// full-window show (F5); `"presenter"` (Alt+F5) shows the presenter console
// here and the slide in an audience window, kept in sync over `SyncChannel`.
// When the audience window cannot be opened (popup blocked) the show falls
// back to the single-window show with a speaker notes overlay toggle.
//
// The slides of the show are fixed when it starts: hidden slides are
// skipped unless the show starts on one, as in PowerPoint. Each slide's
// click steps (its On Click animations) and "After" timing come from the
// model (P8-8); the timer here advances the show unless S stopped it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckContext } from "../canvas/SlideView";
import { deckOf, withDesignShapes } from "../design/deck";
import { pathCache, slideQueries } from "../shapes/paths";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { useShow, type ShowStore } from "../state/store";
import { Presenter } from "./Presenter";
import { PresenterConsole } from "./PresenterConsole";
import { initialShow, reduceShow, showRange, type ShowAction, type ShowMeta, type ShowState } from "./showState";
import { formatElapsed } from "./PresenterConsole";
import type { ShowSettings } from "../generated/ShowSettings";
import { autoAdvanceDelay, clickSteps } from "../anim/playback";
import type { AudienceLink, AudienceWindow, SyncChannel } from "./sync";
import { useT } from "../i18n";

export interface SlideShowProps {
  store: ShowStore;
  mode: "single" | "presenter";
  /** The audience window of a presenter view (`launchAudience()`, opened from the key or click handler). */
  link?: AudienceLink;
  onEnd: () => void;
  /** Slide Show › Rehearse Timings: records the time on each slide; at the end asks whether to keep them. */
  rehearse?: boolean;
}

/** The slides of a show starting at `current`: the visible ones, plus `current` itself when hidden. */
export function showSlideIds(slides: Slide[], current: NodeId | null): NodeId[] {
  return slides.filter((s) => !s.hidden || s.id === current).map((s) => s.id);
}

/** The slides as Set Up Slide Show wants them: without animations when asked, without "After" timings unless used. */
export function showSlides(slides: Slide[], settings: Pick<ShowSettings, "withoutAnimation" | "useTimings"> | undefined, rehearse = false): Slide[] {
  if (!settings?.withoutAnimation && settings?.useTimings !== false && !rehearse) return slides;
  return slides.map((s) => {
    const out: Slide = { ...s };
    if (settings?.withoutAnimation) delete out.animations;
    if ((settings?.useTimings === false || rehearse) && out.transition?.advanceAfterMs !== undefined) {
      const tr = { ...out.transition };
      delete tr.advanceAfterMs;
      out.transition = tr;
    }
    return out;
  });
}

/** Click steps and "On mouse click" of the slides of a show. */
export function showMeta(slides: Slide[]): ShowMeta {
  return { steps: slides.map(clickSteps), clickAdvance: slides.map((s) => s.transition?.advanceOnClick ?? true) };
}

/** The Recording tool bar of Rehearse Timings: next, pause, the slide's time, repeat, the total. */
function RehearsalBar({ rehearsal, index, ids, onNext, onPause, onRepeat }: {
  rehearsal: { times: Map<number, number>; slideStart: number; paused: number | null };
  index: number;
  ids: number[];
  onNext: () => void;
  onPause: () => void;
  onRepeat: () => void;
}) {
  const t = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, []);
  const now = rehearsal.paused ?? Date.now();
  const slide = now - rehearsal.slideStart + (rehearsal.times.get(ids[index] ?? -1) ?? 0);
  const total = [...rehearsal.times.entries()].filter(([id]) => id !== ids[index]).reduce((a, [, v]) => a + v, 0) + slide;
  const b = "flex h-8 w-8 items-center justify-center rounded hover:bg-white/15";
  return (
    <div role="toolbar" aria-label={t("show.rehearse.recording")} data-testid="rehearse-bar" className="ml-2 flex items-center gap-1 rounded bg-neutral-800/90 px-2 text-xs text-white" onClick={(e) => e.stopPropagation()}>
      <span className="mr-1 font-semibold">{t("show.rehearse.recording")}</span>
      <button type="button" className={b} aria-label={t("show.reading.next")} onClick={onNext}>▶</button>
      <button type="button" className={b} aria-label={t("show.rehearse.pause")} aria-pressed={rehearsal.paused !== null} onClick={onPause}>❚❚</button>
      <span className="w-12 text-center tabular-nums" data-testid="rehearse-slide-time">{formatElapsed(slide)}</span>
      <button type="button" className={b} aria-label={t("show.rehearse.repeat")} onClick={onRepeat}>↺</button>
      <span className="w-12 text-center tabular-nums text-white/70">{formatElapsed(total)}</span>
    </div>
  );
}

function NotesOverlay({ notes }: { notes: string }) {
  const t = useT();
  return (
    <div
      className="absolute bottom-8 left-1/2 max-h-[40%] w-[min(90%,48rem)] -translate-x-1/2 overflow-auto whitespace-pre-wrap rounded bg-black/80 p-3 text-base text-white"
      data-testid="notes-overlay"
      onClick={(e) => e.stopPropagation()}
    >
      {notes || <span className="text-white/50">{t("show.noNotes")}</span>}
    </div>
  );
}

export function SlideShow({ store, mode, link, onEnd, rehearse = false }: SlideShowProps) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const settings = pres?.showSettings;
  // Set Up Slide Show: the slide range; hidden slides skipped unless the show starts on one
  const [ids] = useState(() => {
    const st = store.getState();
    return showRange(st.pres?.slides ?? [], st.current, st.pres?.showSettings?.range).map((s) => s.id);
  });
  const slides = useMemo(
    () => showSlides(ids.map((id) => pres?.slides.find((s) => s.id === id)).filter((s): s is Slide => !!s), settings, rehearse),
    [ids, pres, settings, rehearse],
  );
  const [show, setShow] = useState<ShowState>(() => ({
    ...initialShow(ids.length, Math.max(0, ids.indexOf(store.getState().current ?? -1)), showMeta(slides)),
    loop: !!settings?.loop && !rehearse,
  }));
  // ----- Rehearse Timings: time spent per slide
  const [rehearsal, setRehearsal] = useState<{ times: Map<number, number>; slideStart: number; paused: number | null; ask: boolean } | null>(() =>
    rehearse ? { times: new Map(), slideStart: Date.now(), paused: null, ask: false } : null,
  );
  const lastIndex = useRef(show.index);
  const record = useCallback((leaving: number) => {
    setRehearsal((r) => {
      if (!r) return r;
      const id = ids[leaving];
      const now = Date.now();
      const spent = (r.paused ?? now) - r.slideStart;
      const times = new Map(r.times);
      if (id !== undefined) times.set(id, (times.get(id) ?? 0) + spent);
      return { ...r, times, slideStart: now, paused: r.paused === null ? null : now };
    });
  }, [ids]);
  useEffect(() => {
    if (lastIndex.current !== show.index) record(lastIndex.current);
    lastIndex.current = show.index;
  }, [show.index, record]);
  const [phase, setPhase] = useState<"opening" | "console" | "single">(mode === "presenter" && link ? "opening" : "single");
  const [notesOn, setNotesOn] = useState(false);
  const fallback = mode === "presenter" && phase === "single";

  const showRef = useRef(show);
  showRef.current = show;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const rehearsing = useRef(rehearse);
  const dispatch = useCallback((a: ShowAction) => {
    const next = reduceShow(showRef.current, a);
    if (next === "exit" || (rehearsing.current && next.ended)) {
      if (rehearsing.current) {
        // the end of a rehearsal: keep the timings?
        rehearsing.current = false;
        record(showRef.current.index);
        setRehearsal((r) => (r ? { ...r, ask: true } : r));
        return;
      }
      endRef.current();
      return;
    }
    showRef.current = next;
    setShow(next);
  }, [record]);

  // The editor follows the show (after Esc it shows the last slide presented).
  useEffect(() => {
    const id = ids[show.index];
    if (id !== undefined && store.getState().current !== id) store.selectSlide(id);
  }, [store, ids, show.index]);

  // ----- presenter view: the audience window and the sync channel -----
  const sync = useRef<SyncChannel | null>(null);
  const deck = useMemo<DeckContext | null>(() => (pres ? deckOf(pres) : null), [pres]);
  const deckMsg = useRef<() => void>(() => undefined);
  deckMsg.current = () => {
    // the audience window has no core: it gets the shape outlines with the deck
    if (!deck) return;
    const queries = slideQueries(withDesignShapes(deck, slides));
    void pathCache.ensure(queries).then(() => sync.current?.post({ kind: "deck", deck, slides, media: [...store.media], paths: pathCache.entries(queries) }));
  };
  const stateMsg = () => {
    const s = showRef.current;
    sync.current?.post({ kind: "state", slideIndex: s.index, step: s.step, blackout: s.blank, ended: s.ended });
  };

  // Set up once per show. The teardown waits a tick, so React's StrictMode remount (dev) keeps the window open.
  const conn = useRef<{ started: boolean; teardownTimer: number; teardown: () => void }>({ started: false, teardownTimer: 0, teardown: () => {} });
  useEffect(() => {
    if (!link) return;
    const c = conn.current;
    if (c.teardownTimer) {
      window.clearTimeout(c.teardownTimer);
      c.teardownTimer = 0;
    } else if (!c.started) {
      c.started = true;
      let alive = true;
      let win: AudienceWindow | null = null;
      let unlisten = () => {};
      let poll = 0;
      const onPageHide = () => sync.current?.post({ kind: "end" });
      c.teardown = () => {
        alive = false;
        window.clearInterval(poll);
        window.removeEventListener("pagehide", onPageHide);
        unlisten();
        sync.current?.post({ kind: "end" });
        sync.current?.close();
        sync.current = null;
        win?.close();
      };
      void Promise.all([link.sync, link.window]).then(([ch, w]) => {
        if (!alive) {
          ch.close();
          w?.close();
          return;
        }
        win = w;
        if (!w) {
          ch.close();
          setPhase("single");
          setNotesOn(true);
          return;
        }
        sync.current = ch;
        setPhase("console");
        unlisten = ch.listen((m) => {
          if (m.kind === "hello") {
            deckMsg.current();
            stateMsg();
          } else if (m.kind === "action") dispatch(m.action);
          else if (m.kind === "bye") endRef.current();
        });
        deckMsg.current();
        stateMsg();
        poll = window.setInterval(() => {
          if (w.isOpen() === false) endRef.current();
        }, 500);
        window.addEventListener("pagehide", onPageHide);
      });
    }
    return () => {
      c.teardownTimer = window.setTimeout(() => {
        c.teardownTimer = 0;
        c.teardown();
      }, 0);
    };
  }, [link, dispatch]);

  useEffect(() => {
    if (phase === "console") deckMsg.current();
  }, [phase, deck, slides, mediaVersion]);
  useEffect(() => {
    if (phase === "console") sync.current?.post({ kind: "state", slideIndex: show.index, step: show.step, blackout: show.blank, ended: show.ended });
  }, [phase, show.index, show.step, show.blank, show.ended]);

  // Automatic advance ("After" of the slide's transition), unless S stopped it.
  const current = slides[show.index];
  useEffect(() => {
    if (!current || show.ended || show.blank !== "none" || show.autoStopped) return;
    const ms = autoAdvanceDelay(current, show.step);
    if (ms === null) return;
    const timer = window.setTimeout(() => dispatch({ type: "next", via: "timer" }), ms);
    return () => window.clearTimeout(timer);
  }, [current, show.index, show.step, show.ended, show.blank, show.autoStopped, dispatch]);

  if (!pres || !deck || slides.length === 0) return null;
  if (rehearsal?.ask) {
    const total = [...rehearsal.times.values()].reduce((a, b) => a + b, 0);
    return (
      <div role="dialog" aria-modal="true" aria-label={t("show.rehearse")} data-testid="rehearse-confirm" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
        <div className="w-96 rounded-lg bg-ui-panel p-4 text-sm text-ui-fg shadow-xl">
          <p>{t("show.rehearse.keep", { time: formatElapsed(total) })}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="h-8 rounded border border-ui-border px-3 hover:bg-ui-hover" onClick={() => endRef.current()}>
              {t("show.rehearse.no")}
            </button>
            <button
              type="button"
              autoFocus
              className="h-8 rounded border border-ui-border px-3 hover:bg-ui-hover"
              onClick={() => {
                void store.applyTimings(rehearsal.times);
                endRef.current();
              }}
            >
              {t("show.rehearse.yes")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (phase !== "single") {
    return (
      <PresenterConsole
        deck={deck}
        slides={slides}
        media={store.media}
        mediaVersion={mediaVersion}
        show={show}
        onAction={dispatch}
        status={phase === "opening" ? t("show.opening") : undefined}
      />
    );
  }
  return (
    <Presenter
      deck={deck}
      slides={slides}
      media={store.media}
      mediaVersion={mediaVersion}
      show={show}
      onAction={dispatch}
      tools={!fallback}
      toolbarExtra={rehearsal && <RehearsalBar rehearsal={rehearsal} index={show.index} ids={ids} onNext={() => dispatch({ type: "next" })} onPause={() => setRehearsal((r) => r && (r.paused === null ? { ...r, paused: Date.now() } : { ...r, slideStart: r.slideStart + (Date.now() - r.paused), paused: null }))} onRepeat={() => setRehearsal((r) => r && { ...r, slideStart: Date.now(), paused: r.paused === null ? null : Date.now() })} />}
      overlay={
        fallback && (
          <>
            {notesOn && !show.ended && <NotesOverlay notes={slides[show.index]?.notes ?? ""} />}
            <button
              type="button"
              aria-pressed={notesOn}
              className="absolute bottom-2 left-3 rounded bg-white/10 px-2 py-0.5 text-xs text-white/70 hover:bg-white/20"
              data-testid="notes-overlay-toggle"
              title={t("show.notesFallbackTip")}
              onClick={(e) => {
                e.stopPropagation();
                setNotesOn((v) => !v);
              }}
            >
              {t("show.notes")}
            </button>
          </>
        )
      }
    />
  );
}
