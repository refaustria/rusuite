// File formats of File › Import / Export (P11-N6b): which converter a file goes to, the file pickers' `accept`
// lists and the names of exported files.

import type { ExportFormat } from "../generated/ExportFormat";
import type { ImportKind } from "../generated/ImportKind";

const EXT: Record<string, ImportKind> = {
  one: "oneNote",
  onepkg: "oneNote",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  docx: "docx",
};

/** The importer of a file by its extension (`null`: not importable). */
export function importKindOf(name: string): ImportKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return (m && EXT[m[1]!.toLowerCase()]) ?? null;
}

/** A OneNote package (a new notebook), by its CAB signature `MSCF`. */
export function isOneNotePackage(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x53 && bytes[2] === 0x43 && bytes[3] === 0x46;
}

export const IMPORT_ACCEPT: Record<ImportKind, string> = {
  oneNote: ".one,.onepkg",
  markdown: ".md,.markdown,text/markdown",
  html: ".html,.htm,text/html",
  docx: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ALL_IMPORT_ACCEPT = Object.values(IMPORT_ACCEPT).join(",");

const MIME: Record<string, string> = {
  md: "text/markdown",
  zip: "application/zip",
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** The extension of an export (a Markdown section is a zip of pages and assets). */
export function exportExtension(format: ExportFormat, section: boolean): string {
  return format === "md" ? (section ? "zip" : "md") : format;
}

export function exportMime(format: ExportFormat, section: boolean): string {
  return MIME[exportExtension(format, section)]!;
}

/** `Title.ext` with the characters file systems refuse replaced. */
export function exportFileName(title: string, format: ExportFormat, section: boolean, fallback = "Untitled"): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120) || fallback;
  return `${base}.${exportExtension(format, section)}`;
}
