// Sparklines in Calc's ribbon (P9-C6): Insert › Sparklines (Line, Column,
// Win/Loss) and the contextual Sparkline tab while the active cell holds a
// sparkline: Edit Data ▾, Type, Show (high/low/negative/first/last points,
// markers), the Style gallery (36), Sparkline Color ▾ (with weight), Marker
// Color ▾, Axis ▾, Group, Ungroup, Clear ▾.

import { ColorPicker, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonGroup, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { SparklineColors } from "../generated/SparklineColors";
import type { SparklineGroup } from "../generated/SparklineGroup";
import type { SparklineKind } from "../generated/SparklineKind";
import type { CalcStore } from "../state/store";
import { clearSelected, groupSelected, groupsIn, ungroupSelected } from "./controller";
import { normalize } from "../grid/Selection";
import { sparkOpsSvg, sparklineOps } from "./render";
import { sparklineStyle, styleOf } from "./styles";

const SAMPLE = { values: [3, 5, 2, -1, 4, 6, 4] };

/** A small icon of a sparkline type (or a style's look). */
export function SparkPreview({ group, width = 32, height = 20 }: { group: SparklineGroup; width?: number; height?: number }) {
  const svg = sparkOpsSvg(sparklineOps(group, SAMPLE, { x: 0, y: 0, w: width, h: height }), width, height);
  // The SVG is generated from numbers only (no user text).
  return <span aria-hidden="true" className="inline-block" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const kindIcon = (kind: SparklineKind) => <SparkPreview group={{ kind, sparklines: [], negative: kind === "winLoss", high: kind === "line" }} width={24} height={20} />;

/** Insert › Sparklines: Line, Column, Win/Loss (the Create Sparklines dialog). */
export function sparklineInsertGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  const open = (sparkKind: SparklineKind) => () => store.openDialog({ kind: "sparklines", sparkKind });
  return {
    label: t("calc.spark.group"),
    items: (
      <>
        <RibbonButton label={t("calc.spark.line")} icon={kindIcon("line")} size="large" disabled={off} onClick={open("line")} />
        <RibbonButton label={t("calc.spark.column")} icon={kindIcon("column")} size="large" disabled={off} onClick={open("column")} />
        <RibbonButton label={t("calc.spark.winLoss")} icon={kindIcon("winLoss")} size="large" disabled={off} onClick={open("winLoss")} />
      </>
    ),
  };
}

const WEIGHTS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];

