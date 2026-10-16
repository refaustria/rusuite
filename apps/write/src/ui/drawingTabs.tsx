// Ribbon parts of P8-34: Insert › Shapes (the grouped library with outline
// icons from the core) and Text Box ▾, the contextual Shape Format tab of a
// selected shape or text box, the picture formatting of Picture Format
// (Crop, Picture Styles, Picture Border, Corrections, Color, Reset
// Picture) and Home › Font's Change Case ▾ / Text Effects ▾.

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  ColorPicker, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton, RibbonRow, RibbonStack, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab,
} from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Anchor } from "../generated/Anchor";
import type { Drawing } from "../generated/Drawing";
import type { LineDash } from "../generated/LineDash";
import type { PictureFormat } from "../generated/PictureFormat";
import type { Recolor } from "../generated/Recolor";
import type { ShapeLine } from "../generated/ShapeLine";
import type { TextCase } from "../generated/TextCase";
import type { VAlignPos } from "../generated/VAlignPos";
import {
  DEFAULT_LINE, EMU_PER_CM, EMU_PER_PT, LINE_DASHES, LINE_WEIGHTS, SHAPE_GROUPS, SHAPE_STYLES, editSelectedDrawing, flipped, insertDrawing, rotated, withShapeStyle,
  type ShapeStyle,
} from "../features/drawings/drawings";
import { pathQuery, rectOutline, shapePaths } from "../features/drawings/paths";
import { changeCaseCommand, TEXT_CASES } from "../features/changeCase";
import { newAnchor, POSITION_PRESETS, presetAnchor, presetOf, withWrap, WRAP_CHOICES, wrapOf } from "../features/floating";
import { selectedImage } from "../features/images";
import { toggleCropMode } from "../features/imageView";
import { clearEffects, formatTarget, TEXT_EFFECTS, toggleEffect } from "../features/runFormat";
import { colorCss } from "../sync/schema";
import type { RunProperties } from "../sync/model";
import type { SyncController } from "../sync/SyncPlugin";
import { presetIcon, WRAP_ICONS } from "./pictureControls";
import { t } from "../i18n";

const ICON_PX = 18;
const EMU_PER_PX = 9525;

/** Re-renders when shape outlines arrive. */
function usePaths(): number {
  const ver = useRef(0);
  return useSyncExternalStore(
    (fn) =>
      shapePaths.subscribe(() => {
        ver.current++;
        fn();
      }),
    () => ver.current,
  );
}

