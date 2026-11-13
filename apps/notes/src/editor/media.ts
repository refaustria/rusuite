// `image` and `attachment` (notes-format §7.1): block atoms showing a blob. Images render from the notebook's blobs
// (object URLs), have corner handles to resize (aspect kept, size stored in points), alt text and left/center
// alignment (`align`, an optional attribute). Attachments are a card with icon, name, size, Open and Download.

import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { formatSize, PX_TO_PT } from "../blobs";
import { NO_ENV, type EditorEnv } from "./env";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    notesMedia: {
      insertImage: (attrs: { blob: string; alt?: string | null; width?: number | null; height?: number | null }) => ReturnType;
      insertAttachment: (attrs: { blob: string; name: string; size: number }) => ReturnType;
    };
  }
}

export interface MediaOptions {
  env: EditorEnv;
}

const CORNERS = ["nw", "ne", "sw", "se"] as const;

/** Smallest picture width while resizing (px). */
const MIN_PX = 24;

/** The new width for a corner drag of `dx` px (left corners grow to the left). */
export function resizedWidth(start: number, dx: number, corner: (typeof CORNERS)[number], max: number): number {
  const w = corner === "nw" || corner === "sw" ? start - dx : start + dx;
  return Math.round(Math.max(MIN_PX, Math.min(max, w)));
}

/** Points for a width in px and the picture's aspect (height / width). */
export function sizeInPoints(widthPx: number, aspect: number): { width: number; height: number } {
  return { width: Math.round(widthPx * PX_TO_PT), height: Math.round(widthPx * aspect * PX_TO_PT) };
}

function setAttrs(view: EditorView, getPos: () => number | undefined, patch: Record<string, unknown>): void {
  const pos = getPos();
  if (pos === undefined) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
}

export const Image = Node.create<MediaOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions: () => ({ env: NO_ENV }),
  addAttributes: () => ({
    blob: { default: null },
    alt: { default: null },
    width: { default: null },
    height: { default: null },
    align: { default: null },
  }),
  parseHTML: () => [{ tag: "figure[data-blob]", getAttrs: (el) => ({ blob: (el as HTMLElement).getAttribute("data-blob"), alt: (el as HTMLElement).getAttribute("data-alt") }) }],
  renderHTML: ({ node }) => ["figure", { "data-blob": node.attrs.blob, "data-alt": node.attrs.alt ?? "", class: "notes-image" }, `🖼 ${node.attrs.alt ?? ""}`],
  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    const env = () => this.options.env;
    return ({ node: initial, getPos, view }) => {
      let node: PMNode = initial;
      const dom = document.createElement("figure");
      dom.className = "notes-image";
      dom.contentEditable = "false";
      dom.setAttribute("data-testid", "image");
      const img = document.createElement("img");
      img.draggable = false;
      dom.appendChild(img);
      const missing = document.createElement("span");
      missing.className = "notes-image-missing";
      const handles = CORNERS.map((c) => {
        const h = document.createElement("span");
        h.className = `notes-resize notes-resize-${c}`;
        h.setAttribute("data-corner", c);
        h.setAttribute("data-testid", `image-resize-${c}`);
        h.setAttribute("aria-hidden", "true");
        dom.appendChild(h);
        return h;
      });
      let blob: string | null = null;
      const render = () => {
        const a = node.attrs;
        dom.setAttribute("data-align", a.align === "center" ? "center" : "left");
        dom.setAttribute("data-blob", String(a.blob ?? ""));
        img.alt = a.alt ?? "";
        dom.title = a.alt ?? "";
        img.style.width = a.width ? `${Math.round(Number(a.width) / PX_TO_PT)}px` : "";
        if (a.blob !== blob) {
          blob = a.blob;
          img.removeAttribute("src");
          missing.remove();
          if (blob) {
            const want = blob;
            void env()
              .blobUrl(want)
              .then((url) => {
                if (blob !== want) return;
                if (url) img.src = url;
                else {
                  missing.textContent = `🖼 ${node.attrs.alt || env().t("notes.image.missing")}`;
                  dom.appendChild(missing);
                }
              });
          }
        }
      };
      render();
      // Corner drag: width follows the pointer, height keeps the aspect; one change on release.
      for (const h of handles) {
        h.addEventListener("pointerdown", (e) => {
          if (!view.editable) return;
          e.preventDefault();
          e.stopPropagation();
          const corner = h.getAttribute("data-corner") as (typeof CORNERS)[number];
          const start = img.getBoundingClientRect().width;
          const aspect = img.naturalWidth ? img.naturalHeight / img.naturalWidth : node.attrs.width && node.attrs.height ? node.attrs.height / node.attrs.width : 1;
          const max = (view.dom as HTMLElement).clientWidth || 2000;
          const x0 = e.clientX;
          let w = start;
          h.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => {
            w = resizedWidth(start, ev.clientX - x0, corner, max);
            img.style.width = `${w}px`;
          };
          const up = () => {
            h.removeEventListener("pointermove", move);
            h.removeEventListener("pointerup", up);
            h.removeEventListener("pointercancel", up);
            if (Math.abs(w - start) >= 1) setAttrs(view, getPos, sizeInPoints(w, aspect));
          };
          h.addEventListener("pointermove", move);
          h.addEventListener("pointerup", up);
          h.addEventListener("pointercancel", up);
        });
      }
      return {
        dom,
        update(n) {
          if (n.type !== node.type) return false;
          node = n;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          dom.classList.remove("ProseMirror-selectednode");
        },
        stopEvent: (e) => e.target instanceof HTMLElement && e.target.classList.contains("notes-resize"),
        ignoreMutation: () => true,
      };
    };
  },
});

