// App glue of the touch zoom (P10-M4): fit-width on compact (recomputed on resize and rotation), pinch on every
// touch screen, double tap on compact (fit-width ↔ 100 %; a header or footer opens its editor instead), the compact
// page gap and the remembered Print Layout / Draft choice on phones.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WriteFeatures, WriteView } from "../features/WriteFeatures";
import { remeasurePages } from "../features/pagination";
import type { Editor } from "@tiptap/react";
import { COMPACT_GAP_PX, MAX_TOUCH_ZOOM, MIN_TOUCH_ZOOM, anchorAt, fitWidthZoom, gapForZoom, installZoomGestures, restoreAnchor, type ZoomAnchor } from "./zoomGestures";

/** localStorage key of the view chosen on a phone (Print Layout or Draft). */
export const COMPACT_VIEW_KEY = "rusuite.write.compactView";

function storedView(): WriteView | null {
  try {
    const v = globalThis.localStorage?.getItem(COMPACT_VIEW_KEY);
    return v === "print" || v === "draft" ? v : null;
  } catch {
    return null;
  }
}

function storeView(v: WriteView): void {
  try {
    globalThis.localStorage?.setItem(COMPACT_VIEW_KEY, v);
  } catch {
    // private mode: not remembered
  }
}

export interface TouchZoomOptions {
  compact: boolean;
  view: WriteView;
  /** The widest page (CSS px at 100 %). */
  pageWidth: number;
  zoom: number;
  setZoom: (zoom: number) => void;
  scrollRef: RefObject<HTMLElement | null>;
  zoomRef: RefObject<HTMLElement | null>;
  features: WriteFeatures;
  editor: Editor | null;
}

/** Returns the zoom setter for the ribbon (an explicit zoom leaves fit-width) and whether fit-width is on. */
export function useTouchZoom({ compact, view, pageWidth, zoom, setZoom, scrollRef, zoomRef, features, editor }: TouchZoomOptions) {
  const [fit, setFit] = useState(true);
  const [available, setAvailable] = useState(0);
  const anchor = useRef<ZoomAnchor | null>(null);
  const fitZoom = view === "draft" ? 1 : fitWidthZoom(available, pageWidth);
  const state = useRef({ compact, fit, fitZoom, zoom, view });
  state.current = { compact, fit, fitZoom, zoom, view };

  // The width the page may use: the scroll area's (resize, rotation, the keyboard never changes it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !compact) return;
    const read = () => setAvailable(el.clientWidth);
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener("orientationchange", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("orientationchange", read);
    };
  }, [scrollRef, compact]);

  // Fit-width follows the width while it is on; leaving compact goes back to 100 %.
  useEffect(() => {
    if (compact && fit && available > 0 && Math.abs(zoom - fitZoom) > 0.0005) setZoom(fitZoom);
  }, [compact, fit, fitZoom, available, zoom, setZoom]);
  const wasCompact = useRef(compact);
  useEffect(() => {
    if (wasCompact.current && !compact) {
      setFit(true);
      setZoom(1);
    }
    wasCompact.current = compact;
  }, [compact, setZoom]);

  // Phones: 8 px between pages on the screen at any zoom (the pagination re-runs with the zoom anyway).
  useEffect(() => {
    const gap = compact ? gapForZoom(COMPACT_GAP_PX, zoom) : null;
    if (features.pageGap === gap) return;
    features.pageGap = gap;
    if (editor && !editor.isDestroyed) remeasurePages(editor.view);
  }, [compact, zoom, features, editor]);

  // Keep the pinch centre / the double-tapped point in place.
  useLayoutEffect(() => {
    const a = anchor.current;
    const s = scrollRef.current;
    const z = zoomRef.current;
    anchor.current = null;
    if (a && s && z) restoreAnchor(s, z, zoom, a);
  }, [zoom, scrollRef, zoomRef]);

  const apply = useCallback(
    (z: number, a: ZoomAnchor | null, toFit: boolean) => {
      anchor.current = a;
      setFit(toFit);
      setZoom(z);
    },
    [setZoom],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    return installZoomGestures(el, {
      zoom: () => state.current.zoom,
      zoomEl: () => zoomRef.current,
      range: () => {
        const s = state.current;
        return s.compact ? { min: Math.min(s.fitZoom, 1), max: MAX_TOUCH_ZOOM } : { min: MIN_TOUCH_ZOOM, max: MAX_TOUCH_ZOOM };
      },
      onPinch: (z, a) => {
        const s = state.current;
        const toFit = s.compact && Math.abs(z - s.fitZoom) < 0.01;
        apply(toFit ? s.fitZoom : Math.round(z * 1000) / 1000, a, toFit);
      },
      onDoubleTap: (x, y, target) => {
        const hf = target.closest(".page-hf");
        if (hf) {
          // Headers and footers stay double-tap editable.
          hf.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
          return true;
        }
        const s = state.current;
        const z = zoomRef.current;
        if (!s.compact || s.view !== "print" || !z || target.closest(".inline-image-wrap, .drawing-wrap")) return false;
        const a = anchorAt(z, s.zoom, x, y);
        const atFit = Math.abs(s.zoom - s.fitZoom) < 0.01;
        if (atFit) apply(1, a, false);
        else apply(s.fitZoom, a, true);
        return true;
      },
    });
  }, [scrollRef, zoomRef, apply]);

  // Phones remember Print Layout / Draft (View tab); the desktop keeps starting in Print Layout.
  useEffect(() => {
    if (!compact) return;
    const stored = storedView();
    if (stored && stored !== features.ui.getState().view) features.ui.set({ view: stored });
    let last = features.ui.getState().view;
    return features.ui.subscribe(() => {
      const v = features.ui.getState().view;
      if (v !== last) {
        last = v;
        storeView(v);
      }
    });
  }, [compact, features]);

  const onZoom = useCallback(
    (z: number) => {
      if (state.current.compact) setFit(false);
      setZoom(z);
    },
    [setZoom],
  );
  return { onZoom, fit: compact && fit, fitZoom };
}
