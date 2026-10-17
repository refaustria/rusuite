// The balloon editor (P9-W6): a small Tiptap editor for a comment's text
// with Word's formatting shortcuts (Ctrl+B / I / U, links) and the @
// picker (typing `@` offers the document's authors; Enter / Tab / click
// inserts the mention). Ctrl+Enter posts, Esc cancels.

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Block } from "../generated/Block";
import { nextTempId } from "../sync/SyncPlugin";
import { useT } from "../i18n";
import { commentToPM, mentionQuery, pmText, pmToCommentBlocks, type MentionTarget } from "./richText";

export interface ComposerResult {
  text: string;
  content: Block[];
}

const BTN =
  "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs hover:bg-ui-hover aria-pressed:bg-ui-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus";

/** The text before the caret in its paragraph. */
function textBefore(editor: Editor): string {
  const { $from } = editor.state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
}

/** Replaces the `@query` before the caret by the mention of `t` (and a space). */
export function insertMention(editor: Editor, query: string, t: MentionTarget): void {
  const { from } = editor.state.selection;
  const start = from - query.length - 1;
  editor
    .chain()
    .focus()
    .deleteRange({ from: start, to: from })
    .insertContent([
      { type: "text", text: `@${t.name}`, marks: [{ type: "link", attrs: { href: `mailto:${t.email}`, class: "comment-mention" } }] },
      { type: "text", text: " " },
    ])
    .unsetMark("link")
    .run();
}

export function RichComposer({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  testId,
  people,
}: {
  initial?: Block[];
  placeholder: string;
  submitLabel: string;
  onSubmit: (r: ComposerResult) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId: string;
  /** The @ picker's people for a query. */
  people: (query: string) => MentionTarget[];
}) {
  const t = useT();
  const [empty, setEmpty] = useState(true);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [, setTick] = useState(0);
  const state = useRef({ query: null as string | null, pick: 0, list: [] as MentionTarget[] });
  const submitRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, bulletList: false, orderedList: false,
        listItem: false, listKeymap: false, dropcursor: false, gapcursor: false, trailingNode: false, undoRedo: { depth: 50 },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: null } },
      }),
    ],
    content: commentToPM(initial),
    editorProps: {
      attributes: {
        class: "comment-composer min-h-12 max-h-40 overflow-auto rounded border border-ui-border bg-ui-bg p-1.5 text-sm text-ui-fg focus:outline-none focus:ring-2 focus:ring-ui-focus",
        "data-testid": testId,
        "aria-label": placeholder,
        role: "textbox",
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, e) => {
        const s = state.current;
        if (s.query !== null && s.list.length) {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            s.pick = (s.pick + (e.key === "ArrowDown" ? 1 : s.list.length - 1)) % s.list.length;
            setPick(s.pick);
            return true;
          }
          if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
            e.preventDefault();
            const ed = editorRef.current;
            if (ed) insertMention(ed, s.query, s.list[s.pick]!);
            return true;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            s.query = null;
            setQuery(null);
            return true;
          }
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitRef.current();
          return true;
        }
        if (e.key === "Escape" && cancelRef.current) {
          e.preventDefault();
          e.stopPropagation();
          cancelRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => update(editor),
    onSelectionUpdate: ({ editor }) => update(editor),
    immediatelyRender: true,
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;
  function update(ed: Editor) {
    setEmpty(ed.isEmpty);
    const q = ed.state.selection.empty ? mentionQuery(textBefore(ed)) : null;
    const list = q === null ? [] : peopleRef.current(q).slice(0, 8);
    state.current = { query: q, pick: q === state.current.query ? Math.min(state.current.pick, Math.max(0, list.length - 1)) : 0, list };
    setQuery(q);
    setPick(state.current.pick);
    setTick((n) => n + 1);
  }
  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus("end", { scrollIntoView: false });
  }, [autoFocus, editor]);
  submitRef.current = () => {
    if (!editor || editor.isEmpty) return;
    const json = editor.getJSON();
    const text = pmText(json);
    if (!text) return;
    onSubmit({ text, content: pmToCommentBlocks(json, nextTempId) });
    editor.commands.clearContent(true);
  };
  const list = state.current.list;
  const marks = useMemo(() => ({ bold: editor?.isActive("bold"), italic: editor?.isActive("italic"), underline: editor?.isActive("underline") }), [editor, editor?.state]); // eslint-disable-line
  return (
    <div className="relative mt-1.5 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <div className="relative">
        <EditorContent editor={editor} />
        {empty && <span className="pointer-events-none absolute left-2 top-1.5 text-sm text-ui-muted">{placeholder}</span>}
        {query !== null && list.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-48 overflow-auto rounded border border-ui-border bg-ui-panel py-0.5 text-sm shadow-md" role="listbox" aria-label={t("write.comments.mentionList")} data-testid="mention-list">
            {list.map((p, i) => (
              <li key={p.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === pick}
                  data-testid="mention-option"
                  className={`block w-full truncate px-2 py-0.5 text-left hover:bg-ui-hover ${i === pick ? "bg-ui-hover" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (editor) insertMention(editor, query, p);
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  {p.email.includes("@") && <span className="ml-2 text-xs text-ui-muted">{p.email}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={`${BTN} font-bold`} aria-label={t("fmt.bold")} title={t("fmt.bold")} aria-pressed={!!marks.bold} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}>B</button>
        <button type="button" className={`${BTN} italic`} aria-label={t("fmt.italic")} title={t("fmt.italic")} aria-pressed={!!marks.italic} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}>I</button>
        <button type="button" className={`${BTN} underline`} aria-label={t("fmt.underline")} title={t("fmt.underline")} aria-pressed={!!marks.underline} onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run(); }}>U</button>
        <button
          type="button"
          className={BTN}
          aria-label={t("write.comments.mention")}
          title={t("write.comments.mention")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor?.chain().focus().insertContent("@").run();
          }}
        >
          @
        </button>
        <span className="flex-1" />
        {onCancel && (
          <button type="button" className={`${BTN} px-2`} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button
          type="button"
          className="inline-flex min-h-8 items-center justify-center rounded bg-[#2b579a] px-3 text-xs font-medium text-white hover:bg-[#244a84] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
          disabled={empty}
          title={t("write.comments.postTip")}
          data-testid={`${testId}-post`}
          onClick={() => submitRef.current()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
