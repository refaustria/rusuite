// Review › Show Comments: the Comments pane right of the grid (as in
// Excel 365) – the threads of every sheet (`allComments`), grouped by
// sheet in sheet order and by cell, each with reply box, Resolve/Reopen,
// Edit and Delete; a filter for open/resolved threads and New Comment for
// the active cell. Clicking a card goes to its cell (P9-C7).

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import type { SheetThreads } from "../generated/SheetThreads";
import { ThreadView } from "./AnnotationLayer";
import { newCommentIcon } from "./icons";
import { paneThreads } from "./model";

export function CommentsPane({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const version = useCalc(store, (s) => s.version);
  const info = useCalc(store, (s) => s.info);
  const c = store.comments;
  const [all, setAll] = useState<SheetThreads[]>([]);
  useEffect(() => {
    if (!c.pane) return;
    let live = true;
    store.api.allComments(null).then(
      (list) => {
        if (live) setAll(list);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [store, c, c.pane, version]);
  if (!c.pane) return null;
  // Sheet order of the workbook; hidden sheets' comments are listed too (Excel).
  const order = new Map((info?.sheets ?? []).map((sh, i) => [sh.id, i]));
  const groups = [...all]
    .sort((a, b) => (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0))
    .map((g) => ({ sheet: g.sheet, name: info?.sheets.find((sh) => sh.id === g.sheet)?.name ?? "", threads: paneThreads(g.threads, c.paneFilter) }))
    .filter((g) => g.threads.length > 0);
  const threads = groups.flatMap((g) => g.threads);
  const close = () => {
    c.togglePane();
    store.focusGrid();
  };
  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-ui-border bg-ui-panel p-3 text-ui-fg"
      aria-label={t("calc.comments.pane")}
      data-testid="comments-pane"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("calc.comments.pane")}</h2>
        <button type="button" className="h-7 rounded px-2 text-sm hover:bg-ui-hover" aria-label={t("common.close")} onClick={close}>
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="flex h-8 items-center gap-1 rounded border border-ui-border bg-ui-bg px-2 text-sm hover:bg-ui-hover" onClick={() => c.newComment()}>
          {newCommentIcon(16)}
          {t("calc.comments.new")}
        </button>
        <select
          aria-label={t("calc.comments.filter")}
          className="h-8 rounded border border-ui-border bg-ui-bg px-1 text-sm"
          value={c.paneFilter}
          onChange={(e) => {
            c.paneFilter = e.target.value as typeof c.paneFilter;
            store.notify();
          }}
        >
          <option value="all">{t("calc.comments.filterAll")}</option>
          <option value="open">{t("calc.comments.filterOpen")}</option>
          <option value="resolved">{t("calc.comments.filterResolved")}</option>
        </select>
      </div>
      {threads.length === 0 && <p className="text-sm text-ui-muted">{t("calc.comments.none")}</p>}
      {groups.map((g) => (
        <div key={g.sheet} className="flex flex-col gap-2" role="group" aria-label={g.name} data-testid="comments-sheet" data-sheet={g.name}>
          {groups.length > 1 || g.sheet !== store.getState().activeSheet ? <h3 className="text-xs font-semibold uppercase text-ui-muted">{g.name}</h3> : null}
          {g.threads.map((th) => (
            <section
              key={th.id}
              className="rounded border border-ui-border bg-ui-bg p-2"
              aria-label={t("calc.comments.threadLabel", { cell: "" })}
              onClick={(e) => {
                // Clicking the card (not its controls) goes to the cell, on its sheet.
                if ((e.target as HTMLElement).closest("button,input,textarea,select,form")) return;
                store.goToRange(g.sheet, { r0: th.row, c0: th.col, r1: th.row, c1: th.col });
              }}
            >
              <ThreadView store={store} sheet={g.sheet} thread={th} />
            </section>
          ))}
        </div>
      ))}
    </aside>
  );
}
