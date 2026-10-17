// Word's keys for special characters (Insert › Symbol › Special
// Characters): Alt+Ctrl+Num- em dash, Ctrl+Num- en dash, Ctrl+Shift+Space
// non-breaking space, Ctrl+Shift+Hyphen non-breaking hyphen, Ctrl+Hyphen
// optional hyphen, Alt+Ctrl+C / R / T © ® ™, Alt+Ctrl+Period ellipsis.
// Keys are matched by `code` for letters (layout-independent, as Word) and
// by `key` for the hyphen (it sits elsewhere on a German keyboard).

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The character a special-character key types, or null. */
export function specialCharFor(e: KeyLike): string | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const minus = e.code === "NumpadSubtract" || e.code === "Minus" || e.key === "-" || e.key === "_";
  if (e.altKey && !e.shiftKey) {
    if (minus) return "—";
    if (e.code === "KeyC") return "©";
    if (e.code === "KeyR") return "®";
    if (e.code === "KeyT") return "™";
    if (e.code === "Period" || e.key === ".") return "…";
    return null;
  }
  if (e.altKey) return null;
  if (e.shiftKey) {
    if (e.code === "Space" || e.key === " ") return " ";
    if (minus && e.code !== "NumpadSubtract") return "‑";
    return null;
  }
  if (e.code === "NumpadSubtract") return "–";
  if (e.key === "-" || e.code === "Minus") return "­";
  return null;
}
