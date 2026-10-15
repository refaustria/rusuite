// Read-only rendering of one slide as Konva nodes (used by the editor
// stage, the thumbnails and the presenter). Each shape becomes a
// `Group` keyed by its `NodeId`: the outer group carries position and
// rotation (offset at the box centre), an inner group the flips and the
// geometry, and the text is laid out by `text/layout.ts` into one
// `Text` node per styled fragment (unflipped, like PowerPoint).

import { memo, useEffect, useMemo, useState } from "react";
import { Ellipse, Group, Image as KImage, Line as KLine, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { ThemePalette } from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Layout } from "../generated/Layout";
import type { NodeId } from "../generated/NodeId";
import type { PlaceholderDef } from "../generated/PlaceholderDef";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { SlideSize } from "../generated/SlideSize";
import type { TextBody } from "../generated/TextBody";
import type { Theme } from "../generated/Theme";
import { boxAttrs, emuToPx, PX_PER_PT, slidePx } from "../geometry";
import { bodyText, css, effectiveParagraph, effectiveRun, fillCss, fontFamily, themePalette } from "../model";
import { layoutText, measureText, type RunStyle } from "../text/layout";
import { useT } from "../i18n";

/** What a slide needs from the presentation besides the slide itself. */
export interface DeckContext {
  slideSize: SlideSize;
  layouts: Layout[];
  theme: Theme;
}

export interface SlideViewProps {
  deck: DeckContext;
  slide: Slide;
  /** Media id → data URL. */
  media: ReadonlyMap<number, string>;
  /** Changes when `media` got new entries. */
  mediaVersion?: number;
  /** Shapes react to the mouse and top-level shapes are draggable (editor only). */
  interactive?: boolean;
  /** Text of this shape is hidden (it is being edited in the overlay). */
  hiddenText?: NodeId | null;
  /** Shows "Click to add …" in empty placeholders (editor only). */
  prompts?: boolean;
  /** Called when a top-level shape was dragged (editor only). */
  onShapeDragEnd?: (node: Konva.Node) => void;
  /** Called when dragging a top-level shape starts (editor only). */
  onShapeDragStart?: (node: Konva.Node) => void;
  /** Bounds the absolute position of a dragged top-level shape (snapping; editor only). */
  shapeDragBound?: (node: Konva.Node, pos: { x: number; y: number }, evt: MouseEvent | undefined) => { x: number; y: number };
}

interface Ctx {
  deck: DeckContext;
  slide: Slide;
  palette: ThemePalette;
  media: ReadonlyMap<number, string>;
  interactive: boolean;
  hiddenText: NodeId | null;
  prompts: boolean;
  onShapeDragEnd?: (node: Konva.Node) => void;
  onShapeDragStart?: (node: Konva.Node) => void;
  shapeDragBound?: SlideViewProps["shapeDragBound"];
}

const PROMPTS: Record<string, string> = {
  title: "show.prompt.title",
  centeredTitle: "show.prompt.title",
  subtitle: "show.prompt.subtitle",
  body: "show.prompt.text",
};

const imageCache = new Map<string, HTMLImageElement>();

/** An `HTMLImageElement` for a data URL, once it has loaded. */
function useImage(url: string | undefined): HTMLImageElement | null {
  const cached = url ? imageCache.get(url) : undefined;
  const [img, setImg] = useState<HTMLImageElement | null>(cached?.complete ? cached : null);
  useEffect(() => {
    if (!url || typeof Image === "undefined") return;
    let el = imageCache.get(url);
    if (!el) {
      el = new Image();
      el.src = url;
      imageCache.set(url, el);
    }
    if (el.complete && el.naturalWidth > 0) {
      setImg(el);
      return;
    }
    const done = () => setImg(el!);
    el.addEventListener("load", done);
    return () => el!.removeEventListener("load", done);
  }, [url]);
  return img;
}

/** Loads `urls` into the image cache; resolves when all are decoded (or failed). */
export function preloadImages(urls: readonly string[]): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          let el = imageCache.get(url);
          if (!el) {
            el = new Image();
            el.src = url;
            imageCache.set(url, el);
          }
          if (el.complete) return resolve();
          el.addEventListener("load", () => resolve(), { once: true });
          el.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

