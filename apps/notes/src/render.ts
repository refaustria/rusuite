// Static HTML of page content (ProseMirror JSON) for the read-only history preview and for printing: the schema's
// own `renderHTML`, then pictures from the notebook's blobs, tag icons before tagged blocks and live page-link
// titles. Plus the block diff that marks the paragraphs of an earlier version that differ from the current one.

import { getSchema } from "@tiptap/core";
import { DOMSerializer, Node as PMNode, type Schema } from "@tiptap/pm/model";
import { formatSize } from "./blobs";
import { notesSchemaExtensions } from "./editor/schema";
import { fileGlyph } from "./editor/media";
import type { EditorEnv } from "./editor/env";
import { isToDoKind, tagIconSvg, tagLook } from "./tags";

let schemaCache: Schema | null = null;
export function notesSchema(): Schema {
  schemaCache ??= getSchema(notesSchemaExtensions());
  return schemaCache;
}

/** Text of each top-level block (the unit the history diff compares). */
export function blockTexts(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((b) => out.push(`${b.type.name}|${JSON.stringify(b.attrs)}|${b.textBetween(0, b.content.size, "\n", "￼")}`));
  return out;
}

/**
 * Which blocks of `older` are not in `current` (longest common subsequence of equal blocks): those are the
 * paragraphs the version has that differ from today's page.
 */
export function changedBlocks(older: readonly string[], current: readonly string[]): boolean[] {
  const n = older.length;
  const m = current.length;
  // LCS table (pages are small: blocks, not characters).
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = older[i] === current[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const changed = new Array<boolean>(n).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (older[i] === current[j]) {
      changed[i] = false;
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return changed;
}

export interface RenderOptions {
  env: Pick<EditorEnv, "tag" | "tagLabel" | "pageTitle" | "t">;
  /** Object URLs of blobs by id (resolved before rendering). */
  urls: Map<string, string | null>;
  /** Top-level block indices to mark as changed (history preview). */
  changed?: readonly boolean[];
}

/** The blob ids of images in a document (to resolve their URLs before rendering). */
export function imageBlobs(json: unknown): string[] {
  const out = new Set<string>();
  const walk = (n: { type?: string; attrs?: { blob?: unknown }; content?: unknown[] }) => {
    if (n.type === "image" && typeof n.attrs?.blob === "string") out.add(n.attrs.blob);
    for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
  };
  walk(json as never);
  return [...out];
}

/** Renders page content as a detached element (`div.notes-content`). */
export function renderContent(json: object, opts: RenderOptions, doc: Document = document): HTMLElement {
  const schema = notesSchema();
  const node = PMNode.fromJSON(schema, json);
  const root = doc.createElement("div");
  root.className = "notes-content notes-static";
  root.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: doc }));
  // Pictures.
  root.querySelectorAll<HTMLElement>("figure[data-blob]").forEach((fig) => {
    const blob = fig.getAttribute("data-blob") ?? "";
    const alt = fig.getAttribute("data-alt") ?? "";
    fig.textContent = "";
    const url = opts.urls.get(blob);
    if (url) {
      const img = doc.createElement("img");
      img.src = url;
      img.alt = alt;
      fig.appendChild(img);
    } else fig.textContent = `🖼 ${alt}`;
  });
  // Picture size and alignment: from the PM attrs (renderHTML keeps only blob/alt).
  const figures = Array.from(root.querySelectorAll<HTMLElement>("figure[data-blob]"));
  let k = 0;
  node.descendants((n) => {
    if (n.type.name === "image") {
      const fig = figures[k++];
      if (fig) {
        fig.setAttribute("data-align", n.attrs.align === "center" ? "center" : "left");
        const img = fig.querySelector("img");
        if (img && n.attrs.width) img.style.width = `${Math.round(Number(n.attrs.width))}pt`;
      }
    }
    return true;
  });
  // Attachments: the card without buttons.
  const atts = Array.from(root.querySelectorAll<HTMLElement>("div[data-attachment]"));
  let a = 0;
  node.descendants((n) => {
    if (n.type.name === "attachment") {
      const el = atts[a++];
      if (el) {
        el.textContent = "";
        const icon = doc.createElement("span");
        icon.className = "notes-attachment-icon";
        icon.textContent = fileGlyph(n.attrs.name);
        const info = doc.createElement("span");
        info.className = "notes-attachment-info";
        info.innerHTML = `<span class="notes-attachment-name"></span><span class="notes-attachment-size"></span>`;
        (info.firstChild as HTMLElement).textContent = n.attrs.name;
        (info.lastChild as HTMLElement).textContent = formatSize(Number(n.attrs.size) || 0);
        el.append(icon, info);
      }
    }
    return true;
  });
  // Page links with live titles.
  root.querySelectorAll<HTMLElement>("a[data-page-id]").forEach((el) => {
    const title = opts.env.pageTitle(el.getAttribute("data-page-id") ?? "");
    if (title !== null) el.textContent = title || opts.env.t("notes.untitled");
    else el.classList.add("broken");
    el.removeAttribute("href");
  });
  // Tag icons.
  root.querySelectorAll<HTMLElement>("[data-tags]").forEach((el) => {
    const tags = (el.getAttribute("data-tags") ?? "").split(" ").filter(Boolean);
    const checked = el.getAttribute("data-checked") === "true";
    const wrap = doc.createElement("span");
    wrap.className = "notes-tag-icons";
    for (const id of tags) {
      const def = opts.env.tag(id);
      const look = tagLook(def);
      const s = doc.createElement("span");
      s.className = "notes-tag-icon";
      s.title = opts.env.tagLabel(id);
      s.innerHTML = tagIconSvg(look.icon, look.color, checked && isToDoKind(def?.kind ?? (id === "todo" ? "toDo" : undefined)));
      wrap.appendChild(s);
    }
    el.classList.add("notes-tagged");
    if (checked) el.classList.add("notes-done");
    el.insertBefore(wrap, el.firstChild);
  });
  if (opts.changed) {
    Array.from(root.children).forEach((el, i) => {
      if (opts.changed![i]) el.classList.add("notes-changed");
    });
  }
  return root;
}
