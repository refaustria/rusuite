// The AutoFit Options button (P8-28): under the lower-left corner of the
// selected shape when its text overflows (Do not Autofit) or is being
// shrunk, like PowerPoint's; its menu offers the three autofit choices
// (`SetBodyProps`, the shrink scale computed and stored) and opens the
// Format Shape pane's text options.

import { useState } from "react";
import type { Shape } from "../generated/Shape";
import { boundsPx } from "../geometry";
import { textOf } from "../model";
import { overflows } from "../text/autofit";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";

export function AutofitButton({ store, shape, scale }: { store: ShowStore; shape: Shape; scale: number }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const [open, setOpen] = useState(false);
  const slide = store.currentSlide();
  const body = textOf(shape);
  if (!pres || !slide || !body || shape.kind.kind !== "auto") return null;
  const shrinking = body.props.autofit === "shrink" && (body.props.fontScale ?? 100000) < 100000;
  const over = body.props.autofit === "none" && overflows(pres, slide, shape);
  if (!shrinking && !over && !open) return null;
  const b = boundsPx(shape.transform);
  const choose = (autofit: "none" | "shrink" | "resize") => {
    setOpen(false);
    void store.setBodyProps({ autofit });
  };
  const item = (value: "none" | "shrink" | "resize", label: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={body.props.autofit === value}
      className="flex h-8 w-full items-center gap-2 px-2 text-left text-xs hover:bg-ui-hover"
      onClick={() => choose(value)}
    >
      <span className="w-3">{body.props.autofit === value ? "•" : ""}</span>
      {label}
    </button>
  );
  return (
    <div className="absolute z-10" style={{ left: b.x * scale, top: (b.y + b.height) * scale + 4 }} data-keep-edit>
      <button
        type="button"
        aria-label={t("show.autofit.options")}
        title={t("show.autofit.options")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="autofit-button"
        data-state={over ? "overflow" : "shrink"}
        className="flex h-8 w-8 items-center justify-center rounded border border-ui-border bg-ui-panel text-ui-fg shadow hover:bg-ui-hover"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M3 4h7M3 7.5h7M3 11h5" />
          <path d="M13 3v9m-2-2l2 2 2-2" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label={t("show.autofit.options")} className="mt-1 w-64 rounded border border-ui-border bg-ui-panel py-1 shadow-lg">
          {item("shrink", t("show.autofit.shrink"))}
          {item("none", t("show.autofit.none"))}
          {item("resize", t("show.autofit.resize"))}
          <div className="my-1 h-px bg-ui-border" />
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center px-2 pl-7 text-left text-xs hover:bg-ui-hover"
            onClick={() => {
              setOpen(false);
              store.openFormatPane("text");
            }}
          >
            {t("show.autofit.control")}
          </button>
        </div>
      )}
    </div>
  );
}
