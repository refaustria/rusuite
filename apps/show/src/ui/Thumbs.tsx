// Small read-only slide pictures for galleries and panels: a Konva stage
// per thumbnail drawing `SlideView` (slides, the master view's pseudo
// slides, theme samples), memoized on its inputs.

import { memo } from "react";
import { Layer, Stage } from "react-konva";
import { SlideView } from "../canvas/SlideView";
import type { DeckContext } from "../design/deck";
import type { Slide } from "../generated/Slide";
import { slidePx } from "../geometry";

export const DeckThumb = memo(function DeckThumb({
  deck, slide, media, mediaVersion = 0, width, design,
}: {
  deck: DeckContext;
  slide: Slide;
  media: ReadonlyMap<number, string>;
  mediaVersion?: number;
  width: number;
  design?: "master" | "layout";
}) {
  const size = slidePx(deck.slideSize);
  const scale = width / size.width;
  return (
    <Stage width={width} height={Math.round(size.height * scale)} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} design={design} />
      </Layer>
    </Stage>
  );
});

/** Width of the layout and theme gallery thumbnails. */
export const GALLERY_THUMB = 88;
