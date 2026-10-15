// Write toolbar: ui-shared run formatting groups plus paragraph style,
// alignment, lists/indent, insert table/image, find/replace, file and
// undo/redo actions.

import { useRef, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  BTN, Dropdown, Icon, ListButtons, ParagraphStyleSelect, Toolbar, bytesToBase64,
  type CellStylePatch, type CellStyleView, type IconName,
} from "@rusuite/ui-shared";
import type { Alignment } from "../generated/Alignment";
import {
  PARAGRAPH_STYLES, alignmentAt, cursorBlock, indent, runPropsAt, setAlignment, setParagraphStyle, setTextStyle, styleOf,
} from "../sync/editorCommands";
import { EMU_PER_PX, TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";

const TEXT_BTN = `${BTN} px-2 text-sm`;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 border-r border-ui-border px-1 last:border-r-0">
      {children}
    </div>
  );
}

/** Natural size of an image (falls back to 96×96 px when it cannot be decoded). */
function naturalSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (w: number, h: number) => resolve({ w: w || 96, h: h || 96 });
    const timer = setTimeout(() => done(96, 96), 3000);
    img.onload = () => {
      clearTimeout(timer);
      done(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(96, 96);
    };
    img.src = dataUrl;
  });
}

export interface WriteToolbarProps {
  editor: Editor;
  ctl: SyncController;
  onOpen: () => void;
  onSave: () => void;
  onFind: () => void;
}

export function WriteToolbar({ editor, ctl, onOpen, onSave, onFind }: WriteToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection;
      let style = "Normal";
      for (let d = $from.depth; d > 0; d--) {
        if (TEXTBLOCK_TYPES.has($from.node(d).type.name)) {
          style = styleOf($from.node(d));
          break;
        }
      }
      return {
        props: runPropsAt(e),
        style,
        align: alignmentAt(e),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
      };
    },
  });
  const value: CellStyleView = {
    font: { ...s.props, font: s.props.font ?? undefined, size: s.props.size ?? undefined } as CellStyleView["font"],
    fill: s.props.highlight ? { kind: "solid", color: s.props.highlight } : undefined,
  };

  const onChange = (patch: CellStylePatch) => {
    const f = patch.font ?? {};
    const chain = () => editor.chain().focus();
    if (f.bold !== undefined) (f.bold ? chain().setBold() : chain().unsetBold()).run();
    if (f.italic !== undefined) (f.italic ? chain().setItalic() : chain().unsetItalic()).run();
    if (f.strike !== undefined) (f.strike ? chain().setStrike() : chain().unsetStrike()).run();
    if (f.underline !== undefined) {
      if (f.underline === "none") chain().unsetMark("underline").run();
      else chain().setMark("underline", { kind: f.underline }).run();
    }
    const ts: Parameters<typeof setTextStyle>[1] = {};
    if (f.font) ts.font = f.font;
    if (f.size) ts.size = f.size;
    if (f.color) ts.color = f.color.kind === "auto" ? null : f.color;
    if (patch.fill) ts.highlight = patch.fill.kind === "solid" ? patch.fill.color : null;
    if (Object.keys(ts).length) {
      editor.commands.focus();
      setTextStyle(editor, ts);
    }
  };

  const alignBtn = (a: Alignment, label: string, icon: IconName | null) => (
    <button
      type="button"
      className={icon ? BTN : TEXT_BTN}
      aria-label={label}
      aria-pressed={s.align === a}
      onClick={() => {
        editor.commands.focus();
        setAlignment(editor, a);
      }}
    >
      {icon ? <Icon name={icon} /> : "≡"}
    </button>
  );

  const insertTable = (size: string) => {
    const [rows, cols] = size.split("x").map(Number) as [number, number];
    const at = cursorBlock(editor);
    void ctl.run({ type: "insertTable", after: at?.id ?? null, parent: at?.cell ?? null, rows, cols });
  };

  const insertImage = async (file: File) => {
    const at = cursorBlock(editor);
    if (!at) return;
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const contentType = file.type || "image/png";
    const { w, h } = await naturalSize(`data:${contentType};base64,${bytesBase64}`);
    const page = ctl.page;
    const maxPx = page ? (page.width - page.margins.left - page.margins.right) / TWIPS_PER_PX : 600;
    const scale = Math.min(1, maxPx / w);
    await ctl.run({
      type: "insertImage", block: at.id, offset: at.offset, contentType, bytesBase64,
      width: Math.round(w * scale * EMU_PER_PX), height: Math.round(h * scale * EMU_PER_PX), alt: file.name,
    });
  };

  return (
    <Toolbar value={value} onChange={onChange} groups={["font", "style", "colors"]} fillLabel="Highlight color">
      <Group label="Paragraph">
        <ParagraphStyleSelect
          value={s.style}
          styles={PARAGRAPH_STYLES}
          onChange={(id) => {
            editor.commands.focus();
            setParagraphStyle(editor, id);
          }}
        />
        {alignBtn("left", "Align left", "alignLeft")}
        {alignBtn("center", "Align center", "alignCenter")}
        {alignBtn("right", "Align right", "alignRight")}
        {alignBtn("justify", "Justify", null)}
      </Group>
      <ListButtons
        bullet={s.bullet}
        ordered={s.ordered}
        onToggle={(kind) => (kind === "bullet" ? editor.chain().focus().toggleBulletList() : editor.chain().focus().toggleOrderedList()).run()}
        onIndent={(d) => {
          editor.commands.focus();
          indent(editor, d);
        }}
      />
      <Group label="Insert">
        <Dropdown
          label="Insert table"
          trigger={<span className="px-1 text-sm">Table</span>}
          items={["2x2", "3x3", "4x4", "2x5"].map((v) => ({ value: v, label: v.replace("x", " × ") }))}
          onSelect={insertTable}
        />
        <button type="button" className={TEXT_BTN} aria-label="Insert image" onClick={() => fileInput.current?.click()}>
          Image
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          className="hidden"
          data-testid="image-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void insertImage(file);
          }}
        />
      </Group>
      <Group label="Edit">
        <button type="button" className={TEXT_BTN} aria-label="Undo" onClick={() => ctl.undo()}>
          ↶
        </button>
        <button type="button" className={TEXT_BTN} aria-label="Redo" onClick={() => ctl.redo()}>
          ↷
        </button>
        <button type="button" className={TEXT_BTN} aria-label="Find and replace" onClick={onFind}>
          Find
        </button>
      </Group>
      <Group label="File">
        <button type="button" className={TEXT_BTN} aria-label="Open" title="Open (Ctrl+O)" onClick={onOpen}>
          Open
        </button>
        <button type="button" className={TEXT_BTN} aria-label="Save" title="Save (Ctrl+S)" onClick={onSave}>
          Save
        </button>
      </Group>
    </Toolbar>
  );
}
