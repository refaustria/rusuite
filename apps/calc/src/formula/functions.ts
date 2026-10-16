// Function list for autocomplete and signature tips. `functions.json` is
// generated from docs/functions.md by scripts/gen-function-list.sh.

import list from "./functions.json";

/** Function library category (the `##` sections of docs/functions.md). */
export type FunctionCategory = "math" | "logical" | "info" | "text" | "lookup" | "datetime" | "statistical" | "financial" | "other";

export interface FunctionInfo {
  name: string;
  signature: string;
  description: string;
  category?: FunctionCategory | string;
  /** An autocomplete entry for a defined name (accepting inserts the name only). */
  kind?: "name";
}

export const FUNCTIONS: FunctionInfo[] = list;

/** The functions of a category, alphabetical. */
export function functionsIn(category: string): FunctionInfo[] {
  return FUNCTIONS.filter((f) => f.category === category);
}

/** Insert Function's search: name prefix first, then name or description containing every word. */
export function searchFunctions(query: string, category: string | null = null): FunctionInfo[] {
  const pool = category && category !== "all" ? functionsIn(category) : FUNCTIONS;
  const q = query.trim().toLowerCase();
  if (q === "") return pool;
  const words = q.split(/\s+/);
  const prefix = pool.filter((f) => f.name.toLowerCase().startsWith(q));
  const rest = pool.filter((f) => !prefix.includes(f) && words.every((w) => f.name.toLowerCase().includes(w) || f.description.toLowerCase().includes(w)));
  return [...prefix, ...rest];
}

const byName = new Map(FUNCTIONS.map((f) => [f.name, f]));

export function functionInfo(name: string): FunctionInfo | undefined {
  return byName.get(name.toUpperCase());
}

/** Functions whose name starts with `prefix` (case-insensitive), alphabetical. */
export function matchFunctions(prefix: string, all: FunctionInfo[] = FUNCTIONS): FunctionInfo[] {
  const p = prefix.toUpperCase();
  return all.filter((f) => f.name.startsWith(p));
}

/** `SUM(number1, [number2], ...)` → its argument names. */
export function signatureArgs(signature: string): string[] {
  const open = signature.indexOf("(");
  const inner = signature.slice(open + 1, signature.lastIndexOf(")")).trim();
  return inner === "" ? [] : inner.split(/\s*,\s*/);
}

/**
 * Index of the argument to highlight for the 0-based argument `arg`; a
 * trailing `...` stands for all further arguments. `-1` when past the end.
 */
export function activeArg(args: string[], arg: number): number {
  if (arg < args.length && args[arg] !== "...") return arg;
  if (args[args.length - 1] === "...") return args.length - 1;
  return -1;
}

/**
 * Accepting a function: the typed name (`span`) becomes `NAME(` and the
 * caret goes inside the parentheses.
 */
export function applyFunction(text: string, span: { start: number; end: number }, name: string): { text: string; caret: number } {
  const hasParen = text[span.end] === "(";
  const insert = hasParen ? name : `${name}(`;
  const next = text.slice(0, span.start) + insert + text.slice(span.end);
  return { text: next, caret: span.start + insert.length + (hasParen ? 1 : 0) };
}
