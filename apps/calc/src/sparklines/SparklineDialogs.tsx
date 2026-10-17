// Sparkline dialogs (P9-C6): Insert › Sparklines / Edit Group Location &
// Data (data range and location range with range pickers), Edit Single
// Sparkline's Data, Hidden & Empty Cells, and the axis' custom value / date
// range. OK sends one `setSparklineGroups` command.

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import { normalize } from "../grid/Selection";
import { cellAddress, colName } from "../grid/address";
import { useT } from "../i18n";
import type { CalcDialog, CalcStore } from "../state/store";
import { OkCancel, PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { editSelected, groupRanges } from "./controller";

const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function close(store: CalcStore): void {
  store.closeDialog();
  store.focusGrid();
}

/** The selection as `A1:B2` (the dialogs' default ranges, without the sheet). */
function selectionText(store: CalcStore): string {
  const r = normalize(store.getState().selection);
  const a = cellAddress(r.r0, r.c0);
  return r.r0 === r.r1 && r.c0 === r.c1 ? a : `${a}:${colName(r.c1)}${r.r1 + 1}`;
}

function InsertDialog({ store, dialog }: { store: CalcStore; dialog: Extract<CalcDialog, { kind: "sparklines" }> }) {
  const t = useT();
  const editing = dialog.group !== undefined ? store.sparklines.groups(store.getState().activeSheet)[dialog.group] : undefined;
  const initial = editing ? groupRanges(editing) : { data: selectionText(store), location: "" };
  const [data, setData] = useState(initial.data);
  const [location, setLocation] = useState(initial.location);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const strip = (v: string) => v.replace(/^=/, "");
  return (
    <Dialog open title={t(editing ? "calc.spark.editGroup" : "calc.spark.create")} onClose={() => close(store)}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        data-testid="sparkline-dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await store.sparklines.insert(dialog.sparkKind, strip(data), strip(location), dialog.group);
          if (err) setError(err);
          else close(store);
        }}
      >
        <div className="text-xs text-ui-muted">{t("calc.spark.chooseData")}</div>
        <RangeField label={t("calc.spark.dataRange")} testId="spark-data" value={data} onChange={setData} onPick={(p) => setPicker({ ...p, set: (v) => setData(strip(v)) })} />
        <div className="text-xs text-ui-muted">{t("calc.spark.chooseLocation")}</div>
        <RangeField label={t("calc.spark.locationRange")} testId="spark-location" value={location} onChange={setLocation} onPick={(p) => setPicker({ ...p, set: (v) => setLocation(strip(v)) })} />
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        <OkCancel onCancel={() => close(store)} okDisabled={!data.trim() || !location.trim()} />
      </form>
    </Dialog>
  );
}

function SingleDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const a = store.sparklines.active();
  const [data, setData] = useState(a ? a.view.group.sparklines[a.si]!.data : "");
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  if (!a) return null;
  return (
    <Dialog open title={t("calc.spark.editSingle")} onClose={() => close(store)}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await store.sparklines.editSingle(data.replace(/^=/, ""));
          if (err) setError(err);
          else close(store);
        }}
      >
        <RangeField label={t("calc.spark.singleData", { cell: cellAddress(a.view.group.sparklines[a.si]!.row, a.view.group.sparklines[a.si]!.col) })} testId="spark-single" value={data} onChange={setData} onPick={(p) => setPicker({ ...p, set: (v) => setData(v.replace(/^=/, "")) })} />
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        <OkCancel onCancel={() => close(store)} />
      </form>
    </Dialog>
  );
}

function HiddenDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const g = store.sparklines.active()?.view.group;
  const [empty, setEmpty] = useState(g?.emptyCells ?? "gap");
  const [hidden, setHidden] = useState(!!g?.displayHidden);
  if (!g) return null;
  return (
    <Dialog open title={t("calc.spark.hiddenEmpty")} onClose={() => close(store)}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void store.sparklines.edit((groups, sel) => editSelected(groups, sel, (x) => ({ ...x, emptyCells: empty === "gap" ? undefined : empty, displayHidden: hidden || undefined })));
          close(store);
        }}
      >
        <div className="text-xs text-ui-muted">{t("calc.spark.showEmptyAs")}</div>
        {(["gap", "zero", "span"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="spark-empty" checked={empty === k} disabled={k === "span" && g.kind !== undefined && g.kind !== "line"} onChange={() => setEmpty(k)} />
            {t(`calc.chart.blanks.${k}`)}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t("calc.chart.showHidden")}
        </label>
        <OkCancel onCancel={() => close(store)} />
      </form>
    </Dialog>
  );
}

function AxisDialog({ store, which }: { store: CalcStore; which: "min" | "max" | "dates" }) {
  const t = useT();
  const g = store.sparklines.active()?.view.group;
  const cur = which === "dates" ? (g?.dateRange ?? "") : (() => {
    const a = which === "min" ? g?.minAxis : g?.maxAxis;
    return a?.type === "custom" ? String(a.value) : "0.0";
  })();
  const [text, setText] = useState(cur);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  if (!g) return null;
  return (
    <Dialog open title={t(which === "dates" ? "calc.spark.dateRange" : which === "min" ? "calc.spark.customMin" : "calc.spark.customMax")} onClose={() => close(store)}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (which === "dates") {
            const d = text.replace(/^=/, "").trim();
            void store.sparklines.format((x) => ({ ...x, dateRange: d || undefined }));
          } else {
            const n = Number(text.replace(",", "."));
            if (!Number.isFinite(n)) return;
            void store.sparklines.format((x) => ({ ...x, [which === "min" ? "minAxis" : "maxAxis"]: { type: "custom", value: n } }));
          }
          close(store);
        }}
      >
        {which === "dates" ? (
          <RangeField label={t("calc.spark.dateRangeLabel")} testId="spark-dates" value={text} onChange={setText} onPick={(p) => setPicker({ ...p, set: (v) => setText(v.replace(/^=/, "")) })} />
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs">{t("calc.spark.customValue")}</span>
            <input className={FIELD} aria-label={t("calc.spark.customValue")} data-testid="spark-axis-value" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <OkCancel onCancel={() => close(store)} />
      </form>
    </Dialog>
  );
}

/** The sparkline dialog of `dialog`, if it is one. */
export function SparklineDialog({ store, dialog }: { store: CalcStore; dialog: CalcDialog }) {
  switch (dialog.kind) {
    case "sparklines":
      return <InsertDialog store={store} dialog={dialog} />;
    case "sparklineSingle":
      return <SingleDialog store={store} />;
    case "sparklineHidden":
      return <HiddenDialog store={store} />;
    case "sparklineAxis":
      return <AxisDialog store={store} which={dialog.which} />;
    default:
      return null;
  }
}
