// Pure helpers of the P8-24 commands: hyperlink ranges of the text being
// edited, the media a set of shapes uses, what Reuse Slides sends for
// picked slides, and the media kind of a picked file.

import type { Background } from "../generated/Background";
import type { Design } from "../generated/Design";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Layout } from "../generated/Layout";
import type { MediaItem } from "../generated/MediaItem";
import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";
import { charLen } from "../model";
import { textPos } from "./commands";

/** The char range (code points) of the word around `offset` in `line` (empty range: none). */
export function wordAt(line: string, offset: number): { from: number; to: number } {
  const chars = Array.from(line);
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}_\-.@:/]/u.test(c);
  let from = Math.min(offset, chars.length);
  let to = from;
  while (from > 0 && word(chars[from - 1])) from--;
  while (to < chars.length && word(chars[to])) to++;
  return { from, to };
}

/**
 * `SetHyperlink` commands for the editor's selection `start..end` (UTF-16
 * offsets in `text`, paragraphs joined by `\n`); a collapsed selection
 * links the word at the caret. `[]` when there is no text to link.
 */
export function linkCommands(shape: NodeId, text: string, start: number, end: number, link: Hyperlink | null): ShowCommand[] {
  const lines = text.split("\n");
  if (start === end) {
    const p = textPos(text, start);
    const w = wordAt(lines[p.paragraph] ?? "", p.offset);
    return w.to > w.from ? [{ type: "setHyperlink", shape, paragraph: p.paragraph, from: w.from, to: w.to, link }] : [];
  }
  const a = textPos(text, Math.min(start, end));
  const b = textPos(text, Math.max(start, end));
  const out: ShowCommand[] = [];
  for (let p = a.paragraph; p <= b.paragraph; p++) {
    const from = p === a.paragraph ? a.offset : 0;
    const to = p === b.paragraph ? b.offset : charLen(lines[p] ?? "");
    if (to > from) out.push({ type: "setHyperlink", shape, paragraph: p, from, to, link });
  }
  return out;
}

/** The hyperlink of the run at the editor's caret (for the Link dialog), if any. */
export function linkAt(shape: Shape, text: string, offset: number): Hyperlink | null {
  if (shape.kind.kind !== "auto" || !shape.kind.value.text) return null;
  const p = textPos(text, offset);
  const para = shape.kind.value.text.paragraphs[p.paragraph];
  let at = 0;
  for (const r of para?.runs ?? []) {
    const len = charLen(r.text);
    if (p.offset >= at && p.offset <= at + len && r.hyperlink) return r.hyperlink;
    at += len;
  }
  return null;
}

/** Every media id `shapes` use (pictures, audio/video and posters, chart workbooks), recursively, in first-use order. */
export function mediaIdsOf(shapes: Shape[]): number[] {
  const out: number[] = [];
  const add = (id: number | undefined) => {
    if (id !== undefined && !out.includes(id)) out.push(id);
  };
  const walk = (list: Shape[]) => {
    for (const s of list) {
      const k = s.kind;
      if (k.kind === "picture") add(k.value.media);
      else if (k.kind === "media") {
        add(k.value.media);
        add(k.value.poster);
      } else if (k.kind === "chart") add(k.value.workbook);
      else if (k.kind === "group") walk(k.value.children);
    }
  };
  walk(shapes);
  return out;
}

const bgMedia = (b: Background | null | undefined): number[] => (b?.kind === "picture" ? [b.value.media] : []);

/**
 * What Reuse Slides sends for slides `ids` of the source deck `src`: the
 * slides, their layouts and the media they and those layouts use. With
 * `keep` (Keep source formatting, P9-S5) also the designs the slides use –
 * the source's main design as id 0 – with all their layouts, and the media
 * of their masters and layouts (pictures and picture backgrounds).
 */
export function reusePayload(src: Presentation, ids: NodeId[], keep = false): { slides: Slide[]; layouts: Layout[]; designs: Design[]; media: MediaItem[] } {
  const slides = src.slides.filter((s) => ids.includes(s.id));
  const layouts = src.layouts.filter((l) => slides.some((s) => !s.design && s.layout === l.kind));
  const all: Design[] = [{ id: 0, master: src.master!, layouts: src.layouts, theme: src.theme }, ...(src.designs ?? [])];
  const designs = keep && src.master ? all.filter((d) => slides.some((s) => (s.design ?? 0) === d.id)) : [];
  const shapes = [...slides.flatMap((s) => s.shapes), ...layouts.flatMap((l) => l.shapes ?? [])];
  const backgrounds = [...slides.flatMap((s) => bgMedia(s.background)), ...layouts.flatMap((l) => bgMedia(l.background))];
  for (const d of designs) {
    shapes.push(...(d.master.shapes ?? []), ...d.layouts.flatMap((l) => l.shapes ?? []));
    backgrounds.push(...bgMedia(d.master.background), ...d.layouts.flatMap((l) => bgMedia(l.background)));
  }
  const used = new Set([...mediaIdsOf(shapes), ...backgrounds]);
  return { slides, layouts, designs, media: src.media.filter((m) => used.has(m.id)) };
}

/** The MIME type of a picked audio/video file (from its type, else its extension); `null` = not supported. */
export function mediaType(file: { name: string; type: string }): string | null {
  if (/^(audio|video)\//.test(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4" };
  return byExt[ext] ?? null;
}

/** Accepted files of Insert › Video / Audio. */
export const VIDEO_ACCEPT = "video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv,.m4v";
export const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/ogg,audio/mp4,.mp3,.wav,.ogg,.m4a";