/** The icon of a preset: its outline from the core (a box until it arrives). */
export function ShapeIcon({ preset }: { preset: string }) {
  usePaths();
  if (preset === "textBox") return <RibbonIcon name="textBox" size={ICON_PX} />;
  const q = pathQuery(preset, ICON_PX * EMU_PER_PX, ICON_PX * EMU_PER_PX);
  const o = shapePaths.get(q) ?? rectOutline(q);
  return (
    <svg aria-hidden="true" width={ICON_PX + 2} height={ICON_PX + 2} viewBox={`${-EMU_PER_PX} ${-EMU_PER_PX} ${q.w + 2 * EMU_PER_PX} ${q.h + 2 * EMU_PER_PX}`} data-shape-icon={preset}>
      {o.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? "currentColor" : "none"} fillOpacity={0.12} stroke="currentColor" strokeWidth={1.2 * EMU_PER_PX} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const shapeItems = (ids: readonly string[]): RibbonGalleryItem[] => ids.map((id) => ({ id, label: t(`write.shape.${id}`), preview: <ShapeIcon preset={id} /> }));

/** The grouped shape library (Insert › Shapes, Change Shape with `presetsOnly`). */
export function ShapeLibrary({ onPick, presetsOnly }: { onPick: (id: string) => void; presetsOnly?: boolean }) {
  const groups = SHAPE_GROUPS.map((g) => ({ ...g, items: presetsOnly ? g.items.filter((i) => i !== "textBox" && i !== "line") : g.items })).filter((g) => g.items.length);
  return (
    <div className="flex max-h-[70vh] w-max flex-col gap-1 overflow-y-auto p-1" data-testid="shape-library">
      {groups.map((g, n) => (
        <section key={g.id} className="flex flex-col gap-0.5">
          <h3 className="px-1 text-[11px] font-medium text-ui-muted">{t(`write.shapeGroup.${g.id}`)}</h3>
          <RibbonGallery label={t(`write.shapeGroup.${g.id}`)} items={shapeItems(g.items)} columns={8} hideLabels itemClassName="h-8 w-8" autoFocus={n === 0} onSelect={onPick} />
        </section>
      ))}
    </div>
  );
}

/** Insert › Illustrations: Shapes ▾ and Text Box ▾. */
export function insertDrawingButtons(editor: Editor, ctl: SyncController): ReactNode {
  const run = (id: string, anchor?: Anchor | null) => void insertDrawing(editor, ctl, id, anchor ? { anchor } : {}).catch((e) => ctl.pushError(e));
  return (
    <>
      <RibbonMenuButton
        label={t("write.shapes")}
        icon="shapes"
        size="large"
        menu={(close) => (
          <ShapeLibrary
            onPick={(id) => {
              close();
              run(id);
            }}
          />
        )}
      />
      <RibbonMenuButton
        label={t("write.textBox")}
        icon="textBox"
        size="large"
        menu={[
          { id: "simple", label: t("write.textBox.simple"), icon: "textBox", onSelect: () => run("textBox") },
          { id: "draw", label: t("write.textBox.draw"), icon: WRAP_ICONS.square, onSelect: () => run("textBox", newAnchor("square")) },
        ]}
      />
    </>
  );
}

// ----- Shape Format -------------------------------------------------------------------

const SAMPLE = "Abc"; // i18n-ignore: sample text of a style preview

function styleItems(): RibbonGalleryItem[] {
  return SHAPE_STYLES.map((s: ShapeStyle, i) => {
    const fill = s.fill.kind === "solid" ? (colorCss(s.fill.value) ?? "none") : "none";
    const stroke = s.line.fill.kind === "solid" ? (colorCss(s.line.fill.value) ?? "#000") : "none";
    const text = s.text ? (colorCss(s.text) ?? "#333") : "#333";
    return {
      id: s.id,
      label: t(`write.shapeStyle.${s.id.split("-")[0]}`, { n: (i % 6) + 1 }),
      preview: (
        <svg aria-hidden="true" width="40" height="22" viewBox="0 0 40 22">
          <rect x="2" y="2" width="36" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
          <text x="20" y="15" textAnchor="middle" fontSize="9" fill={text}>
            {SAMPLE}
          </text>
        </svg>
      ),
    };
  });
}

const weightLabel = (pt: number) => t("write.pt", { n: pt });

/** Shape Outline ▾ / Picture Border ▾ items: weight and dashes of `line` (the colour comes from the picker). */
export function outlineMenu(line: ShapeLine | null | undefined, set: (l: ShapeLine | null) => void): RibbonMenuItem[] {
  const base: ShapeLine = line && line.fill.kind === "solid" ? line : DEFAULT_LINE;
  return [
    { id: "none", label: t("write.noOutline"), checked: !line || line.fill.kind !== "solid", onSelect: () => set(null) },
    { separator: true, label: t("write.weight") },
    ...LINE_WEIGHTS.map((w) => ({
      id: `w-${w}`,
      label: weightLabel(w),
      checked: !!line && line.fill.kind === "solid" && Math.abs(line.width - w * EMU_PER_PT) < 1,
      onSelect: () => set({ ...base, width: Math.round(w * EMU_PER_PT) }),
    })),
    { separator: true, label: t("write.dashes") },
    ...LINE_DASHES.map((d: LineDash) => ({
      id: `d-${d}`,
      label: t(`write.dash.${d}`),
      checked: !!line && line.fill.kind === "solid" && (line.dash ?? "solid") === d,
      onSelect: () => set(d === "solid" ? { fill: base.fill, width: base.width } : { ...base, dash: d }),
    })),
  ];
}

/**
 * Align ▾ (Word's Align Left / Center / Right / Top / Middle / Bottom,
 * relative to the margin): the drawing floats (square wrapping when it was
 * inline) aligned on one axis, the other keeps its position.
 */
export function alignAnchor(a: Anchor | null, to: { h?: "left" | "center" | "right"; v?: "top" | "center" | "bottom" }): Anchor {
  const base = a ?? newAnchor("square");
  return {
    ...base,
    ...(to.h ? { h: { relativeTo: "margin", place: { kind: "align", value: to.h } } } : {}),
    ...(to.v ? { v: { relativeTo: "margin", place: { kind: "align", value: to.v } } } : {}),
  } as Anchor;
}

/** Applies `make(anchor)` to the selected drawing (Position ▾ / Wrap Text ▾). */
function setDrawingAnchor(editor: Editor, make: (a: Anchor | null) => Anchor | null) {
  editSelectedDrawing(editor, (d) => {
    const a = make((d.anchor as Anchor | undefined) ?? null);
    const out: Drawing = { ...d };
    if (a) out.anchor = a;
    else delete out.anchor;
    return out;
  });
}

export function arrangeMenus(anchor: Anchor | null, set: (make: (a: Anchor | null) => Anchor | null) => void): ReactNode {
  const wrap = wrapOf(anchor);
  const preset = presetOf(anchor);
  return (
    <>
      <RibbonMenuButton
        label={t("write.position")}
        icon={presetIcon("middle-center")}
        size="large"
        menu={[
          { id: "inline", label: t("write.inLineWithText"), icon: WRAP_ICONS.inline, checked: wrap === "inline", onSelect: () => set(() => null) },
          { separator: true as const, label: t("write.withTextWrapping") },
          ...POSITION_PRESETS.map((p) => ({ id: p, label: t(`write.pos.${p}`), icon: presetIcon(p), checked: preset === p, onSelect: () => set((a) => presetAnchor(a, p)) })),
        ]}
      />
      <RibbonMenuButton
        label={t("write.wrapText")}
        icon={WRAP_ICONS.square}
        size="large"
        menu={WRAP_CHOICES.map((w) => ({ id: w, label: t(`write.wrap.${w}`), icon: WRAP_ICONS[w], checked: wrap === w, onSelect: () => set((a) => withWrap(a, w)) }))}
      />
    </>
  );
}

function SizeField({ label, value, onCommit }: { label: string; value: number; onCommit: (emu: number) => void }) {
  const text = String(Math.round((value / EMU_PER_CM) * 100) / 100);
  return (
    <label className="flex items-center gap-1 text-[11px] text-ui-fg">
      <span className="w-12">{label}</span>
      <input
        key={text}
        aria-label={label}
        defaultValue={text}
        className="h-6 w-14 rounded border border-ui-border bg-ui-bg px-1 text-[11px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(",", "."));
          if (v > 0 && Math.abs(v * EMU_PER_CM - value) > 100) onCommit(Math.round(v * EMU_PER_CM));
        }}
      />
    </label>
  );
}

