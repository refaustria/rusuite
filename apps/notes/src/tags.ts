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

/** Icons a tag can show (built-ins use theirs, notes-format §3; custom tags pick one). 20×20 SVG paths. */
export const TAG_ICONS: Record<string, string> = {
  checkbox: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/>',
  checked: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M6.5 10.2l2.4 2.4 4.6-5.2"/>',
  star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  question: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 114 1.6c-.9.7-1.8 1.1-1.8 2.4M10 14.5v.1"/>',
  lightbulb: '<path d="M7 13.5a5.5 5.5 0 116 0V15H7zM7.8 17.5h4.4"/>',
  exclamation: '<path d="M10 2.8l7.7 13.4H2.3z"/><path d="M10 8v3.8M10 14v.1"/>',
  person: '<circle cx="10" cy="6.5" r="3.2"/><path d="M3.8 17c.6-3.4 3.2-5 6.2-5s5.6 1.6 6.2 5"/>',
  house: '<path d="M3 9.5L10 3.5l7 6M5 8v8.5h10V8M8.5 16.5v-4.5h3v4.5"/>',
  phone: '<path d="M5 2.8h3l1.3 3.6-2 1.4a10 10 0 004.9 4.9l1.4-2 3.6 1.3v3a1.6 1.6 0 01-1.7 1.6A14 14 0 013.4 4.5 1.6 1.6 0 015 2.8z"/>',
  bookmark: '<path d="M5.5 2.8h9v14.4L10 13.8l-4.5 3.4z"/>',
  book: '<path d="M3 4.5c2.5-1 5-1 7 .8 2-1.8 4.5-1.8 7-.8v11.5c-2.5-1-5-1-7 .8-2-1.8-4.5-1.8-7-.8zM10 5.3v11.5"/>',
  marker: '<path d="M5 13l7-8 3 3-8 7H5zM3 17.5h14"/>',
  flag: '<path d="M4.5 17.5V3M4.5 3.5h10l-2.2 3.5 2.2 3.5h-10"/>',
  heart: '<path d="M10 16.5S3 12.4 3 7.6A3.6 3.6 0 0110 6a3.6 3.6 0 017 1.6c0 4.8-7 8.9-7 8.9z"/>',
  lock: '<rect x="4" y="9" width="12" height="8.5" rx="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 017 0V9"/>',
  clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
  pin: '<path d="M10 17.5s-5.5-5.4-5.5-9.5a5.5 5.5 0 0111 0c0 4.1-5.5 9.5-5.5 9.5z"/><circle cx="10" cy="8" r="2"/>',
  smile: '<circle cx="10" cy="10" r="7.5"/><path d="M7 11.8a3.6 3.6 0 006 0M7.5 7.8v.1M12.5 7.8v.1"/>',
};

/** The icons offered for custom tags (Customize tags). */
export const CUSTOM_TAG_ICONS = ["star", "flag", "heart", "lock", "clock", "pin", "smile", "lightbulb", "question", "exclamation", "bookmark", "person"];

/** Colours offered for tags. */
export const TAG_COLORS = ["#7719AA", "#D13438", "#CA5010", "#C19C00", "#498205", "#038387", "#0078D4", "#5C2E91", "#69797E"];

/** Default colour of a tag kind (OneNote-like). */
const KIND_COLOR: Partial<Record<TagKind, string>> = {
  toDo: "#0078D4",
  customToDo: "#0078D4",
  important: "#C19C00",
  question: "#5C2E91",
  idea: "#C19C00",
  critical: "#D13438",
  contact: "#038387",
  address: "#038387",
  phone: "#038387",
  remember: "#CA5010",
  definition: "#498205",
  highlight: "#C19C00",
};

/** The icon and colour a tag shows. */
export function tagLook(def: { kind: TagKind; icon?: string; color?: string } | undefined): { icon: string; color: string } {
  if (!def) return { icon: "star", color: "#69797E" };
  const icon = def.icon && TAG_ICONS[def.icon] ? def.icon : def.kind === "toDo" || def.kind === "customToDo" ? "checkbox" : "star";
  return { icon, color: def.color ?? KIND_COLOR[def.kind] ?? "#7719AA" };
}

/** Whether tags of this kind have a check box (and appear in the tasks view). */
export const isToDoKind = (kind: TagKind | undefined) => kind === "toDo" || kind === "customToDo";

/** An SVG element string for a tag icon (`checked` turns a check box into a ticked one). */
export function tagIconSvg(icon: string, color: string, checked = false, size = 16): string {
  const name = icon === "checkbox" && checked ? "checked" : icon;
  return `<svg aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TAG_ICONS[name] ?? TAG_ICONS.star}</svg>`;
}
