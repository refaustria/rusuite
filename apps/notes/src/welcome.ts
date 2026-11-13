// The welcome page of the first start (en/de from the catalogs): what Notes does, in a few blocks that also show
// the editor's basics (a heading, a check list, bold text).

import { t } from "./i18n";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const task = (text: string, checked = false) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] });

/** ProseMirror JSON of the welcome page. */
export function welcomeContent(): object {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: t("notes.welcome.intro1") }, { type: "text", marks: [{ type: "bold" }], text: t("notes.welcome.introBold") }] },
      p(t("notes.welcome.intro2")),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t("notes.welcome.start") }] },
      { type: "taskList", content: [task(t("notes.welcome.task1"), true), task(t("notes.welcome.task2")), task(t("notes.welcome.task3")), task(t("notes.welcome.task4"))] },
      p(t("notes.welcome.keys")),
    ],
  };
}
