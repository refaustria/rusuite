import { useEffect, useState, type ReactNode } from "react";
import { Dropdown } from "../Dropdown";
import { Icon, type IconName } from "../Icon";
import { BTN, FOCUS_RING } from "../Popover";
import { ColorPicker } from "./ColorPicker";
import { OFFICE_THEME } from "./color";
import type {
  BorderSideView, CellStylePatch, CellStyleView, Color, HAlign, ThemePalette, VAlign,
} from "./types";

export const FONT_FAMILIES = [
  "Arial", "Calibri", "Cambria", "Courier New", "Georgia", "Helvetica", "Times New Roman", "Verdana",
];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const NUMBER_FORMATS: { label: string; code: string }[] = [
  { label: "General", code: "General" },
  { label: "Number", code: "0.00" },
  { label: "Thousands", code: "#,##0" },
  { label: "Currency", code: "#,##0.00" },
  { label: "Percent", code: "0%" },
  { label: "Date", code: "yyyy-mm-dd" },
  { label: "Text", code: "@" },
];

export type BorderPreset = "none" | "all" | "outline" | "bottom" | "top" | "left" | "right";

export interface ToolbarProps {
  value: CellStyleView;
  onChange: (patch: CellStylePatch) => void;
  disabled?: boolean;
  theme?: ThemePalette;
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

function Toggle({
  label, icon, pressed, disabled, onClick,
}: { label: string; icon: IconName; pressed: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={BTN} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

const SELECT = `h-7 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg disabled:opacity-40 ${FOCUS_RING}`;

function FontSizePicker({
  size, disabled, onCommit,
}: { size?: number; disabled?: boolean; onCommit: (hundredths: number) => void }) {
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
        aria-label="Font size"
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

export function Toolbar({ value, onChange, disabled, theme = OFFICE_THEME }: ToolbarProps) {
  const f = value.font ?? {};
  const a = value.alignment ?? {};
  const fontName = f.font?.value;
  const families = fontName && !FONT_FAMILIES.includes(fontName) ? [fontName, ...FONT_FAMILIES] : FONT_FAMILIES;
  const fillColor = value.fill?.kind === "solid" ? value.fill.color : undefined;
  const nf = value.numberFormat ?? "General";
  const known = NUMBER_FORMATS.some((n) => n.code === nf);

  const setH = (h: HAlign) => onChange({ alignment: { horizontal: h } });
  const setV = (v: VAlign) => onChange({ alignment: { vertical: v } });
  const hBtn = (h: HAlign, label: string, icon: IconName) => (
    <Toggle label={label} icon={icon} pressed={a.horizontal === h} disabled={disabled} onClick={() => setH(h)} />
  );
  const vBtn = (v: VAlign, label: string, icon: IconName) => (
    <Toggle label={label} icon={icon} pressed={a.vertical === v} disabled={disabled} onClick={() => setV(v)} />
  );
  const borderItems: { value: BorderPreset; label: string; icon: IconName }[] = [
    { value: "none", label: "No border", icon: "borderNone" },
    { value: "all", label: "All borders", icon: "borderAll" },
    { value: "outline", label: "Outside borders", icon: "borderOutline" },
    { value: "bottom", label: "Bottom border", icon: "borderBottom" },
    { value: "top", label: "Top border", icon: "borderTop" },
    { value: "left", label: "Left border", icon: "borderLeft" },
    { value: "right", label: "Right border", icon: "borderRight" },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 border-b border-ui-border bg-ui-panel p-1 text-ui-fg"
    >
      <Group label="Font">
        <select
          aria-label="Font family"
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
      </Group>
      <Group label="Style">
        <Toggle label="Bold" icon="bold" pressed={!!f.bold} disabled={disabled} onClick={() => onChange({ font: { bold: !f.bold } })} />
        <Toggle label="Italic" icon="italic" pressed={!!f.italic} disabled={disabled} onClick={() => onChange({ font: { italic: !f.italic } })} />
        <Toggle
          label="Underline"
          icon="underline"
          pressed={!!f.underline && f.underline !== "none"}
          disabled={disabled}
          onClick={() => onChange({ font: { underline: f.underline && f.underline !== "none" ? "none" : "single" } })}
        />
        <Toggle label="Strikethrough" icon="strike" pressed={!!f.strike} disabled={disabled} onClick={() => onChange({ font: { strike: !f.strike } })} />
      </Group>
      <Group label="Colors">
        <ColorPicker
          label="Text color"
          kind="text"
          value={f.color}
          theme={theme}
          disabled={disabled}
          onSelect={(c: Color | null) => onChange({ font: { color: c ?? { kind: "auto" } } })}
        />
        <ColorPicker
          label="Fill color"
          kind="fill"
          value={fillColor}
          theme={theme}
          disabled={disabled}
          onSelect={(c: Color | null) => onChange({ fill: c ? { kind: "solid", color: c } : { kind: "none" } })}
        />
      </Group>
      <Group label="Alignment">
        {hBtn("left", "Align left", "alignLeft")}
        {hBtn("center", "Align center", "alignCenter")}
        {hBtn("right", "Align right", "alignRight")}
        {vBtn("top", "Align top", "alignTop")}
        {vBtn("center", "Align middle", "alignMiddle")}
        {vBtn("bottom", "Align bottom", "alignBottom")}
        <Toggle label="Wrap text" icon="wrap" pressed={!!a.wrapText} disabled={disabled} onClick={() => onChange({ alignment: { wrapText: !a.wrapText } })} />
      </Group>
      <Group label="Number">
        <select
          aria-label="Number format"
          className={`${SELECT} w-32`}
          disabled={disabled}
          value={nf}
          onChange={(e) => onChange({ numberFormat: e.target.value })}
        >
          {!known && <option value={nf}>Custom ({nf})</option>}
          {NUMBER_FORMATS.map((n) => (
            <option key={n.code} value={n.code}>
              {n.label}
            </option>
          ))}
        </select>
      </Group>
      <Group label="Borders">
        <Dropdown
          label="Borders"
          disabled={disabled}
          trigger={<><Icon name="borders" /><Icon name="chevronDown" size={12} /></>}
          items={borderItems.map((b) => ({ value: b.value, label: b.label, icon: <Icon name={b.icon} /> }))}
          onSelect={(p) => onChange(borderPatch(p))}
        />
      </Group>
    </div>
  );
}
