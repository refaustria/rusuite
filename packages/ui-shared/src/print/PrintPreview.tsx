// The File › Print preview: the print document in an `<iframe srcdoc>`
// (isolated from the app's styles, no scripts), one page at a time scaled
// to the pane, with page navigation and the page count.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOCUS_RING } from "../Popover";
import { printDocHtml, type PrintDoc } from "../print";
import { useT } from "../i18n/react";

const NAV = `inline-flex h-7 w-7 items-center justify-center rounded border border-ui-border hover:bg-ui-hover disabled:opacity-40 ${FOCUS_RING}`;

/** Zoom that fits a `wIn × hIn` page into `availW × availH` CSS px (never above 1.5). */
export function previewZoom(wIn: number, hIn: number, availW: number, availH: number): number {
  if (availW <= 0 || availH <= 0) return 1;
  return Math.max(0.05, Math.min(1.5, availW / (wIn * 96), availH / (hIn * 96)));
}

export function PrintPreview({ doc, busy }: { doc: PrintDoc | null; busy?: boolean }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const count = doc?.pages.length ?? 0;
  const srcdoc = useMemo(() => (doc ? printDocHtml(doc, { preview: true }) : ""), [doc]);
  const current = Math.min(page, Math.max(0, count - 1));

  const apply = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d || !doc) return;
    d.querySelectorAll(".rs-print-page").forEach((el, i) => el.classList.toggle("rs-preview-off", i !== current));
    const h = host.current;
    const zoom = previewZoom(doc.widthIn, doc.heightIn, (h?.clientWidth ?? 0) - 40, (h?.clientHeight ?? 0) - 40);
    d.documentElement.style.setProperty("zoom", String(zoom));
  }, [doc, current]);

  useEffect(apply, [apply]);
  useEffect(() => {
    const h = host.current;
    if (!h || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => apply());
    ro.observe(h);
    return () => ro.disconnect();
  }, [apply]);

  const go = (d: number) => setPage(Math.max(0, Math.min(count - 1, current + d)));

  return (
    <section aria-label={t("print.preview")} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div
        ref={host}
        className="relative min-h-0 flex-1 overflow-hidden rounded border border-ui-border bg-neutral-300"
        onKeyDown={(e) => {
          if (e.key === "PageDown") go(1);
          else if (e.key === "PageUp") go(-1);
        }}
      >
        {doc && count > 0 && (
          <iframe
            ref={frame}
            title={t("print.preview")}
            data-testid="print-preview"
            data-pages={count}
            sandbox="allow-same-origin"
            className="absolute inset-0 h-full w-full border-0"
            srcDoc={srcdoc}
            onLoad={apply}
          />
        )}
        {(busy || !doc || count === 0) && (
          <p className="absolute inset-x-0 top-1/3 text-center text-sm text-neutral-700" data-testid="print-preview-status">
            {busy ? t("print.preparingPreview") : t("print.nothing")}
          </p>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 text-sm">
        <button type="button" className={NAV} aria-label={t("print.prevPage")} disabled={current <= 0} onClick={() => go(-1)}>
          ‹
        </button>
        <span data-testid="print-page-count" aria-live="polite">
          {count === 0 ? t("print.zeroPages") : t("print.pageOf", { page: current + 1, count })}
        </span>
        <button type="button" className={NAV} aria-label={t("print.nextPage")} disabled={current >= count - 1} onClick={() => go(1)}>
          ›
        </button>
      </div>
    </section>
  );
}