/** Resolves run formatting to a concrete style. */
export function runStyleFor(def: PlaceholderDef | undefined, theme: Theme, palette: ThemePalette) {
  return (props: RunProperties | undefined): RunStyle => {
    const r = effectiveRun(def, props);
    const ul = r.underline;
    return {
      fontFamily: fontFamily(r.font, theme),
      sizePx: ((r.size ?? 1800) / 100) * PX_PER_PT,
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!ul && ul !== "none",
      strike: !!r.strike,
      color: css(r.color, palette) ?? css({ kind: "theme", value: { slot: "dark1", tint: 0 } }, palette) ?? "#000000",
      highlight: css(r.highlight, palette),
      verticalAlign: r.verticalAlign === "superscript" || r.verticalAlign === "subscript" ? r.verticalAlign : undefined,
    };
  };
}

function placeholderOf(ctx: Ctx, shape: Shape): PlaceholderDef | undefined {
  if (!shape.placeholder) return undefined;
  const layout = ctx.deck.layouts.find((l) => l.kind === ctx.slide.layout);
  return layout?.placeholders.find((p) => p.kind === shape.placeholder);
}

function TextNodes({ body, shape, w, h, ctx }: { body: TextBody; shape: Shape; w: number; h: number; ctx: Ctx }) {
  const def = placeholderOf(ctx, shape);
  const empty = bodyText(body) === "";
  const t = useT();
  const promptKey = empty && ctx.prompts && shape.placeholder ? PROMPTS[shape.placeholder] : undefined;
  const prompt = promptKey ? t(promptKey) : undefined;
  const layout = useMemo(() => {
    const shown: TextBody = prompt
      ? { ...body, paragraphs: [{ props: body.paragraphs[0]?.props, runs: [{ text: prompt }] }] }
      : body;
    return layoutText(shown, {
      width: w,
      height: h,
      measure: measureText,
      runStyle: runStyleFor(def, ctx.deck.theme, ctx.palette),
      paragraphProps: (p) => effectiveParagraph(def, p),
    });
  }, [body, w, h, def, ctx.deck.theme, ctx.palette, prompt]);
  if (empty && !prompt) return null;
  return (
    <Group listening={false} opacity={prompt ? 0.45 : 1}>
      {layout.fragments.map((f, i) =>
        f.highlight ? <Rect key={`h${i}`} x={f.x} y={f.y} width={f.width} height={f.fontSize} fill={f.highlight} /> : null,
      )}
      {layout.fragments.map((f, i) => (
        <Text
          key={i}
          x={f.x}
          y={f.y}
          text={f.text}
          fontFamily={f.fontFamily}
          fontSize={f.fontSize}
          fontStyle={f.fontStyle}
          textDecoration={f.textDecoration}
          fill={f.fill}
          lineHeight={1}
          wrap="none"
        />
      ))}
    </Group>
  );
}

function Picture({ media, w, h, stroke }: { media: string | undefined; w: number; h: number; stroke: Record<string, unknown> }) {
  const img = useImage(media);
  return img ? (
    <KImage image={img} width={w} height={h} {...stroke} />
  ) : (
    <Rect width={w} height={h} fill="#e5e7eb" {...stroke} />
  );
}

