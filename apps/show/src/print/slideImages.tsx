// Slide pictures for printing: every slide drawn by the editor's own
// `SlideView` on an off-screen Konva stage and snapshotted as a PNG data
// URL. Snapshots are cached per slide object (slides are immutable).

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { pathCache, slideQueries } from "../shapes/paths";
import { SlideView, preloadImages, type DeckContext } from "../canvas/SlideView";

/** Rendering quality of the printed slides (device pixels per slide px). */
export const PRINT_PIXEL_RATIO = 2;

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

const cache = new WeakMap<Slide, { deck: DeckContext; url: string }>();

/** PNG data URLs of `slides` (`""` where a stage could not be drawn, e.g. without a canvas). */
export async function renderSlideImages(deck: DeckContext, slides: readonly Slide[], media: ReadonlyMap<number, string>): Promise<string[]> {
  const missing = slides.filter((s) => cache.get(s)?.deck !== deck);
  if (missing.length) {
    await preloadImages([...media.values()]);
    // the shapes' outlines from the core first, so the pictures show them (not the fallbacks)
    await pathCache.ensure(slideQueries(missing));
    const px = slidePx(deck.slideSize);
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-100000px;top:0";
    document.body.appendChild(host);
    const root = createRoot(host);
    const stages: (Konva.Stage | null)[] = [];
    try {
      flushSync(() =>
        root.render(
          <>
            {missing.map((slide, i) => (
              <Stage key={slide.id} ref={(s) => void (stages[i] = s)} width={px.width} height={px.height} listening={false}>
                <Layer listening={false}>
                  <SlideView deck={deck} slide={slide} media={media} />
                </Layer>
              </Stage>
            ))}
          </>,
        ),
      );
      await nextFrame();
      await nextFrame();
      missing.forEach((slide, i) => {
        let url = "";
        try {
          url = stages[i]?.toDataURL({ pixelRatio: PRINT_PIXEL_RATIO, mimeType: "image/png" }) ?? "";
        } catch {
          url = "";
        }
        cache.set(slide, { deck, url });
      });
    } finally {
      root.unmount();
      host.remove();
    }
  }
  return slides.map((s) => cache.get(s)?.url ?? "");
}
