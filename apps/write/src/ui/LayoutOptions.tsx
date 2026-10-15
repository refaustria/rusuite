// Word's Layout Options button: next to a selected picture, it opens the
// wrap choices (In Line with Text; With Text Wrapping: Square, Tight, Top
// and Bottom, Behind Text, In Front of Text). Positioned over the editor
// (fixed, follows scrolling); pointer events, 28 px button.

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { FOCUS_RING } from "@rusuite/ui-shared";
import type { Anchor } from "../generated/Anchor";
import { WRAP_CHOICES, withWrap, wrapOf } from "../features/floating";
import { selectedImage } from "../features/images";
import { setSelectedAnchor, WRAP_ICONS } from "./pictureControls";
import { useT } from "../i18n";

interface Spot {
  x: number;
  y: number;
  anchor: Anchor | null;
}

function spotOf(editor: Editor): Spot | null {
  const img = selectedImage(editor.state);
  if (!img) return null;
  const dom = editor.view.nodeDOM(img.pos) as HTMLElement | null;
  const r = dom?.getBoundingClientRect?.();
  if (!r || (!r.width && !r.height)) return null;
  return { x: r.right + 6, y: r.top, anchor: (img.node.attrs.anchor as Anchor | null) ?? null };
}

export function LayoutOptions({ editor }: { editor: Editor | null }) {
  const t = useT();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const s = editor.isDestroyed ? null : spotOf(editor);
      setSpot((old) => (old?.x === s?.x && old?.y === s?.y && old?.anchor === s?.anchor ? old : s));
      if (!s) setOpen(false);
    };
    editor.on("transaction", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);
  if (!editor || !spot) return null;
  const wrap = wrapOf(spot.anchor);
  return (
    <div className="fixed z-10" style={{ left: spot.x, top: spot.y }} data-testid="layout-options">
      <button
        type="button"
        className={`flex h-7 w-7 items-center justify-center rounded border border-ui-border bg-ui-panel text-ui-fg shadow hover:bg-ui-hover ${FOCUS_RING}`}
        aria-label={t("write.layoutOptions")}
        title={t("write.layoutOptions")}
        aria-expanded={open}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {WRAP_ICONS[wrap]}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("write.layoutOptions")}
          className="absolute left-0 top-full mt-1 w-56 rounded border border-ui-border bg-ui-panel p-1 text-sm text-ui-fg shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              editor.commands.focus();
            }
          }}
        >
          <div className="px-2 py-0.5 text-[11px] font-medium text-ui-muted">{t("write.inLineWithText")}</div>
          {WRAP_CHOICES.map((w, i) => (
            <div key={w}>
              {i === 1 && <div className="mt-1 border-t border-ui-border px-2 pt-1 text-[11px] font-medium text-ui-muted">{t("write.withTextWrapping")}</div>}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={wrap === w}
                className={`flex min-h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-ui-hover aria-checked:bg-ui-active ${FOCUS_RING}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelectedAnchor(editor, (a) => withWrap(a, w));
                  setOpen(false);
                }}
              >
                {WRAP_ICONS[w]}
                <span>{t(`write.wrap.${w}`)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
