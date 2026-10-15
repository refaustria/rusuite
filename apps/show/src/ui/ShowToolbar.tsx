// Show toolbars: file/edit/insert/arrange actions, and the ui-shared
// formatting toolbar (run formatting → `SetRunProps`, shape fill →
// `SetShapeStyle`) with paragraph alignment, bullets and outline colour.
// Everything is inside `[data-keep-edit]`, so using it does not end the
// overlay text editor.

import { useMemo, useRef, type ReactNode } from "react";
import {
  BTN, ColorPicker, Dropdown, Icon, ListButtons, Toolbar, bytesToBase64,
  type CellStylePatch, type CellStyleView, type IconName,
} from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Alignment } from "../generated/Alignment";
import type { AlignMode } from "../generated/AlignMode";
import type { Shape } from "../generated/Shape";
import type { ZOp } from "../generated/ZOp";
import { charLen, effectiveParagraph, effectiveRun, findShape, placeholderDef, textOf, themePalette } from "../model";
import { textPos } from "../state/commands";
import { useShow, type ShowState, type ShowStore } from "../state/store";

const TEXT_BTN = `${BTN} px-2 text-sm`;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 border-r border-ui-border px-1 last:border-r-0">
      {children}
    </div>
  );
}

/** The shape the formatting controls reflect: the edited one, else the first selected. */
function focusShape(s: ShowState): Shape | null {
  const slide = s.pres?.slides.find((x) => x.id === s.current);
  if (!slide) return null;
  const id = s.editing?.shape ?? s.selection[0];
  return id === undefined ? null : (findShape(slide.shapes, id)?.shape ?? null);
}

/** Formatting state shown by the toolbar. */
export function formattingOf(s: ShowState) {
  const slide = s.pres?.slides.find((x) => x.id === s.current);
  const shape = focusShape(s);
  if (!s.pres || !slide || !shape) return null;
  const def = placeholderDef(s.pres, slide, shape);
  const body = textOf(shape);
  let pi = 0;
  let runProps: RunProperties | undefined = body?.paragraphs[0]?.runs[0]?.props;
  if (s.editing && body) {
    const pos = textPos(s.editing.text, s.editing.start);
    pi = Math.min(pos.paragraph, body.paragraphs.length - 1);
    let at = 0;
    for (const r of body.paragraphs[pi]?.runs ?? []) {
      runProps = r.props;
      at += charLen(r.text);
      if (pos.offset <= at) break;
    }
  }
  const para = effectiveParagraph(def, body?.paragraphs[pi]?.props);
  return { shape, run: effectiveRun(def, runProps), para, hasText: !!body };
}

export interface ShowToolbarProps {
  store: ShowStore;
  onPresent: () => void;
}

