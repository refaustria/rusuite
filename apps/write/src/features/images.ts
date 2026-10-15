// Pictures: insertion from a file or the clipboard (Rust-first
// `InsertImage`, scaled to the text width like Word), the selected image,
// and size/alt changes as editor transactions (→ `SetImageSize` /
// `SetImageAlt` through the mapper).

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { bytesToBase64 } from "@rusuite/ui-shared";
import type { PageSetup } from "../generated/PageSetup";
import { cursorBlock } from "../sync/editorCommands";
import { EMU_PER_PX, TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";

/** Natural size of an image (falls back to 96×96 px when it cannot be decoded). */
export function naturalSize(url: string): Promise<{ w: number; h: number }> {
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
    img.src = url;
  });
}

/** Text width of the page in px (600 without a page setup). */
export function textWidthPx(page: PageSetup | null): number {
  return page ? (page.width - page.margins.left - page.margins.right) / TWIPS_PER_PX : 600;
}

/** `w`×`h` px scaled down (never up) to fit `maxW`, in EMU. */
export function fitToWidth(w: number, h: number, maxW: number): { width: number; height: number } {
  const scale = Math.min(1, maxW / w);
  return { width: Math.round(w * scale * EMU_PER_PX), height: Math.round(h * scale * EMU_PER_PX) };
}

/** Inserts an image file at the caret (`InsertImage`). */
export async function insertImageFile(editor: Editor, ctl: SyncController, file: Blob, name?: string): Promise<boolean> {
  const at = cursorBlock(editor);
  if (!at) return false;
  const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const contentType = file.type || "image/png";
  const { w, h } = await naturalSize(`data:${contentType};base64,${bytesBase64}`);
  const size = fitToWidth(w, h, textWidthPx(ctl.page));
  await ctl.run({ type: "insertImage", block: at.id, offset: at.offset, contentType, bytesBase64, ...size, alt: name ?? null });
  return true;
}

/** Image files of a clipboard or drop payload. */
export function imageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length) return files;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/** The selected image node and its position, or null. */
export function selectedImage(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "image") return { node: sel.node, pos: sel.from };
  return null;
}

/** Changes attributes of the image at `pos` (optimistic; the mapper sends `SetImageSize`/`SetImageAlt`). */
export function setImageAttrs(view: EditorView, pos: number, attrs: { width?: number; height?: number; alt?: string | null }): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return false;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  return true;
}

/** Restores an image's natural size (fitted to the text width). */
export async function resetImageSize(view: EditorView, ctl: SyncController, pos: number): Promise<boolean> {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image" || node.attrs.mediaId == null) return false;
  const { w, h } = await naturalSize(await ctl.media.resolve(node.attrs.mediaId));
  return setImageAttrs(view, pos, fitToWidth(w, h, textWidthPx(ctl.page)));
}
