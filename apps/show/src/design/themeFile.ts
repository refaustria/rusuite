// Design › Browse for Themes / Save Current Theme (P9-S5): the files a
// design comes from and goes to. Saving a theme is an export – it never
// becomes the document's file: the desktop shell's `export_file` asks
// where (without binding the document), the web downloads it.

import { base64ToBytes, bytesToBase64, isTauri } from "@rusuite/ui-shared";

/** Accepted files of Browse for Themes. */
export const THEME_ACCEPT =
  ".thmx,.potx,.pptx,application/vnd.ms-officetheme,application/vnd.openxmlformats-officedocument.presentationml.template,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Whether a picked file is one Browse for Themes reads (by extension). */
export const isThemeFile = (name: string): boolean => /\.(thmx|potx|pptx)$/i.test(name);

/** `name` with the `.thmx` extension. */
export function thmxName(name: string): string {
  const base = name.replace(/\.thmx$/i, "").trim() || "Theme";
  return `${base.replace(/[\\/:*?"<>|]+/g, "-")}.thmx`;
}

/** Writes an exported file: the desktop's save dialog, else a browser download. `false` = cancelled. */
export async function exportFile(name: string, bytesBase64: string, filterName: string, extension: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const written = await invoke<string | null>("export_file", { suggestedName: name, bytesBase64, filterName, extension });
    return written !== null;
  }
  const blob = new Blob([base64ToBytes(bytesBase64) as BlobPart], { type: "application/vnd.ms-officetheme" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/** Lets the user pick a theme file (a temporary file input; `null` = cancelled). */
export function pickThemeFile(): Promise<{ name: string; bytesBase64: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = THEME_ACCEPT;
    input.style.display = "none";
    input.setAttribute("data-testid", "theme-file-input");
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      void file
        .arrayBuffer()
        .then((b) => resolve({ name: file.name, bytesBase64: bytesToBase64(new Uint8Array(b)) }))
        .catch(reject);
    });
    document.body.appendChild(input);
    input.click();
  });
}
