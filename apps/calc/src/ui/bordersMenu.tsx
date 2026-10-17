// Home › Font › Borders ▾ (P9-C1): Excel's border presets, each one
// `setBorders` command (one undo step; the core also clears the facing
// side of the neighbouring cells, as Excel does).

import { Icon, type TFunction as T } from "@rusuite/ui-shared";
import type { BorderEdits } from "../generated/BorderEdits";
import type { BorderSide } from "../generated/BorderSide";
import type { CalcStore } from "../state/store";

export type BorderPreset =
  | "bottom" | "top" | "left" | "right" | "none" | "all" | "outside" | "thickOutside" | "bottomDouble" | "thickBottom" | "topBottom";

const line = (style: BorderSide["style"]) => ({ kind: "line" as const, side: { style, color: { kind: "auto" as const } } });
const NONE = { kind: "none" as const };

/** The edits of a preset (Excel: thin automatic lines; "thick" = medium). */
export function presetEdits(preset: BorderPreset): BorderEdits {
  const thin = line("thin");
  switch (preset) {
    case "bottom":
      return { bottom: thin };
    case "top":
      return { top: thin };
    case "left":
      return { left: thin };
    case "right":
      return { right: thin };
    case "none":
      return { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE, diagonalUp: NONE, diagonalDown: NONE };
    case "all":
      return { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };
    case "outside":
      return { top: thin, bottom: thin, left: thin, right: thin };
    case "thickOutside": {
      const thick = line("medium");
      return { top: thick, bottom: thick, left: thick, right: thick };
    }
    case "bottomDouble":
      return { bottom: line("double") };
    case "thickBottom":
      return { bottom: line("medium") };
    case "topBottom":
      return { top: thin, bottom: thin };
  }
}

const PRESETS: { id: BorderPreset; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "bottom", label: "calc.borders.bottom", icon: "borderBottom" },
  { id: "top", label: "calc.borders.top", icon: "borderTop" },
  { id: "left", label: "calc.borders.left", icon: "borderLeft" },
  { id: "right", label: "calc.borders.right", icon: "borderRight" },
  { id: "none", label: "calc.borders.none", icon: "borderNone" },
  { id: "all", label: "calc.borders.all", icon: "borderAll" },
  { id: "outside", label: "calc.borders.outside", icon: "borderOutline" },
  { id: "thickOutside", label: "calc.borders.thickOutside", icon: "borderOutline" },
  { id: "bottomDouble", label: "calc.borders.bottomDouble", icon: "borderBottom" },
  { id: "thickBottom", label: "calc.borders.thickBottom", icon: "borderBottom" },
  { id: "topBottom", label: "calc.borders.topBottom", icon: "borderTop" },
];

/** Applies a preset to the selection. */
export function applyBorderPreset(store: CalcStore, preset: BorderPreset): Promise<void> {
  const sheet = store.getState().activeSheet;
  return store.apply({ type: "setBorders", sheet, ...store.selectionRange(), edits: presetEdits(preset) });
}

/** The menu items (More Borders… opens Format Cells › Border). */
export function bordersMenu(store: CalcStore, t: T, done: () => void) {
  return [
    ...PRESETS.map((p) => ({
      id: p.id,
      label: t(p.label),
      icon: <Icon name={p.icon} />,
      onSelect: () => {
        void applyBorderPreset(store, p.id);
        done();
      },
    })),
    { separator: true as const },
    { id: "more", label: t("calc.borders.more"), icon: <Icon name="borderAll" />, onSelect: () => store.openDialog({ kind: "numberFormat", tab: "border" }) },
  ];
}
