// Runs a slide show from the main window (P7-8). `mode: "single"` is the
// full-window show (F5); `"presenter"` (Alt+F5) shows the presenter console
// here and the slide in an audience window, kept in sync over `SyncChannel`.
// When the audience window cannot be opened (popup blocked) the show falls
// back to the single-window show with a speaker notes overlay toggle.
//
// The slides of the show are fixed when it starts: hidden slides are
// skipped unless the show starts on one, as in PowerPoint.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckContext } from "../canvas/SlideView";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import { useShow, type ShowStore } from "../state/store";
import { Presenter } from "./Presenter";
import { PresenterConsole } from "./PresenterConsole";
import { initialShow, reduceShow, type ShowAction, type ShowState } from "./showState";
import type { AudienceLink, AudienceWindow, SyncChannel } from "./sync";
import { useT } from "../i18n";

export interface SlideShowProps {
  store: ShowStore;
  mode: "single" | "presenter";
  /** The audience window of a presenter view (`launchAudience()`, opened from the key or click handler). */
  link?: AudienceLink;
  onEnd: () => void;
}

/** The slides of a show starting at `current`: the visible ones, plus `current` itself when hidden. */
export function showSlideIds(slides: Slide[], current: NodeId | null): NodeId[] {
  return slides.filter((s) => !s.hidden || s.id === current).map((s) => s.id);
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

export function SlideShow({ store, mode, link, onEnd }: SlideShowProps) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const [ids] = useState(() => showSlideIds(store.getState().pres?.slides ?? [], store.getState().current));
  const slides = useMemo(() => ids.map((id) => pres?.slides.find((s) => s.id === id)).filter((s): s is Slide => !!s), [ids, pres]);
  const [show, setShow] = useState<ShowState>(() => initialShow(ids.length, Math.max(0, ids.indexOf(store.getState().current ?? -1))));
  const [phase, setPhase] = useState<"opening" | "console" | "single">(mode === "presenter" && link ? "opening" : "single");
  const [notesOn, setNotesOn] = useState(false);
  const fallback = mode === "presenter" && phase === "single";

  const showRef = useRef(show);
  showRef.current = show;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const dispatch = useCallback((a: ShowAction) => {
    const next = reduceShow(showRef.current, a);
    if (next === "exit") {
      endRef.current();
      return;
    }
    showRef.current = next;
    setShow(next);
  }, []);

  // The editor follows the show (after Esc it shows the last slide presented).
  useEffect(() => {
    const id = ids[show.index];
    if (id !== undefined && store.getState().current !== id) store.selectSlide(id);
  }, [store, ids, show.index]);

  // ----- presenter view: the audience window and the sync channel -----
  const sync = useRef<SyncChannel | null>(null);
  const deck = useMemo<DeckContext | null>(() => (pres ? { slideSize: pres.slideSize, layouts: pres.layouts, theme: pres.theme } : null), [pres]);
  const deckMsg = useRef<() => void>(() => undefined);
  deckMsg.current = () => {
    if (deck) sync.current?.post({ kind: "deck", deck, slides, media: [...store.media] });
  };
  const stateMsg = () => {
    const s = showRef.current;
    sync.current?.post({ kind: "state", slideIndex: s.index, blackout: s.blank, ended: s.ended });
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
    if (phase === "console") sync.current?.post({ kind: "state", slideIndex: show.index, blackout: show.blank, ended: show.ended });
  }, [phase, show.index, show.blank, show.ended]);

  if (!pres || !deck || slides.length === 0) return null;
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
