// View › Tasks: every to-do (check-list items and blocks with a to-do tag) of the open notebooks, grouped by
// notebook › section › page; filter open / done / all and by tag; a click jumps to the block, the check box ticks
// it on its page.

import { useMemo } from "react";
import { FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController, NotesState } from "../controller";
import type { TaskEntry } from "../generated/TaskEntry";
import type { TaskFilter } from "../generated/TaskFilter";
import { allPages, sectionOf } from "../tree";
import { tagIconSvg, tagLook } from "../tags";
import { useT } from "../i18n";
import { tagLabel } from "./editorEnv";
import { useNotes } from "./hooks";

export interface TaskGroup {
  notebook: string;
  notebookName: string;
  section: string;
  sectionTitle: string;
  sectionColor: string | null;
  pages: { docId: string; title: string; tasks: TaskEntry[] }[];
}

/** Filters and groups to-dos by notebook › section › page (in the order the core lists them). */
export function groupTasks(state: Pick<NotesState, "notebooks">, tasks: readonly TaskEntry[], filter: TaskFilter, tag: string | null): TaskGroup[] {
  const groups: TaskGroup[] = [];
  for (const task of tasks) {
    if (filter === "open" && task.checked) continue;
    if (filter === "done" && !task.checked) continue;
    if (tag && !task.tags.includes(tag)) continue;
    const nb = state.notebooks.find((n) => n.summary.id === task.notebookId);
    const page = nb ? allPages(nb.tree).find((p) => p.pageDoc === task.docId) : undefined;
    const sec = nb && page ? sectionOf(nb.tree, page.id) : null;
    const key = `${task.notebookId}\0${sec?.id ?? ""}`;
    let g = groups.find((x) => `${x.notebook}\0${x.section}` === key);
    if (!g) {
      g = { notebook: task.notebookId, notebookName: nb?.summary.info.name ?? "", section: sec?.id ?? "", sectionTitle: sec?.title ?? "", sectionColor: sec?.color ?? null, pages: [] };
      groups.push(g);
    }
    let p = g.pages.find((x) => x.docId === task.docId);
    if (!p) g.pages.push((p = { docId: task.docId, title: page?.title ?? task.pageTitle, tasks: [] }));
    p.tasks.push(task);
  }
  return groups;
}

export function TasksView({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const tasks = useNotes(ctl, (s) => s.tasks);
  const filter = useNotes(ctl, (s) => s.taskFilter);
  const tag = useNotes(ctl, (s) => s.taskTag);
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const allTags = useNotes(ctl, (s) => s.tags);
  const groups = useMemo(() => groupTasks({ notebooks }, tasks, filter, tag), [notebooks, tasks, filter, tag]);
  const tagChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of tasks) for (const id of task.tags) if (!seen.has(id)) seen.set(id, tagLabel(ctl, id));
    return [...seen];
  }, [tasks, ctl]);
  const count = groups.reduce((n, g) => n + g.pages.reduce((m, p) => m + p.tasks.length, 0), 0);
  const BTN = (on: boolean) => `rounded px-3 py-1 text-sm ${on ? "bg-[var(--notes-accent)] text-white" : "border border-ui-border hover:bg-ui-hover"} ${FOCUS_RING}`;
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-ui-bg" data-testid="tasks-view">
      <div className="mx-auto max-w-3xl px-10 pb-24 pt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("notes.tasks.title")}</h1>
          <button type="button" className={`rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => void ctl.showTasks(false)}>
            {t("notes.close")}
          </button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("notes.tasks.filter")}>
          {(["open", "done", "all"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} data-testid={`tasks-filter-${f}`} className={BTN(filter === f)} onClick={() => ctl.setTaskFilter(f)}>
              {t(`notes.tasks.${f}`)}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-sm">
            {t("notes.tasks.tag")}
            <select className="h-7 rounded border border-ui-border bg-ui-bg px-1" value={tag ?? ""} data-testid="tasks-tag" onChange={(e) => ctl.setTaskFilter(filter, e.target.value || null)}>
              <option value="">{t("notes.tasks.anyTag")}</option>
              {tagChoices.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-sm text-ui-muted" data-testid="tasks-count">
            {t("notes.tasks.count", { count })}
          </span>
        </div>
        {count === 0 && <p className="text-ui-muted" data-testid="tasks-empty">{t(filter === "done" ? "notes.tasks.noneDone" : "notes.tasks.none")}</p>}
        {groups.map((g) => (
          <section key={`${g.notebook}/${g.section}`} className="mb-5" data-testid="tasks-group">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ui-muted">
              <span className="h-3 w-3 rounded-sm" style={{ background: g.sectionColor ?? "var(--ui-border)" }} aria-hidden="true" />
              {g.notebookName} › {g.sectionTitle || t("notes.untitledSection")}
            </h2>
            {g.pages.map((p) => (
              <div key={p.docId} className="mb-2 ml-5">
                <h3 className="text-sm font-semibold">{p.title || t("notes.untitled")}</h3>
                <ul className="flex flex-col">
                  {p.tasks.map((task) => (
                    <li key={task.path.join("/")} className="flex items-start gap-2 py-0.5" data-testid="task">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={task.checked}
                        aria-label={t("notes.task.checkbox", { text: task.text })}
                        data-testid="task-check"
                        onChange={(e) => void ctl.setTaskChecked(task, e.target.checked)}
                      />
                      <button type="button" className={`min-w-0 flex-1 text-left hover:underline ${task.checked ? "text-ui-muted line-through" : ""} ${FOCUS_RING}`} data-testid="task-open" onClick={() => void ctl.openTask(task)}>
                        {task.text || t("notes.tasks.empty")}
                      </button>
                      <span className="flex shrink-0 gap-0.5">
                        {task.tags
                          .filter((id) => id !== "todo")
                          .map((id) => {
                            const look = tagLook(allTags[task.notebookId]?.find((d) => d.id === id));
                            return <span key={id} title={tagLabel(ctl, id)} dangerouslySetInnerHTML={{ __html: tagIconSvg(look.icon, look.color, false, 14) }} />;
                          })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
