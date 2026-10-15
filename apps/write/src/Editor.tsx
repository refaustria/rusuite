import { EditorContent, useEditor, useEditorState, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export const PLACEHOLDER_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Welcome to Rusuite Write" }] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "This is a placeholder document. Start typing to edit it." }],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First item" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second item" }] }] },
      ],
    },
  ],
};

const btn = "h-7 min-w-7 rounded border border-ui-border px-2 text-sm text-ui-fg hover:bg-ui-hover";

function ToolbarButton(props: { label: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      className={`${btn} ${props.active ? "bg-ui-hover font-semibold" : "bg-ui-bg"}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function EditorToolbar({ editor }: { editor: TiptapEditor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-1 border-b border-ui-border bg-ui-panel px-2 py-1">
      <ToolbarButton label="B" title="Bold" active={active.bold} onClick={() => run().toggleBold().run()} />
      <ToolbarButton label="I" title="Italic" active={active.italic} onClick={() => run().toggleItalic().run()} />
      <ToolbarButton label="U" title="Underline" active={active.underline} onClick={() => run().toggleUnderline().run()} />
      <span className="mx-1 h-5 w-px bg-ui-border" />
      <ToolbarButton label="H1" title="Heading 1" active={active.h1} onClick={() => run().toggleHeading({ level: 1 }).run()} />
      <ToolbarButton label="H2" title="Heading 2" active={active.h2} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <ToolbarButton label="H3" title="Heading 3" active={active.h3} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <span className="mx-1 h-5 w-px bg-ui-border" />
      <ToolbarButton label="• List" title="Bullet list" active={active.bullet} onClick={() => run().toggleBulletList().run()} />
      <ToolbarButton label="1. List" title="Numbered list" active={active.ordered} onClick={() => run().toggleOrderedList().run()} />
    </div>
  );
}

export function Editor() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: PLACEHOLDER_DOC,
    editorProps: { attributes: { "data-testid": "editor", class: "tiptap-content min-h-full outline-none" } },
  });
  if (!editor) return null;
  return (
    <>
      <EditorToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-auto bg-ui-panel p-6">
        <div className="mx-auto max-w-3xl bg-ui-bg px-12 py-10 shadow">
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  );
}