function Geometry({ shape, w, h, ctx }: { shape: Shape; w: number; h: number; ctx: Ctx }) {
  const fill = fillCss(shape.fill, ctx.palette);
  const strokeColor = fillCss(shape.line.fill, ctx.palette);
  const sw = Math.max(0.5, emuToPx(shape.line.width));
  const stroke = strokeColor
    ? {
        stroke: strokeColor,
        strokeWidth: sw,
        dash: shape.line.dash === "dash" ? [sw * 4, sw * 3] : shape.line.dash === "dot" ? [sw, sw] : undefined,
      }
    : {};
  const k = shape.kind;
  if (k.kind === "picture") return <Picture media={ctx.media.get(k.value.media)} w={w} h={h} stroke={stroke} />;
  if (k.kind !== "auto") return null;
  // Shapes without fill still take clicks on their box (text boxes).
  const hit = fill ? {} : { fill: "rgba(0,0,0,0)" };
  switch (k.value.geometry) {
    case "ellipse":
      return <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} fill={fill} {...hit} {...stroke} />;
    case "line":
      return (
        <KLine
          points={[0, 0, w, h]}
          {...stroke}
          stroke={strokeColor ?? "#000000"}
          strokeWidth={sw}
          hitStrokeWidth={Math.max(10, sw)}
        />
      );
    case "roundRect":
      return <Rect width={w} height={h} cornerRadius={Math.min(w, h) / 6} fill={fill} {...hit} {...stroke} />;
    case "rect":
      return <Rect width={w} height={h} fill={fill} {...hit} {...stroke} />;
  }
}

function ShapeNode({ shape, ctx, top }: { shape: Shape; ctx: Ctx; top: boolean }) {
  const a = boxAttrs(shape.transform);
  const t = shape.transform;
  const text = shape.kind.kind === "auto" ? shape.kind.value.text : null;
  return (
    <Group
      id={top ? `shape-${shape.id}` : undefined}
      name={top ? "shape" : "child"}
      shapeId={shape.id}
      x={a.x}
      y={a.y}
      offsetX={a.offsetX}
      offsetY={a.offsetY}
      rotation={a.rotation}
      draggable={ctx.interactive && top}
      onDragEnd={top && ctx.onShapeDragEnd ? (e: Konva.KonvaEventObject<DragEvent>) => ctx.onShapeDragEnd!(e.target) : undefined}
      onDragStart={top && ctx.onShapeDragStart ? (e: Konva.KonvaEventObject<DragEvent>) => ctx.onShapeDragStart!(e.target) : undefined}
      dragBoundFunc={
        top && ctx.shapeDragBound
          ? function (this: Konva.Node, pos: { x: number; y: number }, evt?: MouseEvent) {
              return ctx.shapeDragBound!(this, pos, evt);
            }
          : undefined
      }
      listening={ctx.interactive}
    >
      {shape.kind.kind === "group" ? (
        <Group x={a.width / 2} y={a.height / 2} offsetX={a.width / 2} offsetY={a.height / 2} scaleX={t.flipH ? -1 : 1} scaleY={t.flipV ? -1 : 1}>
          {shape.kind.value.children.map((c) => (
            <ShapeNode key={c.id} shape={c} ctx={ctx} top={false} />
          ))}
        </Group>
      ) : (
        <Group x={a.width / 2} y={a.height / 2} offsetX={a.width / 2} offsetY={a.height / 2} scaleX={t.flipH ? -1 : 1} scaleY={t.flipV ? -1 : 1}>
          <Geometry shape={shape} w={a.width} h={a.height} ctx={ctx} />
        </Group>
      )}
      {text && ctx.hiddenText !== shape.id && <TextNodes body={text} shape={shape} w={a.width} h={a.height} ctx={ctx} />}
    </Group>
  );
}

/** The slide's background and shapes, in slide px (the parent `Stage` scales). */
export const SlideView = memo(function SlideView({
  deck, slide, media, interactive = false, hiddenText = null, prompts = false, onShapeDragEnd, onShapeDragStart, shapeDragBound,
}: SlideViewProps) {
  const palette = useMemo(() => themePalette(deck.theme), [deck.theme]);
  const size = slidePx(deck.slideSize);
  const ctx: Ctx = { deck, slide, palette, media, interactive, hiddenText, prompts, onShapeDragEnd, onShapeDragStart, shapeDragBound };
  const bg = fillCss(slide.background ?? null, palette) ?? "#ffffff";
  return (
    <>
      <Rect name="slide-background" x={0} y={0} width={size.width} height={size.height} fill={bg} />
      {slide.shapes.map((s) => (
        <ShapeNode key={s.id} shape={s} ctx={ctx} top />
      ))}
    </>
  );
});
