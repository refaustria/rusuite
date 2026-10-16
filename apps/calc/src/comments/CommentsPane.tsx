// Review › Show Comments: the Comments pane right of the grid (as in
// Excel 365) – the threads of the active sheet by cell, each with reply
// box, Resolve/Reopen, Edit and Delete; a filter for open/resolved
// threads and New Comment for the active cell.

import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { ThreadView } from "./AnnotationLayer";
import { newCommentIcon } from "./icons";
import { paneThreads } from "./model";

export function CommentsPane({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const sheet = useCalc(store, (s) => s.activeSheet);
  const c = store.comments;
  if (!c.pane) return null;
  const threads = paneThreads(c.of(sheet).threads, c.paneFilter);
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
      {threads.map((th) => (
        <section
          key={th.id}
          className="rounded border border-ui-border bg-ui-bg p-2"
          aria-label={t("calc.comments.threadLabel", { cell: "" })}
          onClick={(e) => {
            // Clicking the card (not its controls) selects the cell.
            if ((e.target as HTMLElement).closest("button,input,textarea,select,form")) return;
            store.goToRange(sheet, { r0: th.row, c0: th.col, r1: th.row, c1: th.col });
          }}
        >
          <ThreadView store={store} sheet={sheet} thread={th} />
        </section>
      ))}
    </aside>
  );
}
