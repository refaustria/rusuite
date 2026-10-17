// Read-only rendering of one slide as Konva nodes (used by the editor
// stage, the thumbnails and the presenter). Each shape becomes a
// `Group` keyed by its `NodeId`: the outer group carries position and
// rotation (offset at the box centre), an inner group the flips and the
// geometry, and the text is laid out by `text/layout.ts` into one
// `Text` node per styled fragment (unflipped, like PowerPoint).

import { memo, useEffect, useMemo, useState } from "react";
import { Ellipse, Group, Image as KImage, Line as KLine, Path, Rect, Shape as KShape, Text } from "react-konva";
import { applyTint, drawChartScene } from "@rusuite/ui-shared";
import type { ChartShape } from "../generated/ChartShape";
import type { MediaClip } from "../generated/MediaClip";
import { chartScene } from "../charts/render";
import type Konva from "konva";
import type { ThemePalette } from "@rusuite/ui-shared";
import type { Connector } from "../generated/Connector";
import type { NodeId } from "../generated/NodeId";
import type { LineDash } from "../generated/LineDash";
import type { PlaceholderDef } from "../generated/PlaceholderDef";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { Table } from "../generated/Table";
import { boxAttrs, emuToPx, EMU_PER_PX, slidePx } from "../geometry";
import { bodyText, css, effectiveParagraph, fillCss, themePalette } from "../model";
import { backdropShapes, designBackground, designShapes, levelDefaults, levelMargins, placeholderFor, slideBackground, slideNumberOf, type DeckContext } from "../design/deck";
import { effectShadow, konvaFill, resolveColor } from "../design/color";
import { patternDataUrl } from "../design/patterns";
import { fieldText } from "../design/fields";
import { cropSource, processedImage, shadowOffset } from "../design/picture";
import type { PictureProps } from "../generated/PictureProps";
import type { TextParagraphProps } from "../generated/TextParagraphProps";
import { arrowHead, endDirections } from "../shapes/connectors";
import { pathCache, pathPoints, pathQueryOf, svgPath, usePathVersion } from "../shapes/paths";
import { textRect } from "../shapes/presets";
import { compoundStrokes, effectiveBorders, effectiveFill } from "../shapes/tables";
import { layoutText, measureText, type LayoutOptions } from "../text/layout";
import { runStyleFor, tableLayout } from "./tableLayout";
import { useT } from "../i18n";

export { runStyleFor };
export type { DeckContext };

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
  /** With `hiddenText` a table: only this cell's text is hidden. */
  hiddenCell?: { row: number; col: number } | null;
  /** Shapes drawn instead of the slide's (live previews of adjust-handle drags). */
  overrides?: ReadonlyMap<NodeId, Shape>;
  /** Shows "Click to add …" in empty placeholders (editor only). */
  prompts?: boolean;
  /**
   * The master view: `slide` is a design target's placeholders (`master`:
   * the slide master's, else the layout `slide.layout`'s), drawn over that
   * target's background and decorative shapes.
   */
  design?: "master" | "layout";
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
  hiddenCell: { row: number; col: number } | null;
  prompts: boolean;
  /** Placeholders resolve against the master's own (master view). */
  asMaster: boolean;
  /** 1-based number of the slide (`null` on layouts / unknown: `‹#›`). */
  slideNumber: number | null;
  onShapeDragEnd?: (node: Konva.Node) => void;
  onShapeDragStart?: (node: Konva.Node) => void;
  shapeDragBound?: SlideViewProps["shapeDragBound"];
}

