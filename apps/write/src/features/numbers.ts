// Number formats shared by the structure decorations and the pagination:
// list/page number formats (Word's `numFmt`) and note numbers.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { LevelKind } from "../generated/LevelKind";

export function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  let x = n;
  for (const [v, s] of table) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out;
}

function letters(n: number): string {
  return String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

/** `n` in a list/page number format (Word's `numFmt`). */
export function formatNumber(n: number, kind: LevelKind | null | undefined): string {
  if (n <= 0) return String(n);
  switch (kind) {
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "lowerLetter":
      return letters(n);
    case "upperLetter":
      return letters(n).toUpperCase();
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    default:
      return String(n);
  }
}

/** Note id → label: footnotes 1, 2, …, endnotes i, ii, … in the order of their first reference in the body. */
export function noteNumbers(doc: PMNode): Map<number, string> {
  const out = new Map<number, string>();
  let foot = 0;
  let end = 0;
  doc.forEach((top) => {
    if (top.type.name === "notes") return;
    top.descendants((n) => {
      if (n.type.name !== "noteRef") return true;
      const id = n.attrs.id as number;
      if (!out.has(id)) out.set(id, n.attrs.kind === "end" ? roman(++end) : String(++foot));
      return false;
    });
  });
  return out;
}