/** A file type's glyph for the attachment card. */
export function fileGlyph(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (["pdf"].includes(ext)) return "PDF";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "DOC";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "XLS";
  if (["ppt", "pptx", "odp"].includes(ext)) return "PPT";
  if (["zip", "7z", "rar", "gz", "tar"].includes(ext)) return "ZIP";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "IMG";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "AUD";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "VID";
  if (["txt", "md"].includes(ext)) return "TXT";
  return ext ? ext.slice(0, 3).toUpperCase() : "FILE";
}

export const Attachment = Node.create<MediaOptions>({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions: () => ({ env: NO_ENV }),
  addAttributes: () => ({ blob: { default: null }, name: { default: "" }, size: { default: 0 } }),
  parseHTML: () => [{ tag: "div[data-attachment]", getAttrs: (el) => ({ blob: (el as HTMLElement).getAttribute("data-attachment"), name: (el as HTMLElement).getAttribute("data-name") ?? "" }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-attachment": node.attrs.blob, "data-name": node.attrs.name, class: "notes-attachment" }), `📎 ${node.attrs.name}`],
  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    const env = () => this.options.env;
    return ({ node: initial }) => {
      let node: PMNode = initial;
      const dom = document.createElement("div");
      dom.className = "notes-attachment";
      dom.contentEditable = "false";
      dom.setAttribute("data-testid", "attachment");
      const icon = document.createElement("span");
      icon.className = "notes-attachment-icon";
      icon.setAttribute("aria-hidden", "true");
      const info = document.createElement("span");
      info.className = "notes-attachment-info";
      const name = document.createElement("span");
      name.className = "notes-attachment-name";
      const size = document.createElement("span");
      size.className = "notes-attachment-size";
      info.append(name, size);
      const button = (action: "open" | "download") => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "notes-attachment-button";
        b.setAttribute("data-testid", `attachment-${action}`);
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          env().attachment(action, { blob: node.attrs.blob, name: node.attrs.name, size: node.attrs.size });
        });
        return b;
      };
      const open = button("open");
      const download = button("download");
      dom.append(icon, info, open, download);
      const render = () => {
        icon.textContent = fileGlyph(node.attrs.name);
        name.textContent = node.attrs.name || env().t("notes.attachment.unnamed");
        size.textContent = formatSize(Number(node.attrs.size) || 0);
        open.textContent = env().t("notes.attachment.open");
        download.textContent = env().t("notes.attachment.download");
        open.setAttribute("aria-label", env().t("notes.attachment.openNamed", { name: node.attrs.name }));
        download.setAttribute("aria-label", env().t("notes.attachment.downloadNamed", { name: node.attrs.name }));
      };
      render();
      return {
        dom,
        update(n) {
          if (n.type !== node.type) return false;
          node = n;
          render();
          return true;
        },
        stopEvent: (e) => e.target instanceof HTMLButtonElement,
        ignoreMutation: () => true,
      };
    };
  },
});
