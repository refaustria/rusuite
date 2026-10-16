// Reuse Slides (P8-24; Home / Insert › New Slide ▾ › Reuse Slides…): a
// pane right of the stage. Browse… picks another .pptx, which the core
// reads without opening it (`peekPresentation`); its slides are listed as
// thumbnails drawn with that presentation's own design. A click inserts
// the slide after the current one; "Keep source formatting" copies its
// layout as a custom layout, otherwise it takes this presentation's
// layout of the same kind. Insert All Slides adds them all (one undo step).

import { useMemo, useRef, useState } from "react";
import { bytesToBase64 } from "@rusuite/ui-shared";
import { deckOf } from "../design/deck";
import { useShow, type ShowStore } from "../state/store";
import { DeckThumb } from "../ui/Thumbs";
import { slideTitle } from "../links/LinkDialogs";
import { useT } from "../i18n";

const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

export function ReusePane({ store }: { store: ShowStore }) {
  const t = useT();
  const open = useShow(store, (s) => s.reusePane);
  const reuse = useShow(store, (s) => s.reuse);
  const [keep, setKeep] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const deck = useMemo(() => (reuse ? deckOf(reuse.pres) : null), [reuse]);
  const media = useMemo(() => new Map((reuse?.pres.media ?? []).map((m) => [m.id, `data:${m.contentType};base64,${m.data}`])), [reuse]);
  if (!open) return null;
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l border-ui-border bg-ui-panel p-3" aria-label={t("show.reuse.title")} data-testid="reuse-pane">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("show.reuse.title")}</h2>
        <button type="button" className="rounded px-1 hover:bg-ui-hover" aria-label={t("common.close")} onClick={() => store.toggleReusePane(false)}>
          ×
        </button>
      </div>
      <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
        {t("show.reuse.browse")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        data-testid="reuse-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void f
            .arrayBuffer()
            .then((b) => store.peekReuse({ name: f.name, bytesBase64: bytesToBase64(new Uint8Array(b)) }))
            .catch((err) => store.pushError(err));
        }}
      />
      {reuse && deck ? (
        <>
          <div className="truncate text-xs text-ui-muted" title={reuse.name}>
            {t("show.reuse.from", { name: reuse.name, count: reuse.pres.slides.length })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            {t("show.reuse.keep")}
          </label>
          <ul className="flex flex-col gap-2" aria-label={t("show.reuse.slides")}>
            {reuse.pres.slides.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded border border-transparent p-1 text-left hover:border-ui-border"
                  title={t("show.reuse.insertTip")}
                  data-testid={`reuse-slide-${i + 1}`}
                  onClick={() => void store.reuseSlides([s.id], keep)}
                >
                  <DeckThumb deck={deck} slide={s} media={media} width={220} />
                  <span className="truncate text-xs">{`${i + 1}. ${slideTitle(s) || t("show.reuse.untitled")}`}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={BUTTON} onClick={() => void store.reuseSlides(reuse.pres.slides.map((s) => s.id), keep)}>
            {t("show.reuse.insertAll")}
          </button>
        </>
      ) : (
        <p className="text-xs text-ui-muted">{t("show.reuse.hint")}</p>
      )}
    </aside>
  );
}
