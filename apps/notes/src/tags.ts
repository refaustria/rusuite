// The built-in tags (notes-format §3: fixed ids, kinds as OneNote's) with OneNote's Ctrl+<n> keys. The picker
// writes `tags` (and `checked` for to-do kinds) on the selected blocks; the display and the tasks view: P11-N3.

import type { TagKind } from "./generated/TagKind";

export interface BuiltinTag {
  id: string;
  kind: TagKind;
  /** OneNote's key (`Mod+1` …). */
  shortcut?: string;
}

export const BUILTIN_TAGS: BuiltinTag[] = [
  { id: "todo", kind: "toDo", shortcut: "Mod+1" },
  { id: "important", kind: "important", shortcut: "Mod+2" },
  { id: "question", kind: "question", shortcut: "Mod+3" },
  { id: "remember", kind: "remember", shortcut: "Mod+4" },
  { id: "definition", kind: "definition", shortcut: "Mod+5" },
  { id: "highlight", kind: "highlight", shortcut: "Mod+6" },
  { id: "contact", kind: "contact", shortcut: "Mod+7" },
  { id: "address", kind: "address", shortcut: "Mod+8" },
  { id: "phone", kind: "phone", shortcut: "Mod+9" },
  { id: "idea", kind: "idea" },
  { id: "critical", kind: "critical" },
];