const VALIGN_ICON = (v: VAlignPos) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="2.5" y="2.5" width="15" height="15" strokeWidth="1" />
    <path d={v === "top" ? "M6 6h8M6 9h8" : v === "center" ? "M6 8.5h8M6 11.5h8" : "M6 11h8M6 14h8"} />
  </svg>
);

/** The Shape Format tab of the selected drawing. */
export function shapeFormatTab(editor: Editor, ctl: SyncController, d: Drawing, ui: { openDialog: (id: "altText") => void }): RibbonTab {
  const edit = (f: (x: Drawing) => Drawing) => {
    editSelectedDrawing(editor, f);
    editor.commands.focus();
  };
  const text = d.text;
  return {
    id: "shapeFormat",
    label: t("write.shapeFormat"),
    groups: [
      {
        label: t("write.insertShapes"),
        items: (
          <>
            {insertDrawingButtons(editor, ctl)}
            <RibbonMenuButton
              label={t("write.changeShape")}
              icon="shapes"
              showLabel
              menu={(close) => (
                <ShapeLibrary
                  presetsOnly
                  onPick={(id) => {
                    close();
                    edit((x) => {
                      const out = { ...x, preset: id };
                      delete out.adjust;
                      delete out.customGeometry;
                      return out;
                    });
                  }}
                />
              )}
            />
          </>
        ),
      },
      {
        label: t("write.shapeStyles"),
        items: (
          <>
            <RibbonGallery
              label={t("write.shapeStyles")}
              variant="dropdown"
              icon="shapes"
              columns={6}
              items={styleItems()}
              onSelect={(id) => {
                const s = SHAPE_STYLES.find((x) => x.id === id);
                if (s) edit((x) => withShapeStyle(x, s));
              }}
            />
            <RibbonStack>
              <RibbonRow>
                <ColorPicker
                  label={t("write.shapeFill")}
                  kind="fill"
                  value={d.fill?.kind === "solid" ? (d.fill.value as never) : undefined}
                  onSelect={(c) => edit((x) => ({ ...x, fill: c ? { kind: "solid", value: c as Color } : { kind: "none" } }))}
                />
                <ColorPicker
                  label={t("write.shapeOutline")}
                  kind="text"
                  value={d.line?.fill.kind === "solid" ? (d.line.fill.value as never) : undefined}
                  onSelect={(c) => edit((x) => ({ ...x, line: c ? { ...(x.line?.fill.kind === "solid" ? x.line : DEFAULT_LINE), fill: { kind: "solid", value: c as Color } } : { fill: { kind: "none" }, width: 9525 } }))}
                />
                <RibbonMenuButton
                  label={t("write.outlineWeight")}
                  icon="lineSpacing"
                  menu={outlineMenu(d.line, (l) => edit((x) => ({ ...x, line: l ?? { fill: { kind: "none" }, width: 9525 } })))}
                />
              </RibbonRow>
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("write.text"),
        items: (
          <RibbonStack>
            <RibbonMenuButton
              label={t("write.alignText")}
              icon={VALIGN_ICON(text?.verticalAlign ?? "top")}
              showLabel
              disabled={!text}
              menu={(["top", "center", "bottom"] as VAlignPos[]).map((v) => ({
                id: v,
                label: t(`write.valign.${v}`),
                icon: VALIGN_ICON(v),
                checked: (text?.verticalAlign ?? "top") === v,
                onSelect: () => edit((x) => (x.text ? { ...x, text: { ...x.text, verticalAlign: v } } : x)),
              }))}
            />
            <label className="flex min-h-6 items-center gap-1 text-[11px] text-ui-fg">
              <input
                type="checkbox"
                disabled={!text}
                checked={text?.autofit === "resize"}
                onChange={(e) => edit((x) => (x.text ? { ...x, text: { ...x.text, autofit: e.target.checked ? "resize" : "none" } } : x))}
              />
              {t("write.resizeToFit")}
            </label>
          </RibbonStack>
        ),
      },
      {
        label: t("write.accessibility"),
        items: <RibbonButton label={t("write.altText")} icon="textBox" size="large" tooltip={t("write.altTextDots")} onClick={() => ui.openDialog("altText")} />,
      },
      {
        label: t("write.arrange"),
        items: (
          <>
            {arrangeMenus((d.anchor as Anchor | undefined) ?? null, (make) => setDrawingAnchor(editor, make))}
            <RibbonMenuButton
              label={t("write.alignObjects")}
              icon={presetIcon("top-left")}
              size="large"
              menu={(["left", "center", "right"] as const)
                .map((h) => ({ id: `h-${h}`, label: t(`write.alignObj.${h}`), onSelect: () => setDrawingAnchor(editor, (a) => alignAnchor(a, { h })) }))
                .concat((["top", "center", "bottom"] as const).map((v) => ({ id: `v-${v}`, label: t(`write.alignObj.v${v}`), onSelect: () => setDrawingAnchor(editor, (a) => alignAnchor(a, { v })) })))}
            />
            <RibbonMenuButton
              label={t("write.rotate")}
              icon="arrange"
              size="large"
              menu={[
                { id: "right", label: t("write.rotate.right90"), onSelect: () => edit((x) => rotated(x, 90)) },
                { id: "left", label: t("write.rotate.left90"), onSelect: () => edit((x) => rotated(x, -90)) },
                { id: "flipV", label: t("write.rotate.flipV"), onSelect: () => edit((x) => flipped(x, "v")) },
                { id: "flipH", label: t("write.rotate.flipH"), onSelect: () => edit((x) => flipped(x, "h")) },
              ]}
            />
          </>
        ),
      },
      {
        label: t("write.size"),
        items: (
          <RibbonStack>
            <SizeField label={t("write.heightCm")} value={d.height} onCommit={(v) => edit((x) => ({ ...x, height: v }))} />
            <SizeField label={t("write.widthCm")} value={d.width} onCommit={(v) => edit((x) => ({ ...x, width: v }))} />
          </RibbonStack>
        ),
      },
    ],
  };
}

// ----- picture formatting --------------------------------------------------------------

/** Picture Styles (Word's gallery, the ones DrawingML expresses): border, outline shape, shadow. */
export const PICTURE_STYLES: { id: string; format: Pick<PictureFormat, "border" | "geometry" | "shadow"> }[] = [
  { id: "simpleWhite", format: { border: { fill: { kind: "solid", value: { kind: "rgb", value: "FFFFFF" } as never }, width: 85725 }, shadow: true } },
  { id: "simpleBlack", format: { border: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } as never }, width: 76200 } } },
  { id: "thickMatteBlack", format: { border: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } as never }, width: 114300 }, shadow: true } },
  { id: "dropShadow", format: { shadow: true } },
  { id: "rounded", format: { geometry: "roundRect" } },
  { id: "roundedShadow", format: { geometry: "roundRect", shadow: true } },
  { id: "oval", format: { geometry: "ellipse" } },
  { id: "ovalFrame", format: { geometry: "ellipse", border: { fill: { kind: "solid", value: { kind: "rgb", value: "FFFFFF" } as never }, width: 57150 }, shadow: true } },
  { id: "metal", format: { border: { fill: { kind: "solid", value: { kind: "rgb", value: "A6A6A6" } as never }, width: 57150 } } },
  { id: "snipped", format: { geometry: "snip1Rect" } },
];

