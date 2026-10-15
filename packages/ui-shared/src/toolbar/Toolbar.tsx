import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Dropdown } from "../Dropdown";
import { Icon, type IconName } from "../Icon";
import { BTN, FOCUS_RING } from "../Popover";
import { ColorPicker } from "./ColorPicker";
import { OFFICE_THEME } from "./color";
import { withLabel } from "../i18n/localized";
import { useT } from "../i18n/react";
import type {
  BorderSideView, CellStylePatch, CellStyleView, Color, HAlign, ThemePalette, VAlign,
} from "./types";

export const FONT_FAMILIES = [
  "Arial", "Calibri", "Cambria", "Courier New", "Georgia", "Helvetica", "Times New Roman", "Verdana",
];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const NUMBER_FORMATS: { readonly label: string; code: string }[] = [
  withLabel({ code: "General" }, "numfmt.general"),
  withLabel({ code: "0.00" }, "numfmt.number"),
  withLabel({ code: "#,##0" }, "numfmt.thousands"),
  withLabel({ code: "#,##0.00" }, "numfmt.currency"),
  withLabel({ code: "0%" }, "numfmt.percent"),
  withLabel({ code: "yyyy-mm-dd" }, "numfmt.date"),
  withLabel({ code: "@" }, "numfmt.text"),
];

export type BorderPreset = "none" | "all" | "outline" | "bottom" | "top" | "left" | "right";

export type ToolbarGroup = "font" | "style" | "colors" | "alignment" | "number" | "borders";
export const ALL_TOOLBAR_GROUPS: ToolbarGroup[] = ["font", "style", "colors", "alignment", "number", "borders"];

export interface ToolbarProps {
  value: CellStyleView;
  onChange: (patch: CellStylePatch) => void;
  disabled?: boolean;
  theme?: ThemePalette;
  /** Groups to show (default: all). Write shows only the run formatting groups. */
  groups?: ToolbarGroup[];
  /** Label of the fill color picker (Write: "Highlight color"). */
  fillLabel?: string;
  /** Extra controls appended after the groups (e.g. Write's paragraph controls). */
  children?: ReactNode;
}

const THIN_BLACK: BorderSideView = { style: "thin", color: { kind: "rgb", value: "000000" } };

export function borderPatch(preset: BorderPreset): CellStylePatch {
  const sides = {
    all: ["left", "right", "top", "bottom"],
    outline: ["left", "right", "top", "bottom"],
    bottom: ["bottom"],
    top: ["top"],
    left: ["left"],
    right: ["right"],
    none: ["left", "right", "top", "bottom"],
  }[preset] as ("left" | "right" | "top" | "bottom")[];
  const borders: NonNullable<CellStylePatch["borders"]> = {};
  for (const s of sides) borders[s] = preset === "none" ? null : { ...THIN_BLACK };
  return { borders };
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 border-r border-ui-border px-1 last:border-r-0">
      {children}
    </div>
  );
}

