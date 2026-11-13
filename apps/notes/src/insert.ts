// Inserting pictures and files (Insert › Picture / File, paste, drop): each file becomes a blob of the open
// notebook (`storeBlob`: the core's Blob effect); pictures an `image` block (downscaled above 4096 px – the
// downscaled copy is stored), everything else – and pictures the browser cannot decode – an `attachment` card.
// Rich paste (HTML from Word or web pages, P11-N6b) goes through the core's sanitiser in the converter module.

import type { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { formatSize, MAX_BLOB_BYTES, prepareImage, PX_TO_PT, sniffImage } from "./blobs";
import type { NotesController } from "./controller";
import { t } from "./i18n";

/** Widest picture on insert (points; about the page width). */
export const MAX_INSERT_PT = 510;

/** MIME type for Open / Download of an attachment, by its name. */
export function mimeOf(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Point size of a picture inserted at its natural pixel size (fitted to the page width). */
export function insertSize(widthPx: number, heightPx: number): { width: number; height: number } {
  const w = widthPx * PX_TO_PT;
  const h = heightPx * PX_TO_PT;
  const k = w > MAX_INSERT_PT ? MAX_INSERT_PT / w : 1;
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** What to insert for one file (exported for tests). */
export type Insertion =
  | { kind: "image"; blob: string; alt: string; width: number; height: number; downscaled: boolean }
  | { kind: "attachment"; blob: string; name: string; size: number }
  | { kind: "tooLarge"; name: string };

/** Stores `file` and says what to insert. `asFile`: always an attachment (Insert › File). */
export async function prepareFile(ctl: NotesController, file: File, asFile = false): Promise<Insertion | null> {
  if (file.size > MAX_BLOB_BYTES) return { kind: "tooLarge", name: file.name };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (mime && !asFile) {
    const img = await prepareImage(bytes, mime);
    if (img) {
      const blob = await ctl.storeBlob(img.bytes, mime);
      if (!blob) return null;
      return { kind: "image", blob, alt: file.name.replace(/\.[a-z0-9]+$/i, ""), ...insertSize(img.width, img.height), downscaled: img.downscaled };
    }
  }
  const blob = await ctl.storeBlob(bytes, mimeOf(file.name));
  if (!blob) return null;
  return { kind: "attachment", blob, name: file.name || t("notes.attachment.unnamed"), size: bytes.length };
}

/** Inserts files at `pos` (drop) or the selection (paste, Insert). */
export async function insertFiles(ctl: NotesController, editor: Editor, files: readonly File[], options: { pos?: number; asFile?: boolean } = {}): Promise<void> {
  // A selected picture / card stays: insert after it.
  let pos = options.pos ?? (editor.state.selection instanceof NodeSelection ? editor.state.selection.to : undefined);
  for (const file of files) {
    let ins: Insertion | null;
    try {
      ins = await prepareFile(ctl, file, options.asFile);
    } catch (e) {
      ctl.fail(e);
      continue;
    }
    if (!ins || editor.isDestroyed) continue;
    if (ins.kind === "tooLarge") {
      ctl.fail(new Error(t("notes.file.tooLarge", { name: ins.name, max: formatSize(MAX_BLOB_BYTES) })));
      continue;
    }
    const node =
      ins.kind === "image"
        ? { type: "image", attrs: { blob: ins.blob, alt: ins.alt, width: ins.width, height: ins.height } }
        : { type: "attachment", attrs: { blob: ins.blob, name: ins.name, size: ins.size } };
    const chain = editor.chain().focus();
    if (pos !== undefined) {
      chain.insertContentAt(pos, node).run();
      pos = Math.min(editor.state.selection.to, editor.state.doc.content.size);
    } else chain.insertContent(node).run();
    if (ins.kind === "image" && ins.downscaled) ctl.notify(t("notes.image.downscaled", { name: file.name }));
  }
}

/** Lets the user pick files (Insert › Picture / File). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.setAttribute("data-testid", "notes-file-input");
    document.body.appendChild(input);
    const done = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.addEventListener("change", done, { once: true });
    input.addEventListener("cancel", () => {
      resolve([]);
      input.remove();
    }, { once: true });
    input.click();
  });
}

/** Clipboard HTML that the converters should clean up: not ProseMirror's own (a copy inside the app keeps its
 * exact structure through ProseMirror's paste). */
export function isForeignHtml(html: string): boolean {
  return html.trim() !== "" && !/data-pm-slice/.test(html);
}

/** Pastes HTML from another app: the sanitised content replaces the selection the paste started on (headings,
 * lists, tables, links, `data:` images; remote images become links). Falls back to `text` when the converters
 * cannot load or the result does not fit the schema. */
export async function pasteRichHtml(ctl: NotesController, editor: Editor, html: string, text: string): Promise<void> {
  const before = editor.state.doc;
  const { from, to } = editor.state.selection;
  const r = await ctl.pasteHtml(html);
  if (editor.isDestroyed) return;
  const unchanged = editor.state.doc.eq(before);
  const range = unchanged ? { from, to } : { from: editor.state.selection.from, to: editor.state.selection.to };
  const content = r?.content.content ?? [];
  let slice: Slice | null = null;
  try {
    if (content.length > 0) slice = Slice.maxOpen(Fragment.fromJSON(editor.schema, content));
  } catch (e) {
    console.warn("Rusuite Notes: pasted content does not fit the page", e);
  }
  const view = editor.view;
  if (slice) {
    // As ProseMirror's own paste: replace the selection, the cursor after the inserted content.
    const tr = view.state.tr;
    if (unchanged) tr.setSelection(TextSelection.between(tr.doc.resolve(range.from), tr.doc.resolve(range.to)));
    view.dispatch(tr.replaceSelection(slice).setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
  } else if (text) {
    view.dispatch(view.state.tr.insertText(text, range.from, range.to).setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
  }
  view.focus();
}
