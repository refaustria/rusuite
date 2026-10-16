// Design tab (P8-22): Themes gallery (the eight built-ins as live
// thumbnails of a sample title slide), Variants (four colour variants of
// the current theme → `SetThemeColors`), Colors ▾ (the built-in themes'
// palettes), Fonts ▾ (own font pairings → `SetThemeFonts`), Background
// Styles ▾ (the theme's three background styles × four colours on the
// master), Format Background (the pane) and Slide Size ▾. Also the layout
// galleries of Home / Insert › New Slide ▾ and Home › Layout ▾.

import { useEffect, useMemo, type ReactNode } from "react";
import { ColorPicker, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab, type TFunction } from "@rusuite/ui-shared";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Background } from "../generated/Background";
import type { BuiltinTheme } from "../generated/BuiltinTheme";
import type { LayoutKind } from "../generated/LayoutKind";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { Theme } from "../generated/Theme";
import { fillCssBackground, resolveBackground, schemeColor } from "../design/color";
import { deckOf, layoutOf, slideBackground, stableDeck, type DeckContext } from "../design/deck";
import { layoutName } from "../design/layouts";
import { designShape, designSlide } from "../design/master";
import { FONT_PAIRS, sameColors, variantColors } from "../design/variants";
import { themePalette } from "../model";
import { useShow, type ShowState, type ShowStore } from "../state/store";
import { useT } from "../i18n";
import { DeckThumb, GALLERY_THUMB } from "./Thumbs";
import { DI } from "./designIcons";

type T = TFunction;

const EMPTY_MEDIA = new Map<number, string>();

/** Slide sizes of Design › Slide Size. */
export const SLIDE_SIZES = {
  widescreen: { width: 12192000, height: 6858000 },
  standard: { width: 9144000, height: 6858000 },
};

// ----- layout galleries ------------------------------------------------------------------

/** Thumbnails of the presentation's layouts (New Slide ▾, Layout ▾, the master view's panel). */
export function layoutItems(pres: Presentation): RibbonGalleryItem[] {
  const deck = stableDeck(pres);
  return pres.layouts.map((l) => ({
    id: l.kind,
    label: layoutName(l),
    preview: (
      <span className="block overflow-hidden rounded-sm border border-ui-border bg-white" data-testid="layout-thumb">
        <DeckThumb deck={deck} slide={designSlide(pres, { kind: "layout", value: l.kind })} media={EMPTY_MEDIA} width={GALLERY_THUMB} design="layout" />
      </span>
    ),
  }));
}

/** A layout gallery panel (inside a split / menu button). */
export function LayoutGallery({ store, label, selected, onSelect, close }: { store: ShowStore; label: string; selected?: string; onSelect: (k: LayoutKind) => void; close: () => void }) {
  const pres = useShow(store, (s) => s.pres);
  const items = useMemo(() => (pres ? layoutItems(pres) : []), [pres?.layouts, pres?.master, pres?.theme, pres?.slideSize]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="max-h-[70vh] w-max overflow-y-auto">
      <RibbonGallery
        label={label}
        items={items}
        columns={4}
        itemClassName="w-24 p-1"
        selected={selected}
        autoFocus
        onSelect={(id) => {
          close();
          onSelect(id as LayoutKind);
        }}
      />
    </div>
  );
}

// ----- theme thumbnails --------------------------------------------------------------------

/** A sample title slide for theme thumbnails: "Aa" and the theme's name, three accent bars. */
export function sampleSlide(pres: Presentation, title: string, subtitle: string): Slide {
  const layout = layoutOf(pres, "title") ?? pres.layouts[0];
  const kind = layout?.kind ?? "title";
  const shapes: Shape[] = (layout?.placeholders ?? [])
    .filter((d) => d.kind === "centeredTitle" || d.kind === "title" || d.kind === "subtitle")
    .map((d, i) => {
      const s = designShape(d, i);
      const sub = d.kind === "subtitle";
      // big "Aa" in the heading font, the name small (like a theme swatch)
      const run = sub ? { text: subtitle, props: { size: 3600 } } : { text: title, props: { size: 16600 } };
      return { ...s, line: { ...s.line, fill: { kind: "none" } }, kind: { kind: "auto", value: { geometry: "rect", text: { props: { ...d.bodyDefaults, autofit: "none" }, paragraphs: [{ runs: [run] }] } } } };
    });
  const { width, height } = pres.slideSize;
  const w = Math.round(width / 6);
  for (let i = 0; i < 3; i++) {
    shapes.push({
      id: 1_900_000_000 + i,
      name: "accent",
      transform: { x: Math.round(width / 4 + i * (w + width / 40)), y: Math.round(height * 0.86), w, h: Math.round(height / 18) },
      kind: { kind: "auto", value: { geometry: "rect" } },
      fill: { kind: "solid", value: { kind: "theme", value: { slot: `accent${i + 1}` as ThemeColorSlot, tint: 0 } } },
      line: { fill: { kind: "none" }, width: 0, dash: "solid" },
    });
  }
  return { id: 1_899_999_999, layout: kind, shapes };
}