export function Toggle({
  label, icon, pressed, disabled, onClick,
}: { label: string; icon: IconName; pressed: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={BTN} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

const SELECT = `h-7 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg disabled:opacity-40 ${FOCUS_RING}`;

export function FontSizePicker({
  size, disabled, onCommit,
}: { size?: number; disabled?: boolean; onCommit: (hundredths: number) => void }) {
  const t = useT();
  const current = size === undefined ? "" : String(size / 100);
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const commit = () => {
    const pt = Number(text);
    if (text.trim() === "" || !Number.isFinite(pt) || pt < 1 || pt > 409) {
      setText(current);
      return;
    }
    if (pt * 100 !== size) onCommit(Math.round(pt * 100));
  };
  return (
    <>
      <input
        aria-label={t("fmt.fontSize")}
        list="rusuite-font-sizes"
        inputMode="decimal"
        className={`${SELECT} w-14`}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setText(current);
        }}
      />
      <datalist id="rusuite-font-sizes">
        {FONT_SIZES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/** Props shared by the formatting control groups (the Toolbar's groups, also used inside ribbon groups). */
export interface FormatControlProps {
  value: CellStyleView;
  onChange: (patch: CellStylePatch) => void;
  disabled?: boolean;
  theme?: ThemePalette;
}

/** Font family select + font size input. */
export function FontControls({ value, onChange, disabled }: FormatControlProps) {
  const t = useT();
  const f = value.font ?? {};
  const fontName = f.font?.value;
  const families = fontName && !FONT_FAMILIES.includes(fontName) ? [fontName, ...FONT_FAMILIES] : FONT_FAMILIES;
  return (
    <>
      <select
        aria-label={t("fmt.fontFamily")}
        className={`${SELECT} w-36`}
        disabled={disabled}
        value={fontName ?? ""}
        onChange={(e) => onChange({ font: { font: { kind: "named", value: e.target.value } } })}
      >
        {fontName === undefined && <option value="" disabled hidden />}
        {families.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <FontSizePicker size={f.size} disabled={disabled} onCommit={(size) => onChange({ font: { size } })} />
    </>
  );
}

/** Bold / italic / underline / strikethrough toggles. */
export function StyleToggles({ value, onChange, disabled }: FormatControlProps) {
  const t = useT();
  const f = value.font ?? {};
  return (
    <>
      <Toggle label={t("fmt.bold")} icon="bold" pressed={!!f.bold} disabled={disabled} onClick={() => onChange({ font: { bold: !f.bold } })} />
      <Toggle label={t("fmt.italic")} icon="italic" pressed={!!f.italic} disabled={disabled} onClick={() => onChange({ font: { italic: !f.italic } })} />
      <Toggle
        label={t("fmt.underline")}
        icon="underline"
        pressed={!!f.underline && f.underline !== "none"}
        disabled={disabled}
        onClick={() => onChange({ font: { underline: f.underline && f.underline !== "none" ? "none" : "single" } })}
      />
      <Toggle label={t("fmt.strike")} icon="strike" pressed={!!f.strike} disabled={disabled} onClick={() => onChange({ font: { strike: !f.strike } })} />
    </>
  );
}

/** Text color + fill (highlight / shape fill) pickers. */
export function ColorControls({ value, onChange, disabled, theme = OFFICE_THEME, fillLabel }: FormatControlProps & { fillLabel?: string }) {
  const t = useT();
  const fillColor = value.fill?.kind === "solid" ? value.fill.color : undefined;
  return (
    <>
      <ColorPicker
        label={t("fmt.textColor")}
        kind="text"
        value={value.font?.color}
        theme={theme}
        disabled={disabled}
        onSelect={(c: Color | null) => onChange({ font: { color: c ?? { kind: "auto" } } })}
      />
      <ColorPicker
        label={fillLabel ?? t("fmt.fillColor")}
        kind="fill"
        value={fillColor}
        theme={theme}
        disabled={disabled}
        onSelect={(c: Color | null) => onChange({ fill: c ? { kind: "solid", color: c } : { kind: "none" } })}
      />
    </>
  );
}

/** Horizontal / vertical alignment and wrap toggles (`parts` picks a subset). */
export function AlignmentControls({
  value, onChange, disabled, parts = ["horizontal", "vertical", "wrap"],
}: FormatControlProps & { parts?: ("horizontal" | "vertical" | "wrap")[] }) {
  const t = useT();
  const a = value.alignment ?? {};
  const setH = (h: HAlign) => onChange({ alignment: { horizontal: h } });
  const setV = (v: VAlign) => onChange({ alignment: { vertical: v } });
  const hBtn = (h: HAlign, label: string, icon: IconName) => (
    <Toggle label={label} icon={icon} pressed={a.horizontal === h} disabled={disabled} onClick={() => setH(h)} />
  );
  const vBtn = (v: VAlign, label: string, icon: IconName) => (
    <Toggle label={label} icon={icon} pressed={a.vertical === v} disabled={disabled} onClick={() => setV(v)} />
  );
  const render = {
    horizontal: (
      <>
        {hBtn("left", t("fmt.alignLeft"), "alignLeft")}
        {hBtn("center", t("fmt.alignCenter"), "alignCenter")}
        {hBtn("right", t("fmt.alignRight"), "alignRight")}
      </>
    ),
    vertical: (
      <>
        {vBtn("top", t("fmt.alignTop"), "alignTop")}
        {vBtn("center", t("fmt.alignMiddle"), "alignMiddle")}
        {vBtn("bottom", t("fmt.alignBottom"), "alignBottom")}
      </>
    ),
    wrap: <Toggle label={t("fmt.wrapText")} icon="wrap" pressed={!!a.wrapText} disabled={disabled} onClick={() => onChange({ alignment: { wrapText: !a.wrapText } })} />,
  };
  return (
    <>
      {parts.map((part) => (
        <Fragment key={part}>{render[part]}</Fragment>
      ))}
    </>
  );
}

/** Number format select (General, Number, …; unknown codes shown as Custom). */
export function NumberFormatSelect({ value, onChange, disabled }: FormatControlProps) {
  const t = useT();
  const nf = value.numberFormat ?? "General";
  const known = NUMBER_FORMATS.some((n) => n.code === nf);
  return (
    <select
      aria-label={t("fmt.numberFormat")}
      className={`${SELECT} w-32`}
      disabled={disabled}
      value={nf}
      onChange={(e) => onChange({ numberFormat: e.target.value })}
    >
      {!known && <option value={nf}>{t("numfmt.customCode", { code: nf })}</option>}
      {NUMBER_FORMATS.map((n) => (
        <option key={n.code} value={n.code}>
          {n.label}
        </option>
      ))}
    </select>
  );
}

const BORDER_ITEMS: { value: BorderPreset; readonly label: string; icon: IconName }[] = [
  withLabel({ value: "none" as BorderPreset, icon: "borderNone" as IconName }, "fmt.border.none"),
  withLabel({ value: "all" as BorderPreset, icon: "borderAll" as IconName }, "fmt.border.all"),
  withLabel({ value: "outline" as BorderPreset, icon: "borderOutline" as IconName }, "fmt.border.outline"),
  withLabel({ value: "bottom" as BorderPreset, icon: "borderBottom" as IconName }, "fmt.border.bottom"),
  withLabel({ value: "top" as BorderPreset, icon: "borderTop" as IconName }, "fmt.border.top"),
  withLabel({ value: "left" as BorderPreset, icon: "borderLeft" as IconName }, "fmt.border.left"),
  withLabel({ value: "right" as BorderPreset, icon: "borderRight" as IconName }, "fmt.border.right"),
];

/** Border presets dropdown. */
export function BordersDropdown({ onChange, disabled }: Pick<FormatControlProps, "onChange" | "disabled">) {
  const t = useT();
  return (
    <Dropdown
      label={t("fmt.borders")}
      disabled={disabled}
      trigger={<><Icon name="borders" /><Icon name="chevronDown" size={12} /></>}
      items={BORDER_ITEMS.map((b) => ({ value: b.value, label: b.label, icon: <Icon name={b.icon} /> }))}
      onSelect={(p) => onChange(borderPatch(p))}
    />
  );
}

export function Toolbar({
  value, onChange, disabled, theme = OFFICE_THEME, groups = ALL_TOOLBAR_GROUPS, fillLabel, children,
}: ToolbarProps) {
  const t = useT();
  const show = (g: ToolbarGroup) => groups.includes(g);
  const p: FormatControlProps = { value, onChange, disabled, theme };
  return (
    <div
      role="toolbar"
      aria-label={t("fmt.toolbar")}
      className="flex flex-wrap items-center gap-1 border-b border-ui-border bg-ui-panel p-1 text-ui-fg"
    >
      {show("font") && (
        <Group label={t("fmt.font")}>
          <FontControls {...p} />
        </Group>
      )}
      {show("style") && (
        <Group label={t("fmt.style")}>
          <StyleToggles {...p} />
        </Group>
      )}
      {show("colors") && (
        <Group label={t("fmt.colors")}>
          <ColorControls {...p} fillLabel={fillLabel} />
        </Group>
      )}
      {show("alignment") && (
        <Group label={t("fmt.alignment")}>
          <AlignmentControls {...p} parts={["horizontal", "vertical", "wrap"]} />
        </Group>
      )}
      {show("number") && (
        <Group label={t("fmt.number")}>
          <NumberFormatSelect {...p} />
        </Group>
      )}
      {show("borders") && (
        <Group label={t("fmt.borders")}>
          <BordersDropdown onChange={onChange} disabled={disabled} />
        </Group>
      )}
      {children}
    </div>
  );
}