export function ShowToolbar({ store, onPresent }: ShowToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useShow(store, (s) => s);
  const fmt = useMemo(() => formattingOf(state), [state]);
  const selCount = useShow(store, (s) => s.selection.length);
  const canUndo = useShow(store, (s) => s.canUndo);
  const canRedo = useShow(store, (s) => s.canRedo);
  const fileIo = useShow(store, (s) => s.fileIo);
  const theme = useShow(store, (s) => s.pres?.theme);
  const hasSlide = useShow(store, (s) => s.current !== null);
  const palette = themePalette(theme);
  const fileTip = fileIo ? undefined : "Needs .pptx support in the core (P4-7)";

  const value: CellStyleView = fmt
    ? {
        font: {
          // Theme fonts are shown by their resolved name.
          font: fmt.run.font?.kind === "theme" ? { kind: "named", value: theme?.fonts[fmt.run.font.value] || "Calibri" } : (fmt.run.font ?? undefined),
          size: fmt.run.size ?? undefined,
          bold: fmt.run.bold ?? undefined,
          italic: fmt.run.italic ?? undefined,
          underline: fmt.run.underline ?? undefined,
          strike: fmt.run.strike ?? undefined,
          color: fmt.run.color ?? undefined,
        } as CellStyleView["font"],
        fill: fmt.shape.fill.kind === "solid" ? { kind: "solid", color: fmt.shape.fill.value } : { kind: "none" },
      }
    : {};

  const onChange = (patch: CellStylePatch) => {
    if (patch.font) void store.applyRunPatch(patch.font as RunProperties);
    if (patch.fill) void store.setFill(patch.fill.kind === "solid" ? patch.fill.color : null);
  };

  const alignBtn = (a: Alignment, label: string, icon: IconName | null) => (
    <button
      type="button"
      className={icon ? BTN : TEXT_BTN}
      aria-label={label}
      aria-pressed={fmt?.para.alignment === a}
      disabled={!fmt?.hasText}
      onClick={() => void store.setAlignment(a)}
    >
      {icon ? <Icon name={icon} /> : "≡"}
    </button>
  );

  const ALIGN: { value: AlignMode; label: string }[] = [
    { value: "left", label: "Align left" },
    { value: "centerH", label: "Align center" },
    { value: "right", label: "Align right" },
    { value: "top", label: "Align top" },
    { value: "centerV", label: "Align middle" },
    { value: "bottom", label: "Align bottom" },
  ];
  const ORDER: { value: ZOp; label: string }[] = [
    { value: "bringToFront", label: "Bring to front (Ctrl+Shift+])" },
    { value: "bringForward", label: "Bring forward (Ctrl+])" },
    { value: "sendBackward", label: "Send backward (Ctrl+[)" },
    { value: "sendToBack", label: "Send to back (Ctrl+Shift+[)" },
  ];

  const insertImage = async (file: File) => {
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    await store.insertPicture(file.type || "image/png", bytesBase64);
  };

  return (
    <div data-keep-edit className="flex flex-col">
      <div role="toolbar" aria-label="Presentation" className="flex flex-wrap items-center gap-1 border-b border-ui-border bg-ui-panel px-2 py-1">
        <span className="mr-2 text-sm font-semibold">Rusuite Show</span>
        <Group label="File">
          <button type="button" className={TEXT_BTN} aria-label="Open" title={fileTip ?? "Open (Ctrl+O)"} disabled={!fileIo} onClick={() => void store.open()}>
            Open
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Save" title={fileTip ?? "Save (Ctrl+S)"} disabled={!fileIo} onClick={() => void store.save()}>
            Save
          </button>
        </Group>
        <Group label="Edit">
          <button type="button" className={TEXT_BTN} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void store.undo()}>
            ↶
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => void store.redo()}>
            ↷
          </button>
        </Group>
        <Group label="Insert">
          <button type="button" className={TEXT_BTN} aria-label="Insert rectangle" disabled={!hasSlide} onClick={() => void store.insert("rect")}>
            ▭
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Insert ellipse" disabled={!hasSlide} onClick={() => void store.insert("ellipse")}>
            ◯
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Insert line" disabled={!hasSlide} onClick={() => void store.insert("line")}>
            ╱
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Insert text box" disabled={!hasSlide} onClick={() => void store.insert("textBox")}>
            Text
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Insert image" disabled={!hasSlide} onClick={() => fileInput.current?.click()}>
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
              if (file) void insertImage(file).catch((err) => store.pushError(err));
            }}
          />
        </Group>
        <Group label="Arrange">
          <Dropdown label="Align shapes" disabled={selCount === 0} trigger={<span className="px-1 text-sm">Align</span>} items={ALIGN} onSelect={(m) => void store.align(m)} />
          <button type="button" className={TEXT_BTN} aria-label="Distribute horizontally" disabled={selCount < 3} onClick={() => void store.distribute("horizontal")}>
            ⇹
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Distribute vertically" disabled={selCount < 3} onClick={() => void store.distribute("vertical")}>
            ⇕
          </button>
          <Dropdown label="Order" disabled={selCount === 0} trigger={<span className="px-1 text-sm">Order</span>} items={ORDER} onSelect={(op) => void store.zOrder(op)} />
          <button type="button" className={TEXT_BTN} aria-label="Group" title="Group (Ctrl+G)" disabled={selCount < 2} onClick={() => void store.group()}>
            Group
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Ungroup" title="Ungroup (Ctrl+Shift+G)" disabled={selCount === 0} onClick={() => void store.ungroup()}>
            Ungroup
          </button>
        </Group>
        <button
          type="button"
          onClick={onPresent}
          disabled={!hasSlide}
          className="ml-auto rounded bg-orange-700 px-3 py-1 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-40"
        >
          Present
        </button>
      </div>
      <Toolbar value={value} onChange={onChange} groups={["font", "style", "colors"]} fillLabel="Shape fill" disabled={!fmt} theme={palette}>
        <Group label="Paragraph">
          {alignBtn("left", "Align text left", "alignLeft")}
          {alignBtn("center", "Center text", "alignCenter")}
          {alignBtn("right", "Align text right", "alignRight")}
          {alignBtn("justify", "Justify text", null)}
        </Group>
        <ListButtons
          bullet={fmt?.para.bullet?.kind === "char"}
          ordered={fmt?.para.bullet?.kind === "autoNum"}
          disabled={!fmt?.hasText}
          onToggle={(kind) => void store.toggleBullet(kind)}
          onIndent={(d) => void store.indent(d)}
        />
        <Group label="Outline">
          <ColorPicker
            label="Shape outline"
            kind="fill"
            value={fmt && fmt.shape.line.fill.kind === "solid" ? fmt.shape.line.fill.value : undefined}
            theme={palette}
            disabled={!fmt}
            onSelect={(c) => void store.setLine(c)}
          />
        </Group>
      </Toolbar>
    </div>
  );
}
