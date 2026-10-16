// Write's AI actions (P8-37): Rewrite, Shorten, Expand, Fix grammar & spelling, Change tone, Translate, Summarize
// document, Draft from prompt, Table from text. Results go into the editor as ordinary edits (one ProseMirror
// transaction each → the sync's insert / replace commands → one undo step).
//
// Context: the selected text (no selection: the caret's paragraph) and the document's title and counts; the whole
// document's text only with "Include whole document".

import type { Editor, JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  DRAFT_TOOL, PLAIN_TEXT_RULE, TABLE_TOOL, paragraphsOf, parseDraft, parseTable, plainText,
  type AiAction, type AiAppAdapter, type AiApply, type DocContext, type DraftBlock, type TableResult,
} from "@rusuite/ui-shared";
import { t } from "../i18n";
import { countDocWords } from "../wordCount";
import type { SyncController } from "../sync/SyncPlugin";

/** The text range a result belongs to (captured when the request starts). */
export interface WriteAnchor {
  from: number;
  to: number;
  text: string;
}

const BLOCK_SEP = "\n\n";

/** The plain text of `from..to` (paragraphs separated by blank lines, table cells by tabs). */
export function textOf(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, BLOCK_SEP, (leaf) => (leaf.type.name === "hardBreak" ? "\n" : ""));
}

/** The selection, or the caret's paragraph when nothing is selected. */
export function selectionRange(editor: Editor): WriteAnchor & { whole: boolean } {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to, text: textOf(state.doc, from, to), whole: false };
  const start = $from.start();
  const end = $from.end();
  return { from: start, to: end, text: textOf(state.doc, start, end), whole: true };
}

/** Paragraph JSON of plain text (one node per line; an empty text gives one empty paragraph). */
export function paragraphNodes(text: string): JSONContent[] {
  const paras = paragraphsOf(plainText(text));
  return (paras.length ? paras : [""]).map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" }));
}

/** Replaces the anchor's range (or, if the text there changed meanwhile, the current selection) by `text`. */
export function replaceRange(editor: Editor, anchor: WriteAnchor | undefined, text: string): boolean {
  const doc = editor.state.doc;
  const valid = anchor && anchor.to <= doc.content.size && textOf(doc, anchor.from, anchor.to) === anchor.text;
  const range = valid ? { from: anchor!.from, to: anchor!.to } : { from: editor.state.selection.from, to: editor.state.selection.to };
  const paras = paragraphsOf(plainText(text));
  const content: string | JSONContent[] = paras.length <= 1 ? (paras[0] ?? "") : paragraphNodes(text);
  return editor.chain().focus().insertContentAt(range, content).run();
}

/** The position after the top-level block holding the selection's end (where new blocks go). */
export function afterBlock(editor: Editor): number {
  const $to = editor.state.selection.$to;
  return $to.depth >= 1 ? $to.after(1) : $to.pos;
}

export function insertBlocks(editor: Editor, content: JSONContent[]): boolean {
  return editor.chain().focus().insertContentAt(afterBlock(editor), content).run();
}

export function draftNodes(blocks: DraftBlock[]): JSONContent[] {
  return blocks.map((b) =>
    b.kind === "heading"
      ? { type: "heading", attrs: { level: b.level }, content: [{ type: "text", text: b.text }] }
      : { type: "paragraph", content: [{ type: "text", text: b.text }] },
  );
}

export function tableNode(table: TableResult): JSONContent {
  return {
    type: "table",
    content: table.rows.map((row, r) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: "tableCell",
        content: [
          cell
            ? { type: "paragraph", content: [{ type: "text", text: cell, ...(table.header && r === 0 ? { marks: [{ type: "bold" }] } : {}) }] }
            : { type: "paragraph" },
        ],
      })),
    })),
  };
}

const TONES = ["formal", "friendly", "concise"] as const;

