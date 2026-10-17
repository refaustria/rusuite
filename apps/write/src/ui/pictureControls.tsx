// Picture Format › Arrange: Position ▾ (In Line with Text and Word's nine
// "With Text Wrapping" presets) and Wrap Text ▾. The image's `anchor`
// attribute changes in the editor (the mapper sends `SetImageAnchor`).

import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { RibbonMenuButton } from "@rusuite/ui-shared";
import type { Anchor } from "../generated/Anchor";
import { POSITION_PRESETS, presetAnchor, presetOf, withWrap, WRAP_CHOICES, wrapOf, type PositionPreset, type WrapChoice } from "../features/floating";
import { selectedImage, setImageAttrs } from "../features/images";
import { t } from "../i18n";

const svg = (children: ReactNode) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    {children}
  </svg>
);
const lines = (ys: number[], x1 = 2, x2 = 18) => ys.map((y) => `M${x1} ${y}h${x2 - x1}`).join("");

/** Icons of the wrap choices (text lines around a picture square). */
export const WRAP_ICONS: Record<WrapChoice, ReactNode> = {
  inline: svg(<><path d={lines([4, 16])} /><rect x="7" y="7" width="5" height="6" fill="currentColor" fillOpacity="0.35" /><path d="M2 12h4M13 12h5" /></>),
  square: svg(<><rect x="2.5" y="6" width="7" height="7" fill="currentColor" fillOpacity="0.35" /><path d={`${lines([3, 17])}${lines([7, 10, 13], 11)}`} /></>),
  tight: svg(<><circle cx="6" cy="10" r="3.5" fill="currentColor" fillOpacity="0.35" /><path d={`${lines([3, 17])}${lines([7, 10, 13], 11)}`} /></>),
  through: svg(<><path d="M2.5 13.5l3.5-7 3.5 7z" fill="currentColor" fillOpacity="0.35" /><path d={`${lines([3, 17])}${lines([7, 10, 13], 11)}M5 13h1.5`} /></>),
  topAndBottom: svg(<><rect x="6" y="6.5" width="8" height="7" fill="currentColor" fillOpacity="0.35" /><path d={lines([3, 17])} /></>),
  behind: svg(<><rect x="5" y="4" width="10" height="12" fill="currentColor" fillOpacity="0.2" stroke="none" /><path d={lines([5, 8.5, 12, 15.5])} /></>),
  inFront: svg(<><path d={lines([5, 8.5, 12, 15.5])} /><rect x="5" y="4" width="10" height="12" fill="currentColor" fillOpacity="0.6" stroke="none" /></>),
};

export const presetIcon = (p: PositionPreset) => {
  const [v, h] = p.split("-");
  const x = h === "left" ? 3 : h === "center" ? 7.5 : 12;
  const y = v === "top" ? 3 : v === "middle" ? 7.5 : 12;
  return svg(<><rect x="2" y="2" width="16" height="16" strokeWidth="1" /><rect x={x} y={y} width="5" height="5" fill="currentColor" stroke="none" /></>);
};

/** Applies `anchor` to the selected picture (kept selected). */
export function setSelectedAnchor(editor: Editor, make: (current: Anchor | null) => Anchor | null): boolean {
  const img = selectedImage(editor.state);
  if (!img) return false;
  const ok = setImageAttrs(editor.view, img.pos, { anchor: make((img.node.attrs.anchor as Anchor | null) ?? null) });
  if (ok && !(editor.state.selection instanceof NodeSelection)) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, img.pos)));
  return ok;
}

/** Position ▾ and Wrap Text ▾ for the Picture Format tab. */
export function pictureArrangeItems(editor: Editor, anchor: Anchor | null) {
  const wrap = wrapOf(anchor);
  const preset = presetOf(anchor);
  return (
    <>
      <RibbonMenuButton
        label={t("write.position")}
        icon={presetIcon("middle-center")}
        size="large"
        menu={[
          { id: "inline", label: t("write.inLineWithText"), icon: WRAP_ICONS.inline, checked: wrap === "inline", onSelect: () => setSelectedAnchor(editor, () => null) },
          { separator: true as const, label: t("write.withTextWrapping") },
          ...POSITION_PRESETS.map((p) => ({
            id: p,
            label: t(`write.pos.${p}`),
            icon: presetIcon(p),
            checked: preset === p,
            onSelect: () => setSelectedAnchor(editor, (a) => presetAnchor(a, p)),
          })),
        ]}
      />
      <RibbonMenuButton
        label={t("write.wrapText")}
        icon={WRAP_ICONS.square}
        size="large"
        menu={WRAP_CHOICES.map((w) => ({
          id: w,
          label: t(`write.wrap.${w}`),
          icon: WRAP_ICONS[w],
          checked: wrap === w,
          onSelect: () => setSelectedAnchor(editor, (a) => withWrap(a, w)),
        }))}
      />
    </>
  );
}
