import { useState } from "react";
import { Toolbar, type ToolbarProps } from "./Toolbar";
import type { CellStylePatch, CellStyleView } from "./types";

/** Shallow-per-section merge, enough to preview patches locally. */
export function applyPatch(base: CellStyleView, patch: CellStylePatch): CellStyleView {
  const borders = { ...base.borders } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch.borders ?? {})) {
    if (v === null) delete borders[k];
    else borders[k] = v;
  }
  return {
    ...base,
    ...(patch.numberFormat !== undefined && { numberFormat: patch.numberFormat }),
    ...(patch.fill && { fill: patch.fill }),
    font: { ...base.font, ...patch.font },
    alignment: { ...base.alignment, ...patch.alignment },
    borders,
  };
}

/** Toolbar with local state, for manual checks. */
export function ToolbarDemo(props: Partial<Pick<ToolbarProps, "disabled" | "theme">>) {
  const [value, setValue] = useState<CellStyleView>({ font: { size: 1100 } });
  const [last, setLast] = useState<CellStylePatch | null>(null);
  return (
    <div>
      <Toolbar
        {...props}
        value={value}
        onChange={(p) => {
          setLast(p);
          setValue((v) => applyPatch(v, p));
        }}
      />
      <pre data-testid="last-patch" className="p-2 text-xs">
        {last ? JSON.stringify(last) : ""}
      </pre>
    </div>
  );
}