const PROMPTS: Record<string, string> = {
  title: "show.prompt.title",
  centeredTitle: "show.prompt.title",
  subtitle: "show.prompt.subtitle",
  body: "show.prompt.text",
  picture: "show.master.samplePicture",
  chart: "show.prompt.chart",
  table: "show.prompt.table",
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

/**
 * A picture background (Format Background › Picture or texture fill):
 * stretched over the slide, or tiled at the picture's size (px), with its
 * opacity. Nothing until the image has loaded.
 */
/**
 * A picture background: tiled at the picture's size × `tileScale`,
 * shifted by `tileOffset` (EMU), or stretched over the slide with its
 * edges moved by `offsets` (fractions of the slide; positive = inwards),
 * clipped to the slide.
 */
function BackgroundPicture({ url, tile, alpha, width, height, offsets, tileOffset, tileScale }: {
  url: string | undefined;
  tile: boolean;
  alpha: number;
  width: number;
  height: number;
  offsets?: readonly number[];
  tileOffset?: readonly number[];
  tileScale?: readonly number[];
}) {
  const img = useImage(url);
  if (!img) return null;
  if (tile) {
    return (
      <Rect
        name="slide-background-picture"
        x={0}
        y={0}
        width={width}
        height={height}
        fillPatternImage={img}
        fillPatternRepeat="repeat"
        fillPatternX={(tileOffset?.[0] ?? 0) / EMU_PER_PX}
        fillPatternY={(tileOffset?.[1] ?? 0) / EMU_PER_PX}
        fillPatternScaleX={tileScale?.[0] ?? 1}
        fillPatternScaleY={tileScale?.[1] ?? 1}
        opacity={alpha}
        listening={false}
      />
    );
  }
  const [l, t, r, b] = [offsets?.[0] ?? 0, offsets?.[1] ?? 0, offsets?.[2] ?? 0, offsets?.[3] ?? 0];
  return (
    <Group clip={{ x: 0, y: 0, width, height }} listening={false}>
      <KImage name="slide-background-picture" x={l * width} y={t * height} width={Math.max(1, width * (1 - l - r))} height={Math.max(1, height * (1 - t - b))} image={img} opacity={alpha} listening={false} />
    </Group>
  );
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

/** The placeholder defaults of each outline level (level 1 = the placeholder's own). */
function levelDefs(ctx: Pick<Ctx, "deck">, def: PlaceholderDef | undefined): (level: number) => PlaceholderDef | undefined {
  const cache = new Map<number, PlaceholderDef | undefined>();
  return (level) => {
    if (!def || level <= 0) return def;
    if (!cache.has(level)) {
      const lv = levelDefaults(ctx.deck, def, level);
      cache.set(level, { ...def, runDefaults: lv.run, paragraphDefaults: lv.paragraph });
    }
    return cache.get(level);
  };
}

/** What laying out a shape's text needs to know about the slide. */
export type TextCtx = Pick<Ctx, "deck" | "slide" | "palette" | "asMaster" | "slideNumber">;

/** Layout options of a shape's text in its `w` × `h` px text rectangle (placeholder defaults per level, fields, links). */
export function shapeTextOptions(ctx: TextCtx, shape: Shape, w: number, h: number): LayoutOptions {
  const def = placeholderFor(ctx.deck, ctx.slide.layout, shape, ctx.asMaster);
  const at = levelDefs(ctx, def);
  const styles = new Map<number, ReturnType<typeof runStyleFor>>();
  const margins = new Map<number, { marginLeft?: number; indent?: number }>();
  const styleAt = (level: number) => {
    // runs without a colour take the shape style's text colour (`p:style/a:fontRef`: white on filled shapes)
    const base = shape.textColor ? { color: css(shape.textColor, ctx.palette) } : undefined;
    if (!styles.has(level)) styles.set(level, runStyleFor(at(level), ctx.deck.theme, ctx.palette, base));
    return styles.get(level)!;
  };
  return {
    width: w,
    height: h,
    measure: measureText,
    runStyle: (props, level = 0) => styleAt(level)(props),
    paragraphProps: (p: TextParagraphProps | undefined) => effectiveParagraph(at(p?.level ?? 0), p),
    fieldText: (field, stored) => fieldText(field, ctx.slideNumber, stored),
    linkColor: css({ kind: "theme", value: { slot: "hyperlink", tint: 0 } }, ctx.palette),
    margins: (level) => {
      if (!margins.has(level)) {
        const m = levelMargins(ctx.deck, def, shape.placeholder, level);
        margins.set(level, {
          ...(m.marginLeft !== undefined ? { marginLeft: emuToPx(m.marginLeft) } : {}),
          ...(m.indent !== undefined ? { indent: emuToPx(m.indent) } : {}),
        });
      }
      return margins.get(level)!;
    },
  };
}

/** The layout of a shape's text in its `w` × `h` px text rectangle (placeholder defaults per level, fields, links). */
export function layoutShapeText(ctx: TextCtx, shape: Shape, body: TextBody, w: number, h: number, prompt?: string) {
  const shown: TextBody = prompt ? promptBody(shape, body, prompt) : body;
  return layoutText(drawnBody(ctx, shape, shown), shapeTextOptions(ctx, shape, w, h));
}

/**
 * The prompt an empty placeholder shows in the editor ("Click to add
 * title"; a custom prompt of its layout placeholder, typed in the Slide
 * Master view, wins); `undefined` for other shapes. Never drawn in the
 * show, print or export.
 */
export function promptOf(ctx: Pick<TextCtx, "deck" | "slide">, shape: Shape, t: (key: string) => string): string | undefined {
  const key = shape.placeholder ? PROMPTS[shape.placeholder] : undefined;
  if (!key) return undefined;
  return placeholderFor(ctx.deck, ctx.slide.layout, shape)?.prompt ?? t(key);
}

/** The body an empty placeholder is drawn with: its prompt in the first paragraph's formatting (picture, chart and table placeholders' centred, without bullet). */
export function promptBody(shape: Shape, body: TextBody, prompt: string): TextBody {
  const promptProps = shape.placeholder === "picture" || shape.placeholder === "chart" || shape.placeholder === "table" ? { ...body.paragraphs[0]?.props, bullet: { kind: "none" as const }, alignment: "center" as const } : body.paragraphs[0]?.props;
  return { ...body, paragraphs: [{ props: promptProps, runs: [{ text: prompt }] }] };
}

/** `body` as drawn: vertical placeholders (`orient="vert"`: Title and Vertical Text, Vertical Title and Text) turn their text 90°. */
export function drawnBody(ctx: TextCtx, shape: Shape, body: TextBody): TextBody {
  if ((body.props.vert ?? "horizontal") === "horizontal" && placeholderFor(ctx.deck, ctx.slide.layout, shape, ctx.asMaster)?.vertical) {
    return { ...body, props: { ...body.props, vert: "rotate90" } };
  }
  return body;
}

function TextNodes({ body, shape, w, h, ctx }: { body: TextBody; shape: Shape; w: number; h: number; ctx: Ctx }) {
  // a field (date, slide number) is text even while its stored text is empty
  const empty = bodyText(body) === "" && !body.paragraphs.some((p) => p.runs.some((r) => r.field));
  const t = useT();
  const prompt = empty && ctx.prompts ? promptOf(ctx, shape, t) : undefined;
  const layout = useMemo(
    () => layoutShapeText(ctx, shape, body, w, h, prompt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, w, h, shape.placeholder, shape.placeholderIdx, ctx.deck, ctx.palette, ctx.slide.layout, ctx.asMaster, prompt, ctx.slideNumber],
  );
  if (empty && !prompt) return null;
  if (layout.rotation) {
    // vertical text (`vert`): laid out in the swapped box, turned into this one
    return (
      <Group rotation={layout.rotation === 90 ? 90 : -90} x={layout.rotation === 90 ? w : 0} y={layout.rotation === 90 ? 0 : h} name="text-rotated">
        <Fragments fragments={layout.fragments} />
      </Group>
    );
  }
  return <Fragments fragments={layout.fragments} />;
}

function Fragments({ fragments, opacity = 1, x = 0, y = 0 }: { fragments: ReturnType<typeof layoutText>["fragments"]; opacity?: number; x?: number; y?: number }) {
  return (
    <Group listening={false} opacity={opacity} x={x} y={y}>
      {fragments.map((f, i) =>
        f.highlight ? <Rect key={`h${i}`} x={f.x} y={f.y} width={f.width} height={f.fontSize} fill={f.highlight} /> : null,
      )}
      {fragments.map((f, i) => (
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

/**
 * A picture with its adjustments (docs/pptx-suite.md): the crop's source
 * rectangle, recolour and brightness/contrast (a processed bitmap when a
 * canvas is available), transparency as opacity, the outer shadow under
 * the picture clipped to its outline shape, the border on top.
 */
function Picture({ shape, media, w, h, ctx }: { shape: Shape; media: string | undefined; w: number; h: number; ctx: Ctx }) {
  usePathVersion();
  const img = useImage(media);
  const props: PictureProps | undefined = shape.kind.kind === "picture" ? shape.kind.value.props : undefined;
  const s = strokeOf(shape, ctx.palette);
  const geometry = props?.geometry && props.geometry !== "rect" ? props.geometry : null;
  const q = pathQueryOf(shape);
  const outline = geometry && q ? (pathCache.get(q)?.paths ?? null) : null;
  const sh = props?.shadow;
  const shadow = sh
    ? (() => {
        const [dx, dy] = shadowOffset(sh);
        return { shadowColor: `#${resolveColor(ctx.deck.theme, sh.color)}`, shadowOpacity: sh.alpha, shadowBlur: emuToPx(sh.blur), shadowOffsetX: emuToPx(dx), shadowOffsetY: emuToPx(dy), shadowForStrokeEnabled: false };
      })()
    : {};
  const opacity = 1 - Math.max(0, Math.min(1, props?.transparency ?? 0));
  const data = outline ? outline.map((p) => svgPath(p.commands)).join(" ") : null;
  const clip = data
    ? (c: Konva.Context): [Path2D] | void => {
        if (typeof Path2D !== "undefined") return [new Path2D(data)];
        c.rect(0, 0, w, h);
      }
    : geometry === "ellipse"
      ? (c: Konva.Context) => {
          c.beginPath();
          c.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.closePath();
        }
      : undefined;
  let image: React.ReactNode;
  if (!img) image = <Rect width={w} height={h} fill="#e5e7eb" />;
  else {
    const processed = processedImage(img, media ?? "", props);
    image = processed ? (
      <KImage name="picture-image" image={processed} width={w} height={h} />
    ) : (
      <KImage name="picture-image" image={img} width={w} height={h} crop={props?.crop ? cropSource(props.crop, img.naturalWidth, img.naturalHeight) : undefined} />
    );
  }
  // The shadow is cast by an opaque copy of the outline under the clipped picture.
  const silhouette = sh ? (
    data ? <Path data={data} fill="#000000" {...shadow} listening={false} /> : geometry === "ellipse" ? <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} fill="#000000" {...shadow} listening={false} /> : <Rect width={w} height={h} fill="#000000" {...shadow} listening={false} />
  ) : null;
  const border = s.color
    ? data ? <Path data={data} {...s.attrs} listening={false} /> : geometry === "ellipse" ? <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...s.attrs} listening={false} /> : <Rect width={w} height={h} {...s.attrs} listening={false} />
    : null;
  return (
    <Group opacity={opacity} name="picture" data-filter={props ? "1" : undefined}>
      {silhouette && <Group opacity={1}>{silhouette}</Group>}
      <Group clipFunc={clip}>{image}</Group>
      <Rect width={w} height={h} fill="rgba(0,0,0,0)" />
      {border}
    </Group>
  );
}

/** A CSS `#RRGGBB` colour darkened (`d` > 0) or lightened (`d` < 0) by a fraction of its lightness (action button icons). */
export function shade(color: string, d: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  return m ? `#${applyTint(m[1]!.toUpperCase(), -d)}` : color;
}

/** A chart: the shared renderer's scene painted on the Konva canvas (transparent area, the theme's colours). */
function ChartGeometry({ chart, w, h, ctx }: { chart: ChartShape; w: number; h: number; ctx: Ctx }) {
  const scene = chartScene(chart, Math.max(1, w), Math.max(1, h), ctx.palette);
  return (
    <>
      <Rect name="chart-hit" width={w} height={h} fill="rgba(0,0,0,0)" />
      <KShape
        name="chart"
        listening={false}
        width={w}
        height={h}
        sceneFunc={(c: Konva.Context) => {
          const native = (c as unknown as { _context?: CanvasRenderingContext2D })._context;
          if (native && typeof Path2D !== "undefined") drawChartScene(native, scene);
        }}
      />
    </>
  );
}

/**
 * Audio / video on the slide: the poster frame, else PowerPoint-like
 * placeholders (a dark frame with a play button; a speaker for audio).
 */
function MediaGeometry({ clip, w, h, ctx }: { clip: MediaClip; w: number; h: number; ctx: Ctx }) {
  const poster = useImage(clip.poster !== undefined ? ctx.media.get(clip.poster) : undefined);
  const r = Math.max(4, Math.min(w, h) * 0.18);
  const cx = w / 2;
  const cy = h / 2;
  if (poster) return <KImage name="media-poster" image={poster} width={w} height={h} />;
  if (clip.kind === "audio") {
    const s = Math.min(w, h);
    const x = (w - s) / 2;
    const y = (h - s) / 2;
    const u = s / 10;
    return (
      <Group name="media-placeholder" data-media="audio">
        <Rect width={w} height={h} fill="rgba(0,0,0,0)" />
        <Path x={x} y={y} data={`M${u} ${3.5 * u}H${3.5 * u}L${6 * u} ${u}V${9 * u}L${3.5 * u} ${6.5 * u}H${u}Z`} fill="#404040" />
        <Path x={x} y={y} data={`M${7 * u} ${3.5 * u}Q${8.2 * u} ${5 * u} ${7 * u} ${6.5 * u}M${8 * u} ${2.5 * u}Q${10 * u} ${5 * u} ${8 * u} ${7.5 * u}`} stroke="#404040" strokeWidth={Math.max(1, u * 0.6)} />
      </Group>
    );
  }
  return (
    <Group name="media-placeholder" data-media="video">
      <Rect width={w} height={h} fill="#262626" />
      <Ellipse x={cx} y={cy} radiusX={r} radiusY={r} fill="rgba(255,255,255,0.18)" />
      <KLine points={[cx - r * 0.35, cy - r * 0.5, cx + r * 0.55, cy, cx - r * 0.35, cy + r * 0.5]} closed fill="#F2F2F2" />
    </Group>
  );
}

/** Konva stroke attributes of a shape's outline (`{}` without one). */
function strokeOf(shape: Shape, palette: ThemePalette) {
  const color = fillCss(shape.line.fill, palette);
  const sw = Math.max(0.5, emuToPx(shape.line.width));
  const attrs = color
    ? { stroke: color, strokeWidth: sw, dash: shape.line.dash === "dash" ? [sw * 4, sw * 3] : shape.line.dash === "dot" ? [sw, sw] : undefined }
    : {};
  return { color, sw, attrs };
}

/** Simple outlines drawn until the core's path arrives (and when it cannot be had). */
function Fallback({ geometry, w, h, fill, stroke, sw, strokeColor }: { geometry: string; w: number; h: number; fill: string | undefined; stroke: Record<string, unknown>; sw: number; strokeColor: string | undefined }) {
  const hit = fill ? {} : { fill: "rgba(0,0,0,0)" };
  switch (geometry) {
    case "ellipse":
    case "flowChartConnector":
      return <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} fill={fill} {...hit} {...stroke} />;
    case "line":
      return <KLine points={[0, 0, w, h]} {...stroke} stroke={strokeColor ?? "#000000"} strokeWidth={sw} hitStrokeWidth={Math.max(10, sw)} />;
    case "roundRect":
      return <Rect width={w} height={h} cornerRadius={Math.min(w, h) / 6} fill={fill} {...hit} {...stroke} />;
    default:
      return <Rect width={w} height={h} fill={fill} {...hit} {...stroke} />;
  }
}

/** An auto shape: its preset's paths from the core (fill / stroke per sub-path). */
function PresetGeometry({ shape, w, h, ctx }: { shape: Shape; w: number; h: number; ctx: Ctx }) {
  usePathVersion();
  const fill = fillCss(shape.fill, ctx.palette);
  const s = strokeOf(shape, ctx.palette);
  const q = pathQueryOf(shape);
  const paths = q ? pathCache.get(q) : null;
  const geometry = shape.kind.kind === "auto" && typeof shape.kind.value.geometry === "string" ? shape.kind.value.geometry : "rect";
  if (!paths || !paths.paths.length) return <Fallback geometry={geometry} w={w} h={h} fill={fill} stroke={s.attrs} sw={s.sw} strokeColor={s.color} />;
  const lineOnly = paths.paths.every((p) => !p.fill);
  // the theme's effect style (Design › Variants › Effects)
  const shadow = effectShadow(ctx.deck.theme, shape.effectRef, EMU_PER_PX);
  return (
    <>
      {paths.paths.map((p, i) => (
        <Path
          key={i}
          name="geometry"
          {...shadow}
          data={svgPath(p.commands)}
          fill={p.fill ? (p.darken && fill ? shade(fill, p.darken) : (fill ?? "rgba(0,0,0,0)")) : undefined}
          {...(p.stroke ? s.attrs : {})}
          {...(lineOnly ? { stroke: s.color ?? "#000000", strokeWidth: s.sw, hitStrokeWidth: Math.max(10, s.sw) } : {})}
        />
      ))}
    </>
  );
}

/** A connector: its route from the core, drawn with the outline, and the arrowheads. */
function ConnectorGeometry({ shape, c, ctx }: { shape: Shape; c: Connector; ctx: Ctx }) {
  usePathVersion();
  const s = strokeOf(shape, ctx.palette);
  const q = pathQueryOf(shape)!;
  const t = shape.transform;
  const commands = pathCache.get(q)?.paths[0]?.commands ?? [
    { kind: "moveTo" as const, x: 0, y: 0 },
    { kind: "lineTo" as const, x: t.w, y: t.h },
  ];
  const color = s.color ?? "#000000";
  const pts = pathPoints(commands).map((p) => ({ x: p.x / EMU_PER_PX, y: p.y / EMU_PER_PX }));
  const dirs = endDirections(pts);
  const heads = dirs
    ? [
        c.head ? arrowHead(c.head, pts[0]!, dirs.start, s.sw) : null,
        c.tail ? arrowHead(c.tail, pts[pts.length - 1]!, dirs.end, s.sw) : null,
      ]
    : [];
  return (
    <>
      <Path name="geometry" data={svgPath(commands)} stroke={color} strokeWidth={s.sw} dash={s.attrs.dash} hitStrokeWidth={Math.max(10, s.sw)} />
      {heads.map((a, i) =>
        !a ? null : a.kind === "oval" ? (
          <Ellipse key={i} x={a.points[0]} y={a.points[1]} radiusX={a.rx!} radiusY={a.ry!} fill={color} listening={false} />
        ) : (
          <KLine key={i} points={a.points} closed={a.kind === "polygon"} fill={a.kind === "polygon" ? color : undefined} stroke={color} strokeWidth={a.kind === "polyline" ? s.sw : s.sw / 2} listening={false} />
        ),
      )}
    </>
  );
}

/** Konva dash pattern of a line `w` px wide (PowerPoint's dash / round-dot proportions). */
const dashArray = (dash: LineDash | undefined, w: number): number[] | undefined => (dash === "dash" ? [w * 4, w * 3] : dash === "dot" ? [w, w] : undefined);

/** A table: cell fills, cell text, then the borders over them. */
function TableGeometry({ shape, table, ctx }: { shape: Shape; table: Table; ctx: Ctx }) {
  const lay = useMemo(() => tableLayout(table, ctx.deck.theme, ctx.palette, ctx.deck.tableStyles), [table, ctx.deck.theme, ctx.palette, ctx.deck.tableStyles]);
  const hideCell = ctx.hiddenText === shape.id ? ctx.hiddenCell : null;
  const width = lay.colX[lay.colX.length - 1]!;
  const height = lay.rowY[lay.rowY.length - 1]!;
  const lines: { key: string; points: number[]; color: string; width: number; dash?: LineDash }[] = [];
  for (const c of lay.cells) {
    const b = effectiveBorders(table, c.row, c.col, ctx.deck.tableStyles);
    const add = (side: string, l: typeof b.left, points: number[]) => {
      const color = l ? css(l.color, ctx.palette) : undefined;
      if (!l || !color) return;
      const key = `${c.row}-${c.col}-${side}`;
      const width = Math.max(0.5, emuToPx(l.width));
      for (const [i, s] of compoundStrokes(l.compound, width).entries()) {
        // strokes run parallel to the edge, offset across it
        const [dx, dy] = side === "t" || side === "b" ? [0, s.offset] : [s.offset, 0];
        lines.push({ key: `${key}-${i}`, points: [points[0]! + dx, points[1]! + dy, points[2]! + dx, points[3]! + dy], color, width: s.width, dash: l.dash });
      }
    };
    add("t", b.top, [c.x, c.y, c.x + c.w, c.y]);
    add("b", b.bottom, [c.x, c.y + c.h, c.x + c.w, c.y + c.h]);
    add("l", b.left, [c.x, c.y, c.x, c.y + c.h]);
    add("r", b.right, [c.x + c.w, c.y, c.x + c.w, c.y + c.h]);
    // diagonals (Borders › Diagonal Down / Up Border)
    for (const [side, l, points] of [
      ["dd", b.diagDown, [c.x, c.y, c.x + c.w, c.y + c.h]],
      ["du", b.diagUp, [c.x, c.y + c.h, c.x + c.w, c.y]],
    ] as const) {
      const color = l ? css(l.color, ctx.palette) : undefined;
      if (l && color) lines.push({ key: `${c.row}-${c.col}-${side}`, points: [...points], color, width: Math.max(0.5, emuToPx(l.width)), dash: l.dash });
    }
  }
  return (
    <>
      <Rect name="table-hit" width={width} height={height} fill="rgba(0,0,0,0)" />
      {lay.cells.map((c) => {
        const fill = css(effectiveFill(table, c.row, c.col, ctx.deck.tableStyles), ctx.palette);
        return fill ? <Rect key={`f${c.row}-${c.col}`} name="table-cell" x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} listening={false} /> : null;
      })}
      {lay.cells.map((c) =>
        hideCell && hideCell.row === c.row && hideCell.col === c.col ? null : c.text.rotation ? (
          // vertical cell text (`a:tcPr/@vert`): laid out in the swapped box, turned into the cell
          <Group key={`t${c.row}-${c.col}`} x={c.x + (c.text.rotation === 90 ? c.w : 0)} y={c.y + (c.text.rotation === 90 ? 0 : c.h)} rotation={c.text.rotation === 90 ? 90 : -90} name="cell-text-rotated">
            <Fragments fragments={c.text.fragments} />
          </Group>
        ) : (
          <Fragments key={`t${c.row}-${c.col}`} fragments={c.text.fragments} x={c.x} y={c.y} />
        ),
      )}
      {lines.map((l) => (
        <KLine key={l.key} points={l.points} stroke={l.color} strokeWidth={l.width} dash={dashArray(l.dash, l.width)} listening={false} />
      ))}
    </>
  );
}

function Geometry({ shape, w, h, ctx }: { shape: Shape; w: number; h: number; ctx: Ctx }) {
  const k = shape.kind;
  if (k.kind === "picture") return <Picture shape={shape} media={ctx.media.get(k.value.media)} w={w} h={h} ctx={ctx} />;
  if (k.kind === "connector") return <ConnectorGeometry shape={shape} c={k.value} ctx={ctx} />;
  if (k.kind === "table") return <TableGeometry shape={shape} table={k.value} ctx={ctx} />;
  if (k.kind === "chart") return <ChartGeometry chart={k.value} w={w} h={h} ctx={ctx} />;
  if (k.kind === "media") return <MediaGeometry clip={k.value} w={w} h={h} ctx={ctx} />;
  if (k.kind !== "auto") return null;
  return <PresetGeometry shape={shape} w={w} h={h} ctx={ctx} />;
}

function ShapeNode({ shape, ctx, top }: { shape: Shape; ctx: Ctx; top: boolean }) {
  const a = boxAttrs(shape.transform);
  const t = shape.transform;
  const text = shape.kind.kind === "auto" ? shape.kind.value.text : null;
  // the text rectangle comes with the outline
  usePathVersion();
  const tr = shape.kind.kind === "auto" && text ? textRect(shape, a.width, a.height) : null;
  return (
    <Group
      id={top ? `shape-${shape.id}` : undefined}
      name={top ? "shape" : "child"}
      shapeId={shape.id}
      shapeKind={shape.kind.kind}
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
          {shape.kind.value.children.filter((c) => !c.hidden).map((c) => (
            <ShapeNode key={c.id} shape={c} ctx={ctx} top={false} />
          ))}
        </Group>
      ) : shape.kind.kind === "table" ? (
        <Geometry shape={shape} w={a.width} h={a.height} ctx={ctx} />
      ) : (
        <Group x={a.width / 2} y={a.height / 2} offsetX={a.width / 2} offsetY={a.height / 2} scaleX={t.flipH ? -1 : 1} scaleY={t.flipV ? -1 : 1}>
          <Geometry shape={shape} w={a.width} h={a.height} ctx={ctx} />
        </Group>
      )}
      {text && tr && ctx.hiddenText !== shape.id && (
        <Group x={tr.x} y={tr.y}>
          <TextNodes body={text} shape={shape} w={tr.w} h={tr.h} ctx={ctx} />
        </Group>
      )}
    </Group>
  );
}

/** The slide's background and shapes, in slide px (the parent `Stage` scales). */
export const SlideView = memo(function SlideView({
  deck, slide, media, interactive = false, hiddenText = null, hiddenCell = null, overrides, prompts = false, design, onShapeDragEnd, onShapeDragStart, shapeDragBound,
}: SlideViewProps) {
  const palette = useMemo(() => themePalette(deck.theme), [deck.theme]);
  const size = slidePx(deck.slideSize);
  const slideNumber = design ? null : slideNumberOf(deck, slide.id);
  const ctx: Ctx = { deck, slide, palette, media, interactive, hiddenText, hiddenCell, prompts, asMaster: design === "master", slideNumber, onShapeDragEnd, onShapeDragStart, shapeDragBound };
  const target = design === "master" ? null : slide.layout;
  const bg = design ? designBackground(deck, target) : slideBackground(deck, slide);
  const backdrop = design ? designShapes(deck, target) : backdropShapes(deck, slide);
  const bctx: Ctx = { ...ctx, interactive: false, prompts: false, hiddenText: null, asMaster: design === "master" };
  const fill = bg.kind === "none" || bg.kind === "picture" || bg.kind === "pattern" ? { fill: "#ffffff" } : konvaFill(bg, size.width, size.height);
  return (
    <>
      <Rect name="slide-background" x={0} y={0} width={size.width} height={size.height} {...fill} data-bg={bg.kind === "solid" ? bg.value.color : bg.kind} />
      {bg.kind === "picture" && (
        <BackgroundPicture url={media.get(bg.value.media)} tile={bg.value.tile} alpha={bg.value.alpha} width={size.width} height={size.height} offsets={bg.value.offsets} tileOffset={bg.value.tileOffset} tileScale={bg.value.tileScale} />
      )}
      {bg.kind === "pattern" && <BackgroundPicture url={patternDataUrl(bg.value.preset, bg.value.fg, bg.value.bg)} tile alpha={1} width={size.width} height={size.height} />}
      {backdrop.length > 0 && (
        <Group name="master-shapes" listening={false}>
          {backdrop.map((s) => (
            <ShapeNode key={`m${s.id}`} shape={s} ctx={bctx} top={false} />
          ))}
        </Group>
      )}
      {/* Selection pane: hidden shapes are not drawn (editor, show, print) */}
      {slide.shapes.filter((s) => !s.hidden).map((s) => (
        <ShapeNode key={s.id} shape={overrides?.get(s.id) ?? s} ctx={ctx} top />
      ))}
    </>
  );
});
