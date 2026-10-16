// Picture Format tab (P8-22), shown for selected pictures: Corrections ▾
// (brightness × contrast presets), Color ▾ (recolour presets incl. duotone
// by accent, transparency presets), Change Picture…, Reset Picture ▾,
// Picture Styles (outline shape + border + shadow), Picture Border,
// Picture Effects › Shadow ▾ and Crop. Gallery previews are the picture
// itself with the CSS filter approximation (`cssFilter`; duotone and sepia
// exactly by an SVG colour matrix, `recolorMatrix`). Compress is not
// offered.

import { useId, type CSSProperties, type ReactNode } from "react";
import { ColorPicker, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonMenuItem, type RibbonTab, type TFunction } from "@rusuite/ui-shared";
import type { PictureProps } from "../generated/PictureProps";
import type { Shape } from "../generated/Shape";
import type { Theme } from "../generated/Theme";
import { resolveColor, schemeColor } from "../design/color";
import { CORRECTION_STEPS, PICTURE_STYLES, SHADOW_PRESETS, TRANSPARENCY_STEPS, cssFilter, recolorMatrix, recolorPresets, type PictureStyle } from "../design/picture";
import { themePalette } from "../model";
import type { ShowState, ShowStore } from "../state/store";
import { DI } from "./designIcons";

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)} %`;

/** The picture with adjustments as a small DOM preview (duotone / sepia exactly, by an SVG colour matrix). */
function Preview({ url, props, theme, style, className = "h-10 w-14" }: { url: string | undefined; props: PictureProps; theme: Theme | undefined; style?: CSSProperties; className?: string }) {
  const id = `recolor${useId().replace(/[^\w-]/g, "")}`;
  const matrix = recolorMatrix(props.recolor);
  const rest = cssFilter(matrix ? { ...props, recolor: { kind: "none" } } : props, (c) => resolveColor(theme, c));
  const filter = matrix ? `url(#${id})${rest ? ` ${rest}` : ""}` : rest;
  return (
    <span className={`block overflow-hidden bg-ui-bg ${className}`} style={style}>
      {matrix && (
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <filter id={id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={matrix} />
          </filter>
        </svg>
      )}
      {url ? <img alt="" src={url} draggable={false} className="h-full w-full object-cover" style={{ filter: filter || undefined }} /> : <span className="block h-full w-full bg-gray-300" style={{ filter: filter || undefined }} />}
    </span>
  );
}

/** CSS of a picture style's outline for the gallery (clip-path / radius, border, shadow). */
export function styleCss(s: PictureStyle): CSSProperties {
  const css: CSSProperties = {};
  if (s.geometry === "ellipse") css.borderRadius = "50%";
  else if (s.geometry === "roundRect") css.borderRadius = "18%";
  else if (s.geometry === "snip1Rect") css.clipPath = "polygon(0 0, 78% 0, 100% 22%, 100% 100%, 0 100%)";
  else if (s.geometry === "hexagon") css.clipPath = "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)";
  if (s.line.fill.kind === "solid" && s.line.fill.value.kind === "rgb") css.border = `${Math.max(1, Math.round(s.line.width / 12700 / 3))}px solid #${s.line.fill.value.value}`;
  if (s.shadow) css.boxShadow = `${Math.round(Math.cos((s.shadow.directionDeg * Math.PI) / 180) * 3)}px ${Math.round(Math.sin((s.shadow.directionDeg * Math.PI) / 180) * 3)}px ${Math.round(s.shadow.blur / 12700)}px rgba(0,0,0,${s.shadow.alpha})`;
  return css;
}

const WEIGHTS = [0.75, 1.5, 2.25, 3, 4.5, 6];

export function pictureFormatTab(store: ShowStore, state: ShowState, t: TFunction, pictures: Shape[]): RibbonTab {
  const first = pictures[0]!;
  const url = first.kind.kind === "picture" ? store.media.get(first.kind.value.media) : undefined;
  const props: PictureProps = first.kind.kind === "picture" ? (first.kind.value.props ?? {}) : {};
  const theme = state.pres?.theme;
  const palette = themePalette(theme);
  const one = pictures.length === 1 && state.selection.length === 1;
  const base: PictureProps = { ...props, shadow: undefined };

  const corrections = (close: () => void): ReactNode => (
    <div className="flex flex-col gap-1 p-1">
      <span className="text-xs font-medium">{t("show.pic.brightnessContrast")}</span>
      <RibbonGallery
        label={t("show.pic.corrections")}
        columns={CORRECTION_STEPS.length}
        hideLabels
        itemClassName="h-11 w-[60px] p-0.5"
        autoFocus
        selected={`${props.brightness ?? 0}|${props.contrast ?? 0}`}
        items={CORRECTION_STEPS.flatMap((c) =>
          CORRECTION_STEPS.map((b) => ({
            id: `${b}|${c}`,
            label: t("show.pic.correctionItem", { brightness: pct(b), contrast: pct(c) }),
            preview: <Preview url={url} props={{ ...base, brightness: b, contrast: c }} theme={theme} />,
          })),
        )}
        onSelect={(id) => {
          close();
          const [b, c] = id.split("|").map(Number);
          void store.setPictureProps({ brightness: b ?? 0, contrast: c ?? 0 });
        }}
      />
    </div>
  );

  const accents = [1, 2, 3, 4, 5, 6].map((i) => schemeColor(theme, `accent${i}` as `accent${1 | 2 | 3 | 4 | 5 | 6}`));
  const recolors = recolorPresets(accents);
  const currentRecolor = JSON.stringify(props.recolor ?? { kind: "none" });
  const color = (close: () => void): ReactNode => (
    <div className="flex flex-col gap-1 p-1">
      <span className="text-xs font-medium">{t("show.pic.recolor")}</span>
      <RibbonGallery
        label={t("show.pic.recolor")}
        columns={6}
        hideLabels
        itemClassName="h-11 w-[60px] p-0.5"
        autoFocus
        selected={recolors.find((r) => JSON.stringify(r.recolor) === currentRecolor)?.id}
        items={recolors.map((r) => ({
          id: r.id,
          label: r.accent ? t("show.pic.duotoneN", { n: r.accent }) : t(r.labelKey),
          preview: <Preview url={url} props={{ ...base, recolor: r.recolor }} theme={theme} />,
        }))}
        onSelect={(id) => {
          close();
          const r = recolors.find((x) => x.id === id);
          if (r) void store.setPictureProps({ recolor: r.recolor });
        }}
      />
      <span className="text-xs font-medium">{t("show.pic.transparency")}</span>
      <RibbonGallery
        label={t("show.pic.transparency")}
        columns={TRANSPARENCY_STEPS.length}
        hideLabels
        itemClassName="h-11 w-[60px] p-0.5"
        selected={String(props.transparency ?? 0)}
        items={TRANSPARENCY_STEPS.map((v) => ({
          id: String(v),
          label: t("show.pic.transparencyN", { n: Math.round(v * 100) }),
          preview: <Preview url={url} props={{ ...base, transparency: v }} theme={theme} style={{ backgroundImage: "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%)", backgroundSize: "8px 8px" }} />,
        }))}
        onSelect={(id) => {
          close();
          void store.setPictureProps({ transparency: Number(id) });
        }}
      />
    </div>
  );

  const shadowMenu: RibbonMenuItem[] = SHADOW_PRESETS.map((s) => ({
    id: `shadow-${s.id}`,
    label: t(s.labelKey),
    checked: JSON.stringify(props.shadow ?? null) === JSON.stringify(s.shadow),
    onSelect: () => void store.setPictureProps({ shadow: s.shadow }),
  }));
  const resetMenu: RibbonMenuItem[] = [
    { id: "resetPicture", label: t("show.pic.reset"), onSelect: () => void store.resetPicture(false) },
    { id: "resetPictureSize", label: t("show.pic.resetSize"), onSelect: () => void store.resetPicture(true) },
  ];
  const line = first.line;
  const weightMenu: RibbonMenuItem[] = WEIGHTS.map((w) => ({
    id: `weight-${w}`,
    label: `${w} pt`,
    checked: line.fill.kind === "solid" && Math.abs(line.width - w * 12700) < 1,
    onSelect: () => void store.setPictureBorder({ fill: line.fill.kind === "solid" ? line.fill : { kind: "solid", value: { kind: "rgb", value: "000000" } }, width: Math.round(w * 12700), dash: line.dash }),
  }));

  return {
    id: "pictureFormat",
    label: t("show.pic.tab"),
    groups: [
      {
        label: t("show.pic.adjust"),
        items: (
          <>
            <RibbonMenuButton label={t("show.pic.corrections")} icon={DI.corrections} size="large" showLabel menu={corrections} />
            <RibbonMenuButton label={t("show.pic.color")} icon={DI.color} size="large" showLabel menu={color} />
            <RibbonStack>
              <RibbonButton label={t("show.changePictureDots")} icon={DI.change} showLabel disabled={!one} onClick={() => store.openDialog({ kind: "replacePicture", shape: first.id })} />
              <RibbonMenuButton label={t("show.pic.resetMenu")} icon={DI.reset} showLabel menu={resetMenu} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.pic.styles"),
        items: (
          <>
            <RibbonGallery
              label={t("show.pic.styles")}
              items={PICTURE_STYLES.map((s) => ({
                id: s.id,
                label: t(s.labelKey),
                preview: (
                  <span className="flex h-6 w-10 items-center justify-center">
                    <Preview url={url} props={base} theme={theme} className="h-5 w-8" style={styleCss(s)} />
                  </span>
                ),
              }))}
              columns={5}
              hideLabels
              itemClassName="h-[26px] w-11"
              onSelect={(id) => {
                const s = PICTURE_STYLES.find((x) => x.id === id);
                if (s) void store.applyPictureStyle(s);
              }}
            />
            <RibbonStack>
              <ColorPicker
                label={t("show.pic.border")}
                kind="fill"
                value={line.fill.kind === "solid" ? line.fill.value : undefined}
                theme={palette}
                onSelect={(c) => void store.setPictureBorder(c ? { fill: { kind: "solid", value: c }, width: line.fill.kind === "solid" && line.width ? line.width : 12700, dash: line.dash } : null)}
              />
              <RibbonMenuButton label={t("show.pic.weight")} icon={DI.border} menu={weightMenu} />
            </RibbonStack>
            <RibbonStack>
              <RibbonMenuButton label={t("show.pic.shadow")} icon={DI.shadow} showLabel menu={shadowMenu} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.pic.size"),
        items: (
          <>
            <RibbonButton label={t("show.pic.crop")} icon={DI.crop} size="large" showLabel pressed={state.crop !== null} disabled={!one} tooltip={t("show.pic.cropTip")} onClick={() => (state.crop ? void store.commitCrop() : store.startCrop())} />
            <RibbonButton label={t("show.altTextDots")} icon="textBox" size="large" showLabel disabled={!one} onClick={() => store.openDialog({ kind: "alt", shape: first.id })} />
          </>
        ),
      },
    ],
  };
}
