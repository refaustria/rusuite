// The Timing group of the Transitions and Animations tabs in the compact layout (P10-M5): one "Timing…" button in
// the command bar (the group's fields would make the bar taller than on the other tabs) opening a sheet with the
// same controls – the same names as in the ribbon – sized for fingers: rows of a label and a field, − / + buttons
// beside the seconds fields, 44 px check boxes and buttons.

import type { ReactNode } from "react";
import { RibbonMenuButton } from "@rusuite/ui-shared";
import { MAX_TIME_MS, msToSeconds, secondsToMs, spinMs } from "../anim/effects";
import { CommitField } from "./AnimTabs";

/** At least 44 × 44 px (the sheets' generic button rule asks for 40 px only). */
const TOUCH_SIZE = { minHeight: 44, minWidth: 44 };
const TOUCH_BTN = "flex min-h-11 min-w-11 items-center justify-center rounded border border-ui-border bg-ui-bg px-3 text-base hover:bg-ui-hover disabled:opacity-40";

/** One labelled row of the sheet. */
export function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-ui-border py-1 last:border-b-0">
      <span aria-hidden="true" className="text-sm text-ui-muted">
        {label}
      </span>
      <span className="flex items-center gap-1">{children}</span>
    </div>
  );
}

/** A check box row (the whole row is the target). */
export function SheetCheck({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-12 items-center gap-3 border-b border-ui-border text-sm">
      <input type="checkbox" className="h-5 w-5" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A button row of the sheet. */
export function SheetButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} style={TOUCH_SIZE} className={`${TOUCH_BTN} mt-2 w-full justify-start text-sm`} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

/** The seconds spinner of the sheet: − field + (0.25 s steps, kept within `[min, max]`), the ribbon's names. */
export function TouchSpin({ label, ms, min, max = MAX_TIME_MS, onCommit, disabled }: { label: string; ms: number; min: number; max?: number; onCommit: (ms: number) => void; disabled?: boolean }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <span className="flex items-center gap-1" data-testid={`touch-spin-${label}`}>
      <button type="button" style={TOUCH_SIZE} className={TOUCH_BTN} aria-label={`${label} −`} disabled={disabled || ms <= min} onClick={() => onCommit(spinMs(ms, false, min, max))}>
        −
      </button>
      <CommitField
        label={label}
        value={msToSeconds(ms)}
        width="w-20 min-h-11"
        disabled={disabled}
        parse={(s) => {
          const v = secondsToMs(s);
          return v === null ? null : clamp(v);
        }}
        onCommit={onCommit}
      />
      <button type="button" style={TOUCH_SIZE} className={TOUCH_BTN} aria-label={`${label} +`} disabled={disabled || ms >= max} onClick={() => onCommit(spinMs(ms, true, min, max))}>
        +
      </button>
    </span>
  );
}

/** The command bar's "Timing…" button; `body` is the sheet's content. */
export function TimingSheetButton({ label, body }: { label: string; body: () => ReactNode }) {
  return (
    <span data-compact-sheet="">
      <RibbonMenuButton label={label} icon="options" menu={() => <div data-testid="timing-sheet" className="flex flex-col">{body()}</div>} />
    </span>
  );
}