/** The format with picture style `id` (crop and corrections kept). */
export function withPictureStyle(f: PictureFormat | null | undefined, id: string): PictureFormat {
  const s = PICTURE_STYLES.find((x) => x.id === id);
  const out: PictureFormat = { ...(f ?? {}) };
  delete out.border;
  delete out.geometry;
  delete out.shadow;
  return s ? { ...out, ...s.format } : out;
}

/** Corrections: brightness × contrast in 20 % steps (Word's grid). */
export const CORRECTION_STEPS = [-40000, -20000, 0, 20000, 40000];
export const RECOLORS: Recolor[] = ["none", "grayscale", "sepia", "washout", "blackWhite"];

const pictureStyleItems = (): RibbonGalleryItem[] =>
  PICTURE_STYLES.map((s) => {
    const b = s.format.border;
    const stroke = b && b.fill.kind === "solid" ? (colorCss(b.fill.value) ?? "#000") : "none";
    const sw = b ? Math.max(1, b.width / 25400) : 0;
    const shape =
      s.format.geometry === "ellipse" ? (
        <ellipse cx="20" cy="13" rx="15" ry="9" fill="#9ab7e0" stroke={stroke === "#FFFFFF" ? "#ddd" : stroke} strokeWidth={sw} />
      ) : (
        <rect x="5" y="4" width="30" height="18" rx={s.format.geometry === "roundRect" ? 4 : 0} fill="#9ab7e0" stroke={stroke === "#FFFFFF" ? "#ddd" : stroke} strokeWidth={sw} />
      );
    return {
      id: s.id,
      label: t(`write.picStyle.${s.id}`),
      preview: (
        <svg aria-hidden="true" width="40" height="26" viewBox="0 0 40 26">
          {s.format.shadow && <rect x="7" y="6" width="30" height="18" rx="2" fill="rgba(0,0,0,0.25)" />}
          {shape}
        </svg>
      ),
    };
  });

