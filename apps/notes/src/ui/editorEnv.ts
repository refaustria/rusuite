// The editor environment of the open page (node views, decorations) from the controller, plus the actions behind
// the attachment cards.

import { useMemo } from "react";
import type { NotesController } from "../controller";
import { LiveViews, type EditorEnv } from "../editor/env";
import { mimeOf } from "../insert";
import { t } from "../i18n";

/** The display label of a tag of the current notebook. */
export function tagLabel(ctl: NotesController, id: string): string {
  const def = ctl.tagDefs().find((x) => x.id === id);
  if (def?.label) return def.label;
  const key = `notes.tag.${id}`;
  const s = t(key);
  return s === key ? id : s;
}

/** Opens (new tab) or downloads an attachment's bytes. */
export async function attachmentAction(ctl: NotesController, action: "open" | "download", a: { blob: string; name: string }): Promise<void> {
  const url = await ctl.fileUrl(a.blob, mimeOf(a.name));
  if (!url) {
    ctl.fail(new Error(t("notes.attachment.missing", { name: a.name })));
    return;
  }
  if (action === "open") window.open(url, "_blank", "noopener");
  else {
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name || "file";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function makeEditorEnv(ctl: NotesController): EditorEnv {
  return {
    blobUrl: (sha) => ctl.blobUrl(sha),
    tag: (id) => ctl.tagDefs().find((x) => x.id === id),
    tagLabel: (id) => tagLabel(ctl, id),
    pageTitle: (id) => ctl.pageTitle(id),
    openPage: (id) => void ctl.openPageByDoc(id),
    attachment: (action, a) => void attachmentAction(ctl, action, a),
    t: (key, params) => t(key, params),
  };
}

export function useEditorEnv(ctl: NotesController): { env: EditorEnv; live: LiveViews } {
  return useMemo(() => ({ env: makeEditorEnv(ctl), live: new LiveViews() }), [ctl]);
}
