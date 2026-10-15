// Dialogs of the slide editor, opened through `ShowStore.openDialog`:
// Format Shape (fill, line, text box, size & position), Alt Text, and the
// file picker of Change Picture.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, bytesToBase64, cssColor } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Anchor } from "../generated/Anchor";
import type { LineDash } from "../generated/LineDash";
import { textOf, themePalette } from "../model";
import { formatValuesOf, type FormatValues } from "../state/commands";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";

const INPUT = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg";
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({ label, value, onChange, step = 0.01, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        aria-label={label}
        className={`${INPUT} w-24`}
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </Field>
  );
}

/** A colour with a "none" checkbox; `value` `null` = none. */
function ColorField({ label, noneLabel, value, palette, onChange }: {
  label: string; noneLabel: string; value: Color | null; palette: ReturnType<typeof themePalette>; onChange: (c: Color | null) => void;
}) {
  const t = useT();
  const hex = cssColor(value ?? undefined, palette) ?? "#4472c4";
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="checkbox" aria-label={noneLabel} checked={value === null} onChange={(e) => onChange(e.currentTarget.checked ? null : { kind: "rgb", value: hex.slice(1).toUpperCase() })} />
          {noneLabel}
        </label>
        <input
          type="color"
          aria-label={t("show.fmt.colorOf", { label })}
          disabled={value === null}
          value={hex.toLowerCase()}
          onChange={(e) => onChange({ kind: "rgb", value: e.currentTarget.value.slice(1).toUpperCase() })}
        />
      </span>
    </div>
  );
}

function FormatShapeDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const sel = store.selectedShapes();
  const first = sel[0];
  const [before] = useState<FormatValues | null>(() => (first ? formatValuesOf(first) : null));
  const [v, setV] = useState<FormatValues | null>(before);
  if (!before || !v || !first) return null;
  const palette = themePalette(pres?.theme);
  const set = (patch: Partial<FormatValues>) => setV({ ...v, ...patch });
  const hasText = sel.some((s) => !!textOf(s));
  const close = () => store.closeDialog();
  return (
    <Dialog open title={t("show.fmt.title")} onClose={close}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.applyFormat(before, v);
        }}
      >
        <fieldset className="flex flex-col gap-1.5 border-t border-ui-border pt-2">
          <legend className="pr-2 font-medium">{t("show.fmt.fillLine")}</legend>
          <ColorField label={t("show.fmt.fill")} noneLabel={t("show.fmt.noFill")} value={v.fill} palette={palette} onChange={(fill) => set({ fill })} />
          <ColorField label={t("show.fmt.line")} noneLabel={t("show.fmt.noLine")} value={v.line} palette={palette} onChange={(line) => set({ line })} />
          <Num label={t("show.fmt.lineWidth")} value={v.lineWidthPt} step={0.25} min={0} onChange={(lineWidthPt) => set({ lineWidthPt })} />
          <Field label={t("show.fmt.dash")}>
            <select aria-label={t("show.fmt.dash")} className={`${INPUT} w-24`} value={v.dash} onChange={(e) => set({ dash: e.currentTarget.value as LineDash })}>
              <option value="solid">{t("show.fmt.solid")}</option>
              <option value="dash">{t("show.fmt.dashed")}</option>
              <option value="dot">{t("show.fmt.dot")}</option>
            </select>
          </Field>
        </fieldset>
        {hasText && (
          <fieldset className="flex flex-col gap-1.5 border-t border-ui-border pt-2">
            <legend className="pr-2 font-medium">{t("show.fmt.textBox")}</legend>
            <Field label={t("show.fmt.vAlign")}>
              <select aria-label={t("show.fmt.vAlign")} className={`${INPUT} w-24`} value={v.anchor} onChange={(e) => set({ anchor: e.currentTarget.value as Anchor })}>
                <option value="top">{t("show.fmt.top")}</option>
                <option value="middle">{t("show.fmt.middle")}</option>
                <option value="bottom">{t("show.fmt.bottom")}</option>
              </select>
            </Field>
            {(["left", "right", "top", "bottom"] as const).map((k) => (
              <Num key={k} label={t(`show.fmt.margin.${k}`)} value={v.insets[k]} min={0} onChange={(n) => set({ insets: { ...v.insets, [k]: n } })} />
            ))}
          </fieldset>
        )}
        {sel.length === 1 && (
          <fieldset className="flex flex-col gap-1.5 border-t border-ui-border pt-2">
            <legend className="pr-2 font-medium">{t("show.fmt.sizePos")}</legend>
            <Num label={t("show.fmt.height")} value={v.h} min={0} onChange={(h) => set({ h })} />
            <Num label={t("show.fmt.width")} value={v.w} min={0} onChange={(w) => set({ w })} />
            <Num label={t("show.fmt.rotation")} value={v.rotation} step={1} onChange={(rotation) => set({ rotation })} />
            <Num label={t("show.fmt.x")} value={v.x} onChange={(x) => set({ x })} />
            <Num label={t("show.fmt.y")} value={v.y} onChange={(y) => set({ y })} />
          </fieldset>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AltTextDialog({ store, shape }: { store: ShowStore; shape: number }) {
  const t = useT();
  const [text, setText] = useState(() => store.shape(shape)?.alt ?? "");
  const close = () => store.closeDialog();
  return (
    <Dialog open title={t("show.altText")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.setAltText(shape, text.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          <span>{t("show.altQuestion")}</span>
          <textarea aria-label={t("show.altText")} rows={4} className="rounded border border-ui-border bg-ui-bg p-2 text-ui-fg" value={text} onChange={(e) => setText(e.currentTarget.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Insert › Table › Insert Table…: rows and columns (1–75 like PowerPoint). */
function InsertTableDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(5);
  const close = () => store.closeDialog();
  const clamp = (v: number) => Math.max(1, Math.min(75, Math.round(v)));
  return (
    <Dialog open title={t("show.table.insertTitle")} onClose={close}>
      <form
        className="flex w-64 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.insertTable(clamp(rows), clamp(cols));
        }}
      >
        <Num label={t("show.table.cols")} value={cols} step={1} min={1} onChange={setCols} />
        <Num label={t("show.table.rows")} value={rows} step={1} min={1} onChange={setRows} />
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Mounts the open dialog; Change Picture opens the file picker. */
export function ShowDialogs({ store }: { store: ShowStore }) {
  const dialog = useShow(store, (s) => s.dialog);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);

  useEffect(() => {
    if (dialog?.kind !== "replacePicture") return;
    target.current = dialog.shape;
    store.closeDialog();
    input.current?.click();
  }, [dialog, store]);

  return (
    <>
      {dialog?.kind === "format" && <FormatShapeDialog store={store} />}
      {dialog?.kind === "alt" && <AltTextDialog store={store} shape={dialog.shape} />}
      {dialog?.kind === "insertTable" && <InsertTableDialog store={store} />}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        data-testid="replace-picture-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const shape = target.current;
          if (!file || shape === null) return;
          void file
            .arrayBuffer()
            .then((b) => store.replacePicture(shape, file.type || "image/png", bytesToBase64(new Uint8Array(b))))
            .catch((err) => store.pushError(err));
        }}
      />
    </>
  );
}