export function writeAiAdapter(editor: Editor, ctl: SyncController): AiAppAdapter {
  const anchorOf = (turn: { anchor?: unknown }) => turn.anchor as WriteAnchor | undefined;
  const replace: AiApply<string> = {
    label: t("ai.write.replace"),
    run: async (text, turn) => {
      if (!replaceRange(editor, anchorOf(turn), text)) throw new Error(t("ai.write.notApplied"));
      return t("ai.write.replaced");
    },
  };
  const insert: AiApply<string> = {
    label: t("ai.write.insert"),
    run: async (text) => {
      if (!insertBlocks(editor, paragraphNodes(text))) throw new Error(t("ai.write.notApplied"));
      return t("ai.write.inserted");
    },
  };
  const textAction = (id: string, label: string, task: string, extra: Partial<AiAction<string>> = {}): AiAction<string> => ({
    id,
    label,
    needsSelection: true,
    task: () => task,
    system: PLAIN_TEXT_RULE,
    apply: [replace, insert],
    ...extra,
  });
  const words = () => countDocWords(editor.state.doc);

  return {
    app: "write",
    textApply: [insert, replace],
    anchor: () => {
      const r = selectionRange(editor);
      return { from: r.from, to: r.to, text: r.text } satisfies WriteAnchor;
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
    selectionLabel: () => {
      const r = selectionRange(editor);
      if (!r.text.trim()) return t("ai.write.ctxNone");
      return t(r.whole ? "ai.write.ctxParagraph" : "ai.write.ctxSelection", { count: r.text.length });
    },
    documentSize: () => editor.state.doc.textContent.length,
    context: async (includeDocument): Promise<DocContext> => {
      const r = selectionRange(editor);
      const doc = editor.state.doc;
      return {
        app: "write",
        title: ctl.getState().name ?? t("doc.untitled"),
        description: `Word-processor document, ${words()} words, ${doc.childCount} blocks.`,
        selectionLabel: r.text.trim() ? t(r.whole ? "ai.write.ctxParagraph" : "ai.write.ctxSelection", { count: r.text.length }) : t("ai.write.ctxNone"),
        selection: r.text,
        ...(includeDocument ? { document: textOf(doc, 0, doc.content.size) } : {}),
      };
    },
    actions: () => [
      textAction("rewrite", t("ai.write.rewrite"), "Rewrite the selected text so it reads better; keep its meaning, facts and language."),
      textAction("shorten", t("ai.write.shorten"), "Shorten the selected text to about half its length; keep the key points and its language."),
      textAction("expand", t("ai.write.expand"), "Expand the selected text with more detail and explanation (about twice as long); keep its tone and language."),
      textAction("fix", t("ai.write.fix"), "Correct the grammar, spelling and punctuation of the selected text. Change nothing else: keep wording, meaning and language."),
      ...TONES.map((tone) =>
        textAction(`tone-${tone}`, t(`ai.write.tone.${tone}`), `Rewrite the selected text in a ${tone} tone; keep its meaning and language.`),
      ),
      textAction("translate-en", t("ai.write.translateEn"), "Translate the selected text into English."),
      textAction("translate-de", t("ai.write.translateDe"), "Translate the selected text into German."),
      textAction("translate", t("ai.write.translateTo"), "", {
        input: { placeholder: t("ai.write.translatePlaceholder"), required: true },
        task: (lang) => `Translate the selected text into ${lang}.`,
      }),
      {
        id: "summarize",
        label: t("ai.write.summarize"),
        needsDocument: true,
        task: () => "Summarize the full document in a few short paragraphs (or fewer for a short document).",
        system: PLAIN_TEXT_RULE,
        apply: [insert],
      },
      {
        id: "draft",
        label: t("ai.write.draft"),
        input: { placeholder: t("ai.write.draftPlaceholder"), required: true },
        task: (what) => `Draft a new section for the document: ${what}. Use headings where they help. Match the document's language unless asked otherwise.`,
        tool: DRAFT_TOOL,
        parse: parseDraft,
        preview: (blocks: DraftBlock[]) => (
          <div className="flex flex-col gap-1 rounded bg-ui-bg p-2">
            {blocks.slice(0, 12).map((b, i) =>
              b.kind === "heading" ? (
                <p key={i} className="font-semibold">
                  {b.text}
                </p>
              ) : (
                <p key={i} className="line-clamp-3">
                  {b.text}
                </p>
              ),
            )}
            {blocks.length > 12 && <p className="text-xs text-ui-muted">{t("ai.more", { count: blocks.length - 12 })}</p>}
          </div>
        ),
        apply: [
          {
            label: t("ai.write.insertDraft"),
            run: async (blocks: DraftBlock[]) => {
              if (!insertBlocks(editor, draftNodes(blocks))) throw new Error(t("ai.write.notApplied"));
              return t("ai.write.insertedBlocks", { count: blocks.length });
            },
          },
        ],
      } satisfies AiAction<DraftBlock[]>,
      {
        id: "table",
        label: t("ai.write.table"),
        needsSelection: true,
        task: () => "Turn the selected text into a table: find the records and their fields; put column headings in the first row when the data has them.",
        tool: TABLE_TOOL,
        parse: parseTable,
        preview: (table: TableResult) => (
          <div className="max-h-48 overflow-auto rounded bg-ui-bg">
            <table className="text-xs">
              <tbody>
                {table.rows.slice(0, 12).map((row, r) => (
                  <tr key={r} className={r === 0 && table.header ? "font-semibold" : ""}>
                    {row.map((c, i) => (
                      <td key={i} className="border border-ui-border px-1">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
        apply: [
          {
            label: t("ai.write.insertTable"),
            run: async (table: TableResult) => {
              if (!insertBlocks(editor, [tableNode(table)])) throw new Error(t("ai.write.notApplied"));
              return t("ai.write.insertedTable", { rows: table.rows.length, cols: table.rows[0]?.length ?? 0 });
            },
          },
        ],
      } satisfies AiAction<TableResult>,
    ],
  };
}
