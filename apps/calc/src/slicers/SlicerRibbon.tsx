// Slicers in Calc's ribbon (P9-C2): Insert › Filters › Slicer, the Insert
// Slicer buttons of Table Design and PivotTable Analyze, and the
// contextual Slicer tab while a slicer is selected: caption, Report
// Connections, Slicer Settings, the Slicer Styles gallery, button
// columns / height / width and the slicer size.

import { useEffect, useState } from "react";
import { RIBBON_SELECT, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonGroup, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import { EMU_PER_PX } from "../charts/anchor";
import { t as translate } from "../i18n";
import type { CalcStore } from "../state/store";
import { buttonPx } from "./controller";
import { connectionsIcon, slicerIcon, slicerSettingsIcon } from "./icons";
import { DEFAULT_SLICER_STYLE, SLICER_STYLES, slicerColors, slicerStyleNumber } from "./styles";

/** Insert Slicer: the dialog for the table or pivot table of the active cell (else an error). */
export function openInsertSlicer(store: CalcStore): void {
  const table = store.tables.active();
  if (table) {
    store.openDialog({ kind: "insertSlicers", table: table.id });
    return;
  }
  const pivot = store.pivots.active();
  if (pivot) {
    void store.pivots.ensureInfo(pivot.id).then(() => store.openDialog({ kind: "insertSlicers", pivot: pivot.id }));
    return;
  }
  store.pushError(new Error(translate("calc.slicer.needSource")));
}

/** Insert › Filters: Slicer. */
export function slicerInsertGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  return {
    label: t("calc.slicer.filters"),
    items: <RibbonButton label={t("calc.slicer.slicer")} icon={slicerIcon()} size="large" tooltip={t("calc.slicer.insertTip")} disabled={off} onClick={() => openInsertSlicer(store)} />,
  };
}

/** The Insert Slicer button of Table Design and PivotTable Analyze. */
export function insertSlicerButton(store: CalcStore, t: T) {
  return <RibbonButton label={t("calc.slicer.insert")} icon={slicerIcon()} size="large" onClick={() => openInsertSlicer(store)} />;
}

/** A style's gallery preview: the frame, two selected and one unselected button. */
export function SlicerStylePreview({ id, width = 40, height = 46 }: { id: string; width?: number; height?: number }) {
  const c = slicerColors(id);
  const bh = (height - 14) / 3;
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill={c.background} stroke={c.frame} />
      <rect x={4} y={3} width={width * 0.5} height={3} fill={c.caption} opacity={0.7} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={4} y={10 + i * (bh + 1)} width={width - 8} height={bh - 1} fill={i < 2 ? c.on : c.off} stroke={c.border} strokeWidth={0.5} />
      ))}
    </svg>
  );
}

const styleLabel = (t: T, id: string) => {
  const s = slicerStyleNumber(id);
  return s ? t(`calc.slicer.style.${s.family}`, { n: s.n }) : id;
};

/** A number box committing on Enter / blur (`scale`: shown units per stored unit). */
function NumberBox({ label, value, min, max, step = 1, onCommit, testId }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (v: number) => void; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="w-14">{label}</span>
      <input
        aria-label={label}
        data-testid={testId}
        className={`${RIBBON_SELECT} w-16`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={commit}
      />
    </label>
  );
}

/** Centimetres with one decimal of a px length. */
const cm = (px: number) => Math.round((px / 96) * 2.54 * 100) / 100;
const fromCm = (v: number) => (v / 2.54) * 96;

/** The contextual Slicer tab (`null`: no slicer selected). */
export function slicerTab(store: CalcStore, t: T): RibbonTab | null {
  const v = store.slicers.active();
  if (!v) return null;
  const ctl = store.slicers;
  const id = v.slicer.id;
  const sheet = store.getState().activeSheet;
  const rect = ctl.rect(sheet, v);
  const style = v.slicer.style || DEFAULT_SLICER_STYLE;
  return {
    id: "slicer",
    label: t("calc.slicer.tab"),
    groups: [
      {
        label: t("calc.slicer.slicer"),
        items: (
          <>
            <RibbonStack>
              <label className="flex items-center gap-1 text-xs">
                <span>{t("calc.slicer.caption")}</span>
                <input
                  key={`${id}:${v.slicer.caption}`}
                  aria-label={t("calc.slicer.captionField")}
                  className={`${RIBBON_SELECT} w-28`}
                  defaultValue={v.slicer.caption}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    if (e.target.value !== v.slicer.caption) void ctl.update(id, { caption: e.target.value });
                  }}
                />
              </label>
              <RibbonButton
                label={t("calc.slicer.connections")}
                icon={connectionsIcon(16)}
                showLabel
                disabled={v.source.kind !== "pivot"}
                onClick={() => store.openDialog({ kind: "slicerConnections", id })}
              />
              <RibbonButton label={t("calc.slicer.settings")} icon={slicerSettingsIcon(16)} showLabel onClick={() => store.openDialog({ kind: "slicerSettings", id })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.slicer.styles"),
        items: (
          <RibbonMenuButton
            label={t("calc.slicer.stylesGallery")}
            icon={<SlicerStylePreview id={style} width={24} height={28} />}
            size="large"
            menu={(close) => (
              <div className="flex flex-col gap-1" data-testid="slicer-style-gallery">
                {(["light", "other", "dark"] as const).map((family, i) => (
                  <div key={family}>
                    <div className="px-1 text-[11px] font-medium text-ui-muted">{t(`calc.slicer.styleGroup.${family}`)}</div>
                    <RibbonGallery
                      label={t(`calc.slicer.styleGroup.${family}`)}
                      items={SLICER_STYLES.filter((s) => slicerStyleNumber(s)?.family === family).map((s) => ({ id: s, label: styleLabel(t, s), preview: <SlicerStylePreview id={s} /> }))}
                      selected={style}
                      columns={6}
                      hideLabels
                      itemClassName="h-[52px] w-[46px] p-0.5"
                      autoFocus={i === 0}
                      onSelect={(s) => {
                        close();
                        void ctl.update(id, { style: s });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          />
        ),
      },
      {
        label: t("calc.slicer.buttons"),
        items: (
          <RibbonStack>
            <NumberBox label={t("calc.slicer.columns")} value={v.slicer.columns ?? 1} min={1} max={20000} testId="slicer-columns" onCommit={(n) => void ctl.update(id, { columns: Math.round(n) })} />
            <NumberBox
              label={t("calc.slicer.buttonHeight")}
              value={cm(buttonPx(v))}
              min={0.1}
              max={50}
              step={0.1}
              onCommit={(n) => void ctl.update(id, { rowHeight: Math.round(fromCm(n) * EMU_PER_PX) })}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.slicer.size"),
        items: (
          <RibbonStack>
            <NumberBox label={t("calc.slicer.height")} value={cm(rect.h)} min={0.5} max={500} step={0.1} onCommit={(n) => void ctl.setRect(id, { ...rect, h: fromCm(n) })} />
            <NumberBox label={t("calc.slicer.width")} value={cm(rect.w)} min={0.5} max={500} step={0.1} onCommit={(n) => void ctl.setRect(id, { ...rect, w: fromCm(n) })} />
          </RibbonStack>
        ),
      },
    ],
  };
}
