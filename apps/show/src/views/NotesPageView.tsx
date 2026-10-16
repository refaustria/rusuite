// View › Notes Page (P8-28): the current slide's notes page as printed
// (portrait page, the slide picture in the upper half, the speaker notes
// below – the print layout of `showPrintDoc.ts`), the notes editable in
// place (`SetNotes` when the field is left). PageUp / PageDown go through
// the slides.

import { useEffect, useRef, useState } from "react";
import { fitScale } from "../geometry";
import { useShow, type ShowStore } from "../state/store";
import { stableDeck } from "../design/deck";
import { SlideImage } from "../present/Presenter";
import { useT } from "../i18n";

/** A notes page: 7.5" × 10" (portrait letter-like), as printed. */
export const NOTES_PAGE = { w: 7.5, h: 10, margin: 0.75 } as const;

/** The slide picture's box on a notes page `pageW` px wide (upper 45 % inside the margins). */
export function notesSlideBox(pageW: number, aspect: number): { x: number; y: number; w: number; h: number } {
  const k = pageW / NOTES_PAGE.w;
  const m = NOTES_PAGE.margin * k;
  const areaW = pageW - 2 * m;
  const areaH = (NOTES_PAGE.h * k - 2 * m) * 0.45;
  const w = Math.min(areaW, areaH * aspect);
  const h = w / aspect;
  return { x: (pageW - w) / 2, y: m + (areaH - h) / 2, w, h };
}

export function NotesPageView({ store, width, height }: { store: ShowStore; width: number; height: number }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const slide = pres?.slides.find((s) => s.id === current) ?? null;
  const notes = slide?.notes ?? "";
  const [draft, setDraft] = useState(notes);
  const editing = useRef<{ slide: number; text: string } | null>(null);
  useEffect(() => {
    if (!editing.current) setDraft(notes);
  }, [notes, current]);
  useEffect(
    () => () => {
      const e = editing.current;
      editing.current = null;
      if (e) void store.setNotes(e.slide, e.text);
    },
    [current, store],
  );
  if (!pres || !slide) return null;
  const deck = stableDeck(pres);
  // the page fitted into the area
  const k = Math.max(0, Math.min((width - 32) / NOTES_PAGE.w, (height - 32) / NOTES_PAGE.h));
  const pageW = NOTES_PAGE.w * k;
  const pageH = NOTES_PAGE.h * k;
  const aspect = pres.slideSize.width / pres.slideSize.height;
  const box = notesSlideBox(pageW, aspect);
  const m = NOTES_PAGE.margin * k;
  const notesTop = box.y + box.h + 0.35 * k;
  const index = pres.slides.indexOf(slide);
  return (
    <div
      className="relative m-auto shrink-0 bg-white shadow-lg"
      style={{ width: pageW, height: pageH }}
      data-testid="notes-page"
      onKeyDown={(e) => {
        if (e.key !== "PageDown" && e.key !== "PageUp") return;
        const next = pres.slides[index + (e.key === "PageDown" ? 1 : -1)];
        if (next) store.selectSlide(next.id);
        e.preventDefault();
      }}
    >
      <div className="absolute outline outline-1 outline-gray-300" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} data-testid="notes-page-slide">
        {fitScale(box.w, box.h, pres.slideSize) > 0 && <SlideImage deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} width={box.w} height={box.h} />}
      </div>
      <textarea
        aria-label={t("show.speakerNotes")}
        placeholder={t("show.addNotes")}
        data-testid="notes-page-text"
        className="absolute resize-none rounded-sm border border-dashed border-gray-300 bg-transparent p-1 text-black outline-none focus:border-ui-focus"
        style={{ left: m, top: notesTop, width: pageW - 2 * m, height: Math.max(20, pageH - m - notesTop), fontSize: Math.max(8, (k * 12) / 72) }}
        value={draft}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          editing.current = { slide: slide.id, text: e.currentTarget.value };
        }}
        onBlur={() => {
          const e = editing.current;
          editing.current = null;
          if (e) void store.setNotes(e.slide, e.text);
        }}
      />
      <span className="absolute text-[10px] text-gray-500" style={{ right: m, bottom: m / 2 }}>
        {index + 1}
      </span>
    </div>
  );
}
