// Constant option lists (paper sizes, number formats, …) whose labels
// follow the UI language: the `label` is a getter reading the catalog at
// render time.

import type { Messages, Params } from "./core";
import { t } from "./locale";

/** `base` plus a `label` translated (`key`, `params`) whenever it is read. */
export function withLabel<T extends object>(base: T, key: string, params?: Params): T & { readonly label: string } {
  return Object.defineProperty({ ...base }, "label", { get: () => t(key, params), enumerable: true }) as T & { readonly label: string };
}

/** Keys of `en` missing in `other`, and keys of `other` that `en` lacks (catalog parity tests). */
export function compareCatalogs(en: Messages, other: Messages): { missing: string[]; extra: string[] } {
  return {
    missing: Object.keys(en).filter((k) => !(k in other)),
    extra: Object.keys(other).filter((k) => !(k in en)),
  };
}
