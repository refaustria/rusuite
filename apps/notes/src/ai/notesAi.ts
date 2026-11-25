// The AI assistant of Notes (P11-N7, desktop only – the web build has none, ADR 0009): Summarise page, Rewrite
// selection, Extract tasks (a checklist under the selection) and Ask about this page. Results go into the page as
// ordinary editor edits (one transaction each → the page's sync → one undo step).
//
// Context: the selected text (no selection: the caret's paragraph) and the page's title; the page's whole text only
// with "Include whole document" (the summary and the questions ask for it).

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { paragraphsOf, plainText, PLAIN_TEXT_RULE, type AiAction, type AiAppAdapter, type AiApply, type DocContext } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { t } from "../i18n";

/** The text range a result belongs to (captured when the request starts). */
export interface NotesAnchor {
  from: number;
  to: number;
  text: string;
}

const textOf = (doc: PMNode, from: number, to: number) => doc.textBetween(from, to, "\n\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : ""));

/** The selection, or the caret's paragraph when nothing is selected. */
export function selectionRange(editor: Editor): NotesAnchor & { whole: boolean } {
  const { from, to, empty, $from } = editor.state.selection;
  if (!empty) return { from, to, text: textOf(editor.state.doc, from, to), whole: false };
  return { from: $from.start(), to: $from.end(), text: textOf(editor.state.doc, $from.start(), $from.end()), whole: true };
}

/** Paragraph nodes of plain text (one per line). */
export function paragraphNodes(text: string): JSONContent[] {
  const paras = paragraphsOf(plainText(text));
  return (paras.length ? paras : [""]).map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" }));
}

/** The model's task lines (one per line; bullets, numbers and checkboxes removed) → task texts. */
export function taskLines(text: string): string[] {
  return plainText(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s*)?/, "").trim())
    .filter(Boolean);
}

/** A checklist (`taskList`) of `tasks`, all open. */
export function checklistNode(tasks: readonly string[]): JSONContent {
  return {
    type: "taskList",
    content: tasks.map((task) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: task }] }] })),
  };
}

/** The position after the top-level block holding the selection's end. */
function afterBlock(editor: Editor): number {
  const $to = editor.state.selection.$to;
  return $to.depth >= 1 ? $to.after(1) : $to.pos;
}

export function notesAiAdapter(editor: Editor, ctl: NotesController): AiAppAdapter {
  const anchorOf = (turn: { anchor?: unknown }) => turn.anchor as NotesAnchor | undefined;
  const insertAfter = (content: JSONContent | JSONContent[]) => editor.chain().focus().insertContentAt(afterBlock(editor), content).run();
  const insert: AiApply<string> = {
    label: t("notes.ai.insert"),
    run: async (text) => {
      if (!insertAfter(paragraphNodes(text))) throw new Error(t("notes.ai.notApplied"));
      return t("notes.ai.inserted");
    },
  };
  const replace: AiApply<string> = {
    label: t("notes.ai.replace"),
    run: async (text, turn) => {
      const a = anchorOf(turn);
      const doc = editor.state.doc;
      const valid = a && a.to <= doc.content.size && textOf(doc, a.from, a.to) === a.text;
      const range = valid ? { from: a!.from, to: a!.to } : { from: editor.state.selection.from, to: editor.state.selection.to };
      const paras = paragraphsOf(plainText(text));
      if (!editor.chain().focus().insertContentAt(range, paras.length <= 1 ? (paras[0] ?? "") : paragraphNodes(text)).run()) throw new Error(t("notes.ai.notApplied"));
      return t("notes.ai.replaced");
    },
  };
  const checklist: AiApply<string> = {
    label: t("notes.ai.insertChecklist"),
    disabled: (text) => (taskLines(text).length ? null : t("notes.ai.noTasks")),
    run: async (text) => {
      const tasks = taskLines(text);
      if (!tasks.length) throw new Error(t("notes.ai.noTasks"));
      if (!insertAfter(checklistNode(tasks))) throw new Error(t("notes.ai.notApplied"));
      return t("notes.ai.checklistInserted", { count: tasks.length });
    },
  };
  const title = () => ctl.getState().opened?.title || t("notes.untitled");
  const label = () => {
    const r = selectionRange(editor);
    if (!r.text.trim()) return t("notes.ai.ctxNone");
    return t(r.whole ? "notes.ai.ctxParagraph" : "notes.ai.ctxSelection", { count: r.text.length });
  };

  return {
    app: "notes",
    appName: () => "Rusuite Notes",
    textApply: [insert, replace],
    anchor: () => {
      const r = selectionRange(editor);
      return { from: r.from, to: r.to, text: r.text } satisfies NotesAnchor;
    },
    subscribe: (fn) => {
      editor.on("selectionUpdate", fn);
      editor.on("update", fn);
      return () => {
        editor.off("selectionUpdate", fn);
        editor.off("update", fn);
      };
    },
    hasSelection: () => selectionRange(editor).text.trim() !== "",
    selectionLabel: label,
    documentSize: () => editor.state.doc.textContent.length,
    context: async (includeDocument): Promise<DocContext> => {
      const r = selectionRange(editor);
      const doc = editor.state.doc;
      return {
        app: "notes",
        title: title(),
        description: `A notebook page, ${doc.textContent.length} characters, ${doc.childCount} blocks.`,
        selectionLabel: label(),
        selection: r.text,
        ...(includeDocument ? { document: textOf(doc, 0, doc.content.size) } : {}),
      };
    },
    actions: (): AiAction<string>[] => [
      {
        id: "summarize",
        label: t("notes.ai.summarize"),
        needsDocument: true,
        task: () => "Summarise the page in a few short sentences (fewer for a short page). Keep the page's language.",
        system: PLAIN_TEXT_RULE,
        apply: [insert],
      },
      {
        id: "rewrite",
        label: t("notes.ai.rewrite"),
        needsSelection: true,
        task: () => "Rewrite the selected text so it reads better; keep its meaning, facts and language.",
        system: PLAIN_TEXT_RULE,
        apply: [replace, insert],
      },
      {
        id: "tasks",
        label: t("notes.ai.tasks"),
        needsDocument: true,
        task: () =>
          "List the action items (to-dos) in the page, or in the selection when there is one: one short task per line, starting with a verb, without bullets, numbers or checkboxes. If there are none, answer with an empty line.",
        system: PLAIN_TEXT_RULE,
        apply: [checklist, insert],
      },
      {
        id: "askPage",
        label: t("notes.ai.askPage"),
        needsDocument: true,
        input: { placeholder: t("notes.ai.askPlaceholder"), required: true },
        task: (question) => `Answer this question about the page: ${question}`,
        system: PLAIN_TEXT_RULE.replace("it is inserted", "it may be inserted"),
        apply: [insert],
      },
    ],
  };
}
