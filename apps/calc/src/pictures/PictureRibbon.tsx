// The contextual Picture Format tab while a picture is selected (P9-C7):
// Adjust › Transparency, Picture Styles › Picture Border, Accessibility ›
// Alt Text, Arrange › Bring Forward / Send Backward, Properties (move and
// size with cells / move but don't size / don't move or size), Size › Crop.

import { RibbonButton, RibbonMenuButton, RibbonStack, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { Color } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { altTextIcon, cropIcon, pictureBorderIcon, propertiesIcon, transparencyIcon } from "../ui/icons";

/** Excel's transparency presets (percent). */
export const TRANSPARENCY_PRESETS = [0, 15, 30, 50, 65, 80, 95];
/** Border weights (pt) of the Weight submenu. */
export const BORDER_WEIGHTS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
const EMU_PER_PT = 12700;

/** A few border colours (the theme's text and accents, red). */
export const BORDER_COLORS: { key: string; color: Color }[] = [
  { key: "black", color: { kind: "theme", value: { slot: "dark1", tint: 0 } } },
  { key: "blue", color: { kind: "theme", value: { slot: "accent1", tint: 0 } } },
  { key: "orange", color: { kind: "theme", value: { slot: "accent2", tint: 0 } } },
  { key: "gray", color: { kind: "theme", value: { slot: "accent3", tint: 0 } } },
  { key: "red", color: { kind: "rgb", value: "C00000" } },
  { key: "white", color: { kind: "theme", value: { slot: "light1", tint: 0 } } },
];

export function pictureFormatTab(store: CalcStore, t: T): RibbonTab | null {
  const pics = store.pictures;
  const p = pics.active();
  if (!p) return null;
  const run = (fn: () => unknown) => () => {
    void fn();
    store.focusGrid();
  };
  const placement = pics.placement();
  const line = p.line;
  const width = line?.width ?? 9525;
  return {
    id: "pictureFormat",
    label: t("calc.picture.formatTab"),
    groups: [
      {
        label: t("calc.picture.adjust"),
        items: (
          <RibbonMenuButton
            label={t("calc.picture.transparency")}
            icon={transparencyIcon()}
            size="large"
            menu={TRANSPARENCY_PRESETS.map((n) => ({
              id: `t${n}`,
              label: t("calc.picture.transparencyN", { n }),
              checked: (p.transparency ?? 0) === n,
              onSelect: run(() => pics.format({ transparency: n })),
            }))}
          />
        ),
      },
      {
        label: t("calc.picture.styles"),
        items: (
          <RibbonMenuButton
            label={t("calc.picture.border")}
            icon={pictureBorderIcon()}
            size="large"
            menu={[
              { id: "none", label: t("calc.picture.noOutline"), checked: !line, onSelect: run(() => pics.format({ noLine: true })) },
              ...BORDER_COLORS.map((c) => ({
                id: `c-${c.key}`,
                label: t(`calc.picture.color.${c.key}`),
                checked: !!line && JSON.stringify(line.color) === JSON.stringify(c.color),
                onSelect: run(() => pics.format({ line: { color: c.color, width } })),
              })),
              ...BORDER_WEIGHTS.map((w) => ({
                id: `w${w}`,
                label: t("calc.picture.weight", { n: w }),
                checked: !!line && Math.round(line.width) === Math.round(w * EMU_PER_PT),
                onSelect: run(() => pics.format({ line: { color: line?.color ?? BORDER_COLORS[0]!.color, width: Math.round(w * EMU_PER_PT) } })),
              })),
            ]}
          />
        ),
      },
      {
        label: t("calc.picture.accessibility"),
        items: <RibbonButton label={t("calc.picture.altText")} icon={altTextIcon()} size="large" onClick={() => store.openDialog({ kind: "pictureAltText" })} />,
      },
      {
        label: t("calc.picture.arrange"),
        items: (
          <>
            <RibbonStack>
              <RibbonMenuButton
                label={t("calc.picture.bringForward")}
                icon="arrange"
                showLabel
                menu={[
                  { id: "forward", label: t("calc.picture.bringForward"), onSelect: run(() => pics.reorder("forward")) },
                  { id: "front", label: t("calc.picture.bringToFront"), onSelect: run(() => pics.reorder("front")) },
                ]}
              />
              <RibbonMenuButton
                label={t("calc.picture.sendBackward")}
                icon="arrange"
                showLabel
                menu={[
                  { id: "backward", label: t("calc.picture.sendBackward"), onSelect: run(() => pics.reorder("backward")) },
                  { id: "back", label: t("calc.picture.sendToBack"), onSelect: run(() => pics.reorder("back")) },
                ]}
              />
            </RibbonStack>
            <RibbonMenuButton
              label={t("calc.picture.properties")}
              icon={propertiesIcon()}
              size="large"
              menu={[
                { id: "moveAndSize", label: t("calc.picture.moveAndSize"), checked: placement === "moveAndSize", onSelect: run(() => pics.format({ placement: "moveAndSize" })) },
                { id: "move", label: t("calc.picture.move"), checked: placement === "move", onSelect: run(() => pics.format({ placement: "move" })) },
                { id: "fixed", label: t("calc.picture.fixed"), checked: placement === "fixed", onSelect: run(() => pics.format({ placement: "fixed" })) },
              ]}
            />
          </>
        ),
      },
      {
        label: t("calc.picture.size"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("calc.picture.crop")} icon={cropIcon()} showLabel pressed={pics.cropping} onClick={() => pics.toggleCrop()} />
            <RibbonButton
              label={t("calc.picture.resetCrop")}
              icon="refresh"
              showLabel
              disabled={!p.crop}
              onClick={run(() => pics.format({ crop: { left: 0, top: 0, right: 0, bottom: 0 } }))}
            />
          </RibbonStack>
        ),
      },
    ],
  };
}