/** The contextual Sparkline tab (`null`: no sparkline at the active cell). */
export function sparklineTab(store: CalcStore, t: T): RibbonTab | null {
  const a = store.sparklines.active();
  if (!a) return null;
  const ctl = store.sparklines;
  const g = a.view.group;
  const kind = g.kind ?? "line";
  const colors: SparklineColors = g.colors ?? sparklineStyle(1);
  const style = styleOf(g.colors);
  const st = store.getState();
  const groupsSel = groupsIn(ctl.groups(st.activeSheet), normalize(st.selection));
  const done = () => store.focusGrid();
  const fmt = (patch: Partial<SparklineGroup>) => () => {
    void ctl.format(patch);
    done();
  };
  const flag = (key: "high" | "low" | "negative" | "first" | "last" | "markers", label: string) => (
    <label key={key} className="flex items-center gap-1 text-xs">
      <input type="checkbox" aria-label={label} data-testid={`spark-${key}`} checked={!!g[key]} disabled={key === "markers" && kind !== "line"} onChange={(e) => void ctl.format({ [key]: e.target.checked || undefined })} />
      {label}
    </label>
  );
  const colorItem = (key: keyof SparklineColors, label: string) => (
    <div key={key} className="flex items-center justify-between gap-2 px-2 py-0.5 text-sm">
      <span>{label}</span>
      <ColorPicker label={label} kind="fill" value={colors[key]} onSelect={(c) => c && void ctl.format((x) => ({ ...x, colors: { ...(x.colors ?? sparklineStyle(1)), [key]: c } }))} />
    </div>
  );
  return {
    id: "sparkline",
    label: t("calc.spark.tab"),
    groups: [
      {
        label: t("calc.spark.sparkline"),
        items: (
          <RibbonMenuButton
            label={t("calc.spark.editData")}
            icon="rename"
            size="large"
            menu={[
              { id: "group", label: t("calc.spark.editGroup"), onSelect: () => store.openDialog({ kind: "sparklines", sparkKind: kind, group: a.gi }) },
              { id: "single", label: t("calc.spark.editSingle"), onSelect: () => store.openDialog({ kind: "sparklineSingle" }) },
              { separator: true },
              { id: "hidden", label: t("calc.spark.hiddenEmpty"), onSelect: () => store.openDialog({ kind: "sparklineHidden" }) },
            ]}
          />
        ),
      },
      {
        label: t("calc.spark.type"),
        items: (
          <>
            {(["line", "column", "winLoss"] as const).map((k) => (
              <RibbonButton key={k} label={t(`calc.spark.${k}`)} icon={kindIcon(k)} size="large" pressed={kind === k} onClick={fmt({ kind: k === "line" ? undefined : k, ...(k !== "line" ? { markers: undefined } : {}) })} />
            ))}
          </>
        ),
      },
      {
        label: t("calc.spark.show"),
        items: (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {flag("high", t("calc.spark.high"))}
            {flag("first", t("calc.spark.first"))}
            {flag("low", t("calc.spark.low"))}
            {flag("last", t("calc.spark.last"))}
            {flag("negative", t("calc.spark.negative"))}
            {flag("markers", t("calc.spark.markers"))}
          </div>
        ),
      },
      {
        label: t("calc.spark.style"),
        items: (
          <RibbonMenuButton
            label={t("calc.spark.styleGallery")}
            icon={<SparkPreview group={g} width={28} height={22} />}
            size="large"
            menu={(close) => (
              <div data-testid="spark-style-gallery">
                <RibbonGallery
                  label={t("calc.spark.styleGallery")}
                  items={Array.from({ length: 36 }, (_, i) => ({
                    id: String(i + 1),
                    label: t("calc.spark.styleN", { n: i + 1 }),
                    preview: <SparkPreview group={{ ...g, colors: sparklineStyle(i + 1), high: true, low: true, first: true, last: true }} width={36} height={22} />,
                  }))}
                  selected={style ? String(style) : undefined}
                  columns={6}
                  hideLabels
                  itemClassName="h-[30px] w-[42px] p-0.5"
                  autoFocus
                  onSelect={(id) => {
                    close();
                    void ctl.format({ colors: sparklineStyle(Number(id)) });
                    done();
                  }}
                />
              </div>
            )}
          />
        ),
      },
      {
        label: t("calc.spark.colors"),
        items: (
          <RibbonStack>
            <RibbonMenuButton
              label={t("calc.spark.color")}
              icon={<span aria-hidden="true" className="inline-block h-3 w-4" style={{ background: "currentColor", opacity: 0.6 }} />}
              showLabel
              menu={() => (
                <div className="flex flex-col gap-1 p-1">
                  {colorItem("series", t("calc.spark.color"))}
                  {kind === "line" && (
                    <>
                      <div className="px-2 text-[11px] font-medium text-ui-muted">{t("calc.spark.weight")}</div>
                      {WEIGHTS.map((w) => (
                        <button key={w} type="button" className={`rounded px-2 py-0.5 text-left text-sm hover:bg-ui-hover ${(g.lineWeight ?? 0.75) === w ? "font-semibold" : ""}`} onClick={() => void ctl.format({ lineWeight: w === 0.75 ? undefined : w })}>
                          {w} pt
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            />
            <RibbonMenuButton
              label={t("calc.spark.markerColor")}
              icon={<span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "currentColor", opacity: 0.6 }} />}
              showLabel
              menu={() => (
                <div className="flex flex-col p-1" data-testid="spark-marker-colors">
                  {colorItem("negative", t("calc.spark.negative"))}
                  {kind === "line" && colorItem("markers", t("calc.spark.markers"))}
                  {colorItem("high", t("calc.spark.high"))}
                  {colorItem("low", t("calc.spark.low"))}
                  {colorItem("first", t("calc.spark.first"))}
                  {colorItem("last", t("calc.spark.last"))}
                </div>
              )}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.spark.groupLabel"),
        items: (
          <>
            <RibbonMenuButton
              label={t("calc.spark.axis")}
              icon="gridlines"
              size="large"
              menu={[
                { separator: true, label: t("calc.spark.horizontal") },
                { id: "general", label: t("calc.spark.generalAxis"), checked: !g.dateRange, onSelect: fmt({ dateRange: undefined }) },
                { id: "dates", label: t("calc.spark.dateAxis"), checked: !!g.dateRange, onSelect: () => store.openDialog({ kind: "sparklineAxis", which: "dates" }) },
                { id: "showAxis", label: t("calc.spark.showAxis"), checked: !!g.showAxis, onSelect: fmt({ showAxis: g.showAxis ? undefined : true }) },
                { id: "rtl", label: t("calc.spark.rtl"), checked: !!g.rightToLeft, onSelect: fmt({ rightToLeft: g.rightToLeft ? undefined : true }) },
                { separator: true, label: t("calc.spark.verticalMin") },
                { id: "minEach", label: t("calc.spark.autoEach"), checked: !g.minAxis || g.minAxis.type === "individual", onSelect: fmt({ minAxis: undefined }) },
                { id: "minSame", label: t("calc.spark.sameAll"), checked: g.minAxis?.type === "group", onSelect: fmt({ minAxis: { type: "group" } }) },
                { id: "minCustom", label: t("calc.spark.customValueDots"), checked: g.minAxis?.type === "custom", onSelect: () => store.openDialog({ kind: "sparklineAxis", which: "min" }) },
                { separator: true, label: t("calc.spark.verticalMax") },
                { id: "maxEach", label: t("calc.spark.autoEach"), checked: !g.maxAxis || g.maxAxis.type === "individual", onSelect: fmt({ maxAxis: undefined }) },
                { id: "maxSame", label: t("calc.spark.sameAll"), checked: g.maxAxis?.type === "group", onSelect: fmt({ maxAxis: { type: "group" } }) },
                { id: "maxCustom", label: t("calc.spark.customValueDots"), checked: g.maxAxis?.type === "custom", onSelect: () => store.openDialog({ kind: "sparklineAxis", which: "max" }) },
              ]}
            />
            <RibbonStack>
              <RibbonButton label={t("calc.spark.groupCmd")} icon="arrange" showLabel disabled={groupsSel.length < 2} onClick={() => void ctl.edit(groupSelected).then(done)} />
              <RibbonButton label={t("calc.spark.ungroup")} icon="duplicate" showLabel disabled={!groupsSel.some((i) => (ctl.groups(st.activeSheet)[i]?.sparklines.length ?? 0) > 1)} onClick={() => void ctl.edit(ungroupSelected).then(done)} />
            </RibbonStack>
            <RibbonMenuButton
              label={t("calc.spark.clear")}
              icon="clear"
              size="large"
              menu={[
                { id: "clearSel", label: t("calc.spark.clearSelected"), onSelect: () => void ctl.edit((gs, sel) => clearSelected(gs, sel, false)).then(done) },
                { id: "clearGroups", label: t("calc.spark.clearGroups"), onSelect: () => void ctl.edit((gs, sel) => clearSelected(gs, sel, true)).then(done) },
              ]}
            />
          </>
        ),
      },
    ],
  };
}
