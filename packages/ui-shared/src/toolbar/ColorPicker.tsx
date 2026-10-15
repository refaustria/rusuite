import { useRef, useState } from "react";
import { Icon } from "../Icon";
import { FOCUS_RING, Popover } from "../Popover";
import {
  OFFICE_THEME, STANDARD_COLORS, THEME_SLOTS, TINTS, applyTint, cssColor, isHex6,
} from "./color";
import type { Color, ThemePalette } from "./types";

export interface ColorPickerProps {
  label: string;
  kind: "text" | "fill";
  /** Current color (shown as underline swatch). */
  value?: Color;
  theme?: ThemePalette;
  disabled?: boolean;
  /** `null` = automatic (text) / no fill (fill). */
  onSelect: (color: Color | null) => void;
}

const COLS = 10;
const CELL = `h-5 w-5 rounded-sm border border-ui-border ${FOCUS_RING}`;

function Grid({ theme, onPick }: { theme: ThemePalette; onPick: (c: Color) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cells = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button[data-cell]") ?? []);
  const move = (e: React.KeyboardEvent) => {
    const all = cells();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    const d = delta[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const n = i + d;
    if (n >= 0 && n < all.length) all[n]!.focus();
  };
  const slotHex = (s: (typeof THEME_SLOTS)[number]) => theme[s] ?? OFFICE_THEME[s as keyof typeof OFFICE_THEME];
  return (
    <div ref={ref} role="group" aria-label="Colors" onKeyDown={move}>
      <div className="mb-1 text-xs text-ui-muted">Theme colors</div>
      <div className="grid grid-cols-10 gap-0.5">
        {TINTS.map((tint) =>
          THEME_SLOTS.map((slot, ci) => (
            <button
              key={`${slot}${tint}`}
              type="button"
              data-cell
              tabIndex={tint === 0 && ci === 0 ? 0 : -1}
              aria-label={`${slot} tint ${tint}`}
              className={CELL}
              style={{ background: `#${applyTint(slotHex(slot)!, tint)}` }}
              onFocus={(e) => cells().forEach((b) => (b.tabIndex = b === e.currentTarget ? 0 : -1))}
              onClick={() => onPick({ kind: "theme", value: { slot, tint } })}
            />
          )),
        )}
      </div>
      <div className="mb-1 mt-2 text-xs text-ui-muted">Standard colors</div>
      <div className="grid grid-cols-10 gap-0.5">
        {STANDARD_COLORS.map((hex) => (
          <button
            key={hex}
            type="button"
            data-cell
            tabIndex={-1}
            aria-label={`Standard color ${hex}`}
            className={CELL}
            style={{ background: `#${hex}` }}
            onFocus={(e) => cells().forEach((b) => (b.tabIndex = b === e.currentTarget ? 0 : -1))}
            onClick={() => onPick({ kind: "rgb", value: hex })}
          />
        ))}
      </div>
    </div>
  );
}

function HexInput({ onPick }: { onPick: (c: Color) => void }) {
  const [text, setText] = useState("");
  const raw = text.replace(/^#/, "");
  const valid = isHex6(raw);
  const apply = () => valid && onPick({ kind: "rgb", value: raw.toUpperCase() });
  return (
    <div className="mt-2 flex items-center gap-1">
      <input
        aria-label="Hex color"
        aria-invalid={text !== "" && !valid}
        className={`h-6 w-24 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg ${FOCUS_RING}`}
        placeholder="RRGGBB"
        maxLength={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
      />
      <button
        type="button"
        disabled={!valid}
        className={`h-6 rounded border border-ui-border px-2 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`}
        onClick={apply}
      >
        Apply
      </button>
    </div>
  );
}

export function ColorPicker({ label, kind, value, theme = OFFICE_THEME, disabled, onSelect }: ColorPickerProps) {
  const swatch = cssColor(value, theme) ?? (kind === "text" ? "currentColor" : "transparent");
  return (
    <Popover
      label={label}
      disabled={disabled}
      trigger={
        <span className="flex flex-col items-center">
          <Icon name={kind === "text" ? "textColor" : "fillColor"} />
          <span className="h-0.5 w-4 border border-ui-border" style={{ background: swatch }} />
        </span>
      }
    >
      {(close) => {
        const pick = (c: Color | null) => {
          onSelect(c);
          close();
        };
        return (
          <div className="w-60 text-ui-fg">
            <button
              type="button"
              className={`mb-2 w-full rounded px-2 py-1 text-left text-sm hover:bg-ui-hover ${FOCUS_RING}`}
              onClick={() => pick(null)}
            >
              {kind === "text" ? "Automatic" : "No fill"}
            </button>
            <Grid theme={theme} onPick={pick} />
            <HexInput onPick={pick} />
          </div>
        );
      }}
    </Popover>
  );
}
