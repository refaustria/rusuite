// Print view: renders every slide with Konva (off-screen), snapshots each
// to a PNG and shows them as full-page `<img>`s for the webview to print.

import { useEffect, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type Konva from "konva";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";
import { SlideView, preloadImages, type DeckContext } from "../canvas/SlideView";
import { showPrintCss } from "./printCss";

/** Rendering quality of the exported slides (device pixels per slide px). */
export const PRINT_PIXEL_RATIO = 2;

export interface PrintViewProps {
  deck: DeckContext;
  slides: Slide[];
  media: ReadonlyMap<number, string>;
  /** Called once the page images are in the DOM (`count` pages). */
  onReady: (count: number) => void;
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

export function PrintView({ deck, slides, media, onReady }: PrintViewProps) {
  const refs = useRef<(Konva.Stage | null)[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pages, setPages] = useState<string[] | null>(null);
  const px = slidePx(deck.slideSize);

  useEffect(() => {
    let live = true;
    void preloadImages([...media.values()]).then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [media]);

  // Snapshot once the stages are drawn with all images available.
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    void (async () => {
      await nextFrame();
      await nextFrame();
      if (!live) return;
      const urls = slides.map((_, i) => refs.current[i]?.toDataURL({ pixelRatio: PRINT_PIXEL_RATIO, mimeType: "image/png" }) ?? "");
      setPages(urls);
    })();
    return () => {
      live = false;
    };
  }, [loaded, slides]);

  useEffect(() => {
    if (pages) void nextFrame().then(() => onReady(pages.length));
  }, [pages, onReady]);

  return (
    <div data-testid="print-view">
      <style>{showPrintCss(deck.slideSize)}</style>
      {!pages && (
        <div style={{ position: "fixed", left: -100000, top: 0 }} aria-hidden>
          {slides.map((slide, i) => (
            <Stage key={slide.id} ref={(s) => void (refs.current[i] = s)} width={px.width} height={px.height} listening={false}>
              <Layer listening={false}>
                <SlideView deck={deck} slide={slide} media={media} />
              </Layer>
            </Stage>
          ))}
        </div>
      )}
      <div className="print-pages" data-testid="print-pages">
        {pages?.map((src, i) => <img key={slides[i]?.id ?? i} className="print-slide" data-testid="print-page" alt={`Slide ${i + 1}`} src={src} />)}
      </div>
    </div>
  );
}