/** Changes the selected picture's format (kept selected; the mapper sends `SetImageFormat`). */
export function setSelectedFormat(editor: Editor, f: (cur: PictureFormat) => PictureFormat): boolean {
  const img = selectedImage(editor.state);
  if (!img) return false;
  const next = f({ ...((img.node.attrs.format as PictureFormat | null) ?? {}) });
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null && v !== false && v !== 0 && v !== "none")) as PictureFormat;
  const tr = editor.state.tr.setNodeMarkup(img.pos, undefined, { ...img.node.attrs, format: Object.keys(clean).length ? clean : null });
  tr.setSelection(NodeSelection.create(tr.doc, img.pos));
  editor.view.dispatch(tr);
  return true;
}

/** Picture Format groups: Adjust (Corrections, Color, Reset Picture), Picture Styles, Crop. */
export function pictureFormatGroups(editor: Editor, format: PictureFormat | null) {
  const f = format ?? {};
  const corr: RibbonGalleryItem[] = CORRECTION_STEPS.flatMap((c) =>
    CORRECTION_STEPS.map((b) => ({
      id: `${b}:${c}`,
      label: t("write.corrections.item", { b: b / 1000, c: c / 1000 }),
      preview: <span className="block h-6 w-8 rounded-sm" style={{ background: "#7fa7d9", filter: `brightness(${1 + b / 100000}) contrast(${c > 0 ? 1 / (1 - c / 100000) : 1 + c / 100000})` }} />,
    })),
  );
  return [
    {
      label: t("write.adjust"),
      items: (
        <>
          <RibbonGallery
            label={t("write.corrections")}
            variant="dropdown"
            icon="image"
            columns={5}
            items={corr}
            selected={`${f.brightness ?? 0}:${f.contrast ?? 0}`}
            onSelect={(id) => {
              const [b, c] = id.split(":").map(Number);
              setSelectedFormat(editor, (x) => ({ ...x, brightness: b, contrast: c }));
            }}
          />
          <RibbonMenuButton
            label={t("write.color")}
            icon="image"
            size="large"
            menu={RECOLORS.map((r) => ({ id: r, label: t(`write.recolor.${r}`), checked: (f.recolor ?? "none") === r, onSelect: () => setSelectedFormat(editor, (x) => ({ ...x, recolor: r })) }))}
          />
          <RibbonButton label={t("write.resetPicture")} icon="undo" size="large" onClick={() => setSelectedFormat(editor, () => ({}))} />
        </>
      ),
    },
    {
      label: t("write.pictureStyles"),
      items: (
        <>
          <RibbonGallery label={t("write.pictureStyles")} variant="dropdown" icon="image" columns={5} items={pictureStyleItems()} onSelect={(id) => setSelectedFormat(editor, (x) => withPictureStyle(x, id))} />
          <RibbonStack>
            <ColorPicker
              label={t("write.pictureBorder")}
              kind="text"
              value={f.border?.fill.kind === "solid" ? (f.border.fill.value as never) : undefined}
              onSelect={(c) => setSelectedFormat(editor, (x) => {
                if (!c) {
                  const out = { ...x };
                  delete out.border;
                  return out;
                }
                return { ...x, border: { ...(x.border?.fill.kind === "solid" ? x.border : { width: 9525 }), fill: { kind: "solid", value: c as Color } } as ShapeLine };
              })}
            />
            <RibbonMenuButton
              label={t("write.borderWeight")}
              icon="lineSpacing"
              menu={outlineMenu(f.border, (l) =>
                setSelectedFormat(editor, (x) => {
                  const out = { ...x };
                  if (l) out.border = l.fill.kind === "solid" ? l : { ...l, fill: { kind: "solid", value: { kind: "rgb", value: "000000" } as never } };
                  else delete out.border;
                  return out;
                }),
              )}
            />
          </RibbonStack>
        </>
      ),
    },
    {
      label: t("write.cropGroup"),
      items: (
        <RibbonButton
          label={t("write.crop")}
          icon={CROP_ICON}
          size="large"
          tooltip={t("write.cropTip")}
          onClick={() => {
            const img = selectedImage(editor.state);
            if (img) toggleCropMode(editor.view, img.pos);
          }}
        />
      ),
    },
  ];
}

