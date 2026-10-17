// The "Insert Picture" icon of empty picture placeholders on the editor
// stage (P9-S5): a click picks an image, which goes into the placeholder
// (`insertPicture` with `placeholder`: its box and z-order, cropped to
// fill it, still a placeholder of the layout) – as the icon in the middle
// of PowerPoint's picture placeholders. Content placeholders keep the
// click / double-click into their text (the core also accepts them).

import { useRef, useState } from "react";
import { bytesToBase64 } from "@rusuite/ui-shared";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import { emuToPx } from "../geometry";
import type { ShowStore } from "../state/store";
import { useT } from "../i18n";

/** Whether `shape` is an empty picture placeholder (the icon's target). */
export function takesPicture(shape: Shape): boolean {
  if (shape.kind.kind !== "auto" || shape.placeholder !== "picture") return false;
  const text = shape.kind.value.text;
  return !text || text.paragraphs.every((p) => p.runs.every((r) => r.text === "" && !r.field));
}

export function PlaceholderIcons({ store, slide, scale }: { store: ShowStore; slide: Slide; scale: number }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null);
  const targets = slide.shapes.filter((s) => takesPicture(s));
  if (!targets.length) return null;
  return (
    <>
      {targets.map((s) => {
        const tr = s.transform;
        const cx = emuToPx(tr.x + tr.w / 2) * scale;
        const cy = emuToPx(tr.y + tr.h / 2) * scale;
        const y = cy - 16;
        return (
          <button
            key={s.id}
            type="button"
            className="absolute z-10 flex h-8 w-8 items-center justify-center rounded border border-ui-border bg-ui-bg/90 text-ui-muted shadow-sm hover:bg-ui-hover hover:text-ui-fg"
            style={{ left: cx - 16, top: y }}
            aria-label={t("show.insertPictureInto")}
            title={t("show.insertPictureInto")}
            data-testid={`ph-picture-${s.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setTarget(s.id);
              input.current?.click();
            }}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <rect x="2.5" y="4" width="15" height="12" rx="1" />
              <circle cx="7" cy="8" r="1.5" />
              <path d="M3 15l4.5-4.5 3 3 2.5-2.5L17 15" />
            </svg>
          </button>
        );
      })}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        data-testid="ph-picture-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const ph = target;
          if (!file || ph === null) return;
          void file
            .arrayBuffer()
            .then((b) => store.insertPictureInto(ph, file.type || "image/png", bytesToBase64(new Uint8Array(b))))
            .catch((err) => store.pushError(err));
        }}
      />
    </>
  );
}