/** The deck of `pres` re-themed (and with the built-in's master background). */
export function themedDeck(pres: Presentation, theme: Theme, background?: Background): DeckContext {
  const d = deckOf(pres);
  return { ...d, theme, master: d.master && background ? { ...d.master, background } : d.master, order: undefined };
}

function ThemeThumb({ pres, theme, background, title }: { pres: Presentation; theme: Theme; background?: Background; title: string }) {
  const deck = useMemo(() => themedDeck(pres, theme, background), [pres.slideSize, pres.layouts, pres.master, theme, background]); // eslint-disable-line react-hooks/exhaustive-deps
  const slide = useMemo(() => sampleSlide(pres, "Aa", title), [pres.layouts, pres.slideSize, title]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="block overflow-hidden rounded-sm border border-ui-border" data-testid="theme-thumb">
      <DeckThumb deck={deck} slide={slide} media={EMPTY_MEDIA} width={64} />
    </span>
  );
}

/** Swatches of a palette (dark 2, light 2, accents 1–6). */
function Palette({ theme }: { theme: Theme }) {
  const slots: ThemeColorSlot[] = ["dark2", "light2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
  return (
    <span className="flex gap-px" aria-hidden="true">
      {slots.map((s) => (
        <span key={s} className="h-3.5 w-3.5 border border-black/10" style={{ background: `#${schemeColor(theme, s)}` }} />
      ))}
    </span>
  );
}

/** The 12 Background Styles: styles 1–3 (`p:bgRef` 1001–1003) × Light 1, Light 2, Dark 2, Dark 1. */
export const BACKGROUND_STYLES: { id: string; bg: Background }[] = [1001, 1002, 1003].flatMap((index) =>
  (["light1", "light2", "dark2", "dark1"] as ThemeColorSlot[]).map((slot) => ({
    id: `${index}-${slot}`,
    bg: { kind: "style", value: { index, color: { kind: "theme", value: { slot, tint: 0 } } } } as Background,
  })),
);

// ----- the tab -------------------------------------------------------------------------------

export function DesignThemesLoader({ store }: { store: ShowStore }) {
  useEffect(() => void store.loadThemes(), [store]);
  return null;
}

/** The controls of the Design tab (also used by the Slide Master tab). */
export function designControls(store: ShowStore, state: ShowState, t: T) {
  const pres = state.pres;
  const themes = state.themes ?? [];
  const theme = pres?.theme;
  const current = themes.find((b) => pres && b.theme.name === pres.theme.name && sameColors(b.theme.colors, pres.theme.colors))?.id;
  const themeItems: RibbonGalleryItem[] = pres
    ? themes.map((b: BuiltinTheme) => ({ id: b.id, label: b.theme.name, preview: <ThemeThumb pres={pres} theme={b.theme} background={b.background} title={b.theme.name} /> }))
    : [];
  const variants = pres && theme
    ? [0, 1, 2, 3].map((k) => {
        const base = themes.find((b) => b.theme.name === theme.name)?.theme.colors ?? theme.colors;
        const colors = variantColors(base, k);
        return { k, colors, item: { id: String(k), label: t("show.design.variantN", { n: k + 1 }), preview: <ThemeThumb pres={pres} theme={{ ...theme, colors }} title={theme.name} /> } };
      })
    : [];
  const variant = variants.find((v) => theme && sameColors(v.colors, theme.colors))?.item.id;
  const colorsMenu: RibbonMenuItem[] = themes.map((b) => ({
    id: `colors-${b.id}`,
    label: b.theme.colors.name || b.theme.name,
    icon: <Palette theme={b.theme} />,
    checked: !!theme && sameColors(theme.colors, b.theme.colors),
    onSelect: () => void store.setThemeColors(b.theme.colors),
  }));
  const fontsMenu: RibbonMenuItem[] = FONT_PAIRS.map((f) => ({
    id: `fonts-${f.name}`,
    label: `${f.name}: ${f.majorLatin} / ${f.minorLatin}`,
    icon: (
      <span aria-hidden="true" className="w-6 text-sm" style={{ fontFamily: `"${f.majorLatin}", sans-serif` }}>
        Aa
      </span>
    ),
    checked: theme?.fonts.majorLatin === f.majorLatin && theme?.fonts.minorLatin === f.minorLatin,
    onSelect: () => void store.setThemeFonts(f),
  }));
  const size = pres?.slideSize;
  const sizeMenu: RibbonMenuItem[] = [
    { id: "standard", label: t("show.size.standard"), checked: size?.width === SLIDE_SIZES.standard.width && size?.height === SLIDE_SIZES.standard.height, onSelect: () => void store.setSlideSize(SLIDE_SIZES.standard) },
    { id: "widescreen", label: t("show.size.widescreen"), checked: size?.width === SLIDE_SIZES.widescreen.width && size?.height === SLIDE_SIZES.widescreen.height, onSelect: () => void store.setSlideSize(SLIDE_SIZES.widescreen) },
    { id: "custom", label: t("show.size.customDots"), onSelect: () => store.openDialog({ kind: "slideSize" }) },
  ];
  const bgStyles = (close: () => void): ReactNode =>
    pres && (
      <RibbonGallery
        label={t("show.bg.styles")}
        columns={4}
        hideLabels
        itemClassName="h-10 w-14 p-0.5"
        autoFocus
        items={BACKGROUND_STYLES.map((b, i) => ({
          id: b.id,
          label: t("show.bg.styleN", { n: i + 1 }),
          preview: <span className="block h-8 w-12 rounded-sm border border-ui-border" style={{ background: fillCssBackground(resolveBackground(pres.theme, b.bg)) }} />,
        }))}
        onSelect={(id) => {
          close();
          const b = BACKGROUND_STYLES.find((x) => x.id === id);
          if (!b) return;
          const mv = state.masterView;
          if (mv) void store.setBackgroundOf(store.backgroundTarget(), b.bg);
          else void store.setMasterBackgroundStyle(b.bg);
        }}
      />
    );
  const themesGallery = (variant: "inline" | "dropdown") => (
    <RibbonGallery
      label={t("show.design.themes")}
      items={themeItems}
      selected={current}
      hideLabels={variant === "inline"}
      variant={variant}
      icon={DI.colors}
      columns={variant === "dropdown" ? 4 : undefined}
      itemClassName={variant === "dropdown" ? "w-[76px] p-1" : "h-12 w-[72px]"}
      disabled={!pres}
      onSelect={(id) => void store.applyTheme(id)}
    />
  );
  const colors = <RibbonMenuButton label={t("show.design.colors")} icon={DI.colors} showLabel disabled={!pres || !themes.length} menu={colorsMenu} />;
  const fonts = <RibbonMenuButton label={t("show.design.fonts")} icon={DI.fonts} showLabel disabled={!pres} menu={fontsMenu} />;
  const backgroundStyles = <RibbonMenuButton label={t("show.bg.styles")} icon={DI.bgStyles} showLabel disabled={!pres} menu={bgStyles} />;
  const slideSize = <RibbonMenuButton label={t("show.size.label")} icon={DI.slideSize} size="large" showLabel disabled={!pres} menu={sizeMenu} />;
  const formatBackground = <RibbonButton label={t("show.bg.format")} icon={DI.bgFormat} size="large" showLabel pressed={state.bgPane} disabled={!pres} onClick={() => store.toggleBgPane()} />;
  const backgroundStylesLarge = <RibbonMenuButton label={t("show.bg.styles")} icon={DI.bgStyles} size="large" showLabel disabled={!pres} menu={bgStyles} />;
  return { pres, variants, variant, themesGallery, colors, fonts, backgroundStyles, backgroundStylesLarge, slideSize, formatBackground };
}

export function designTab(store: ShowStore, state: ShowState, t: T): RibbonTab {
  const c = designControls(store, state, t);
  const { pres, variants, variant } = c;
  return {
    id: "design",
    label: t("tab.design"),
    groups: [
      { label: t("show.design.themes"), items: c.themesGallery("inline") },
      {
        label: t("show.design.variants"),
        items: (
          <>
            <RibbonGallery
              label={t("show.design.variants")}
              items={variants.map((v) => v.item)}
              selected={variant}
              hideLabels
              itemClassName="h-12 w-[72px]"
              disabled={!pres}
              onSelect={(id) => {
                const v = variants.find((x) => x.item.id === id);
                if (v) void store.setThemeColors(v.colors);
              }}
            />
            <RibbonStack>
              {c.colors}
              {c.fonts}
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.design.customize"),
        items: (
          <>
            {c.slideSize}
            {c.formatBackground}
            {c.backgroundStylesLarge}
          </>
        ),
      },
    ],
  };
}

// ----- Format Background pane ---------------------------------------------------------------

const GRADIENT_SLOTS: ThemeColorSlot[] = ["light1", "light2", "dark2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

const PANE_BTN = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-xs hover:bg-ui-hover disabled:opacity-40";

/**
 * Format Background (right of the stage): Solid fill (colour) or Gradient
 * fill (the theme's gradient background style in a theme colour), Hide
 * background graphics, Apply to All and Reset Background. In the normal
 * view it changes the current slide (gradients, which slides cannot hold,
 * go to the master); in the master view the selected master or layout.
 */
export function BackgroundPane({ store }: { store: ShowStore }) {
  const t = useT();
  const open = useShow(store, (s) => s.bgPane);
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const mv = useShow(store, (s) => s.masterView);
  if (!open || !pres) return null;
  const deck = stableDeck(pres);
  const slide = pres.slides.find((s) => s.id === current) ?? null;
  const layout = mv?.kind === "layout" ? layoutOf(pres, mv.value) : undefined;
  const own: Background | null | undefined = mv
    ? mv.kind === "master" ? pres.master?.background : layout?.background ?? null
    : slide?.background ? { kind: "fill", value: slide.background } : null;
  const shown = mv
    ? resolveBackground(pres.theme, own ?? pres.master?.background ?? { kind: "fill", value: { kind: "none" } })
    : slide ? slideBackground(deck, slide) : null;
  const kind = shown?.kind === "gradient" ? "gradient" : "solid";
  const target = store.backgroundTarget();
  const hidden = mv ? layout?.showMasterShapes === false : slide?.showMasterShapes === false;
  const palette = themePalette(pres.theme);
  const solidColor = own?.kind === "fill" && own.value.kind === "solid" ? own.value.value : undefined;
  const setSolid = (c: Parameters<typeof store.setBackgroundOf>[1] | null) => void store.setBackgroundOf(target, c, mv?.kind === "master" ? undefined : hidden);
  const setGradient = (slot: ThemeColorSlot) => {
    const bg: Background = { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot, tint: 0 } } } };
    if (mv) void store.setBackgroundOf(target, bg);
    else void store.setMasterBackgroundStyle(bg);
  };
  return (
    <aside aria-label={t("show.bg.format")} data-testid="bg-pane" className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l border-ui-border bg-ui-panel p-3 text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("show.bg.format")}</h2>
        <button type="button" className="h-8 w-8 rounded hover:bg-ui-hover" aria-label={t("common.close")} onClick={() => store.toggleBgPane(false)}>
          ×
        </button>
      </div>
      <p className="text-ui-muted" data-testid="bg-target">
        {mv ? (mv.kind === "master" ? t("show.master.master") : layoutName(layout ?? { kind: mv.value })) : t("show.bg.thisSlide")}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("show.bg.fill")}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="bg-kind" checked={kind === "solid"} onChange={() => setSolid({ kind: "fill", value: { kind: "solid", value: { kind: "theme", value: { slot: "light1", tint: 0 } } } })} />
          {t("show.bg.solid")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="bg-kind" checked={kind === "gradient"} onChange={() => setGradient("accent1")} />
          {t("show.bg.gradient")}
        </label>
      </fieldset>
      {kind === "solid" ? (
        <div className="flex items-center justify-between">
          <span>{t("show.bg.color")}</span>
          <ColorPicker label={t("show.bg.color")} kind="fill" value={solidColor} theme={palette} onSelect={(c) => setSolid(c ? { kind: "fill", value: { kind: "solid", value: c } } : null)} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span>{t("show.bg.gradientColor")}</span>
          <div role="group" aria-label={t("show.bg.gradientColor")} className="flex flex-wrap gap-1">
            {GRADIENT_SLOTS.map((slot) => {
              const bg: Background = { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot, tint: 0 } } } };
              return (
                <button
                  key={slot}
                  type="button"
                  aria-label={t("show.bg.gradientOf", { color: t(`show.color.${slot}`) })}
                  className="h-8 w-8 rounded border border-ui-border"
                  style={{ background: fillCssBackground(resolveBackground(pres.theme, bg)) }}
                  onClick={() => setGradient(slot)}
                />
              );
            })}
          </div>
          {!mv && <p className="text-ui-muted">{t("show.bg.gradientMaster")}</p>}
        </div>
      )}
      {mv?.kind !== "master" && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => void store.setBackgroundOf(target, mv ? (own ?? null) : own ?? null, e.currentTarget.checked)}
          />
          {t("show.bg.hideGraphics")}
        </label>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        {!mv && (
          <button type="button" className={PANE_BTN} onClick={() => void store.applyBackgroundToAll()}>
            {t("show.applyAll")}
          </button>
        )}
        <button type="button" className={PANE_BTN} disabled={!own && !hidden} onClick={() => void store.setBackgroundOf(target, null, mv?.kind === "master" ? undefined : false)}>
          {t("show.resetBg")}
        </button>
      </div>
    </aside>
  );
}