const CROP_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 1v14h14M1 5h14v14" />
  </svg>
);

// ----- Home › Font extras --------------------------------------------------------------

const CASE_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M2 15l4-10 4 10M3.5 11.5h5" />
    <path d="M13 12a2.5 2.5 0 1 0 5 0v-2.5M18 15v-5.5a2.5 2.5 0 0 0-4.6-1.3" />
  </svg>
);
const EFFECTS_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M4 16L9 3l5 13M6 11h6" />
    <path d="M6 17L11 4l5 13" strokeOpacity="0.4" />
  </svg>
);

/** Change Case ▾ and Text Effects ▾ (Home › Font). */
export function fontExtras(editor: Editor, ctl: SyncController, props: RunProperties): ReactNode {
  const target = () => formatTarget(editor);
  return (
    <>
      <RibbonMenuButton
        label={t("write.changeCase")}
        icon={CASE_ICON}
        menu={TEXT_CASES.map((c: TextCase) => ({
          id: c,
          label: t(`write.case.${c}`),
          onSelect: () => {
            const cmd = changeCaseCommand(target(), c);
            if (cmd) void ctl.run(cmd);
          },
        }))}
      />
      <RibbonMenuButton
        label={t("write.textEffects")}
        icon={EFFECTS_ICON}
        menu={[
          ...TEXT_EFFECTS.map((fx) => ({
            id: fx,
            label: t(`write.font.fx.${fx}`),
            checked: !!props[fx],
            onSelect: () => {
              toggleEffect(target(), fx, props);
            },
          })),
          { separator: true as const },
          { id: "clear", label: t("write.clearEffects"), onSelect: () => void clearEffects(target()) },
        ]}
      />
    </>
  );
}
