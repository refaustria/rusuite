// Catalog access for the parameterised i18n spec (P9-LR1): the expected labels come from the same
// `locales/<lang>.json` files the apps load, and the formal-form rule from scripts/i18n-check.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DIRS = ["packages/ui-shared/src/i18n/locales", "apps/calc/src/locales", "apps/write/src/locales", "apps/show/src/locales", "apps/portal/locales"];

const cache = new Map<string, Record<string, string>>();

/** All messages of a language (shared, app and portal catalogs merged); English for keys still pending. */
export function catalog(lang: string): Record<string, string> {
  let c = cache.get(lang);
  if (!c) {
    c = {};
    for (const dir of DIRS) {
      const read = (l: string) => {
        const file = path.join(repo, dir, `${l}.json`);
        return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>) : {};
      };
      Object.assign(c, read("en"), read(lang));
    }
    cache.set(lang, c);
  }
  return c;
}

/** A message of the language; fails loudly on an unknown key. */
export function msg(lang: string, key: string): string {
  const v = catalog(lang)[key];
  if (v === undefined) throw new Error(`no message ${key}`);
  return v;
}

/** The formal-address rule of `pnpm i18n:check` for the language (`REGISTER` in scripts/i18n-check.mjs). */
export async function formalForms(lang: string): Promise<RegExp | null> {
  const url = pathToFileURL(path.join(repo, "scripts/i18n-check.mjs")).href;
  const { REGISTER } = (await import(url)) as { REGISTER: Record<string, { re: RegExp } | null | undefined> };
  return REGISTER[lang]?.re ?? null;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ribbon labels that do not fit: every text element of the ribbon panel that clips its content (overflow hidden,
 * ellipsis or line clamp; gallery items excluded) while its text is wider or taller than its box, plus a group bar that still overflows after
 * the groups collapsed. Returns the clipped texts (empty = all labels fit).
 */
export function clippedRibbonLabels(page: Page): Promise<string[]> {
  return page.getByTestId("ribbon-panel").evaluate((panel) => {
    const out: string[] = [];
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>("*"))) {
      const text = el.textContent?.trim();
      // Gallery items (style sets, quick styles) are previews: like Office they crop and show the full name as a tooltip.
      if (!text || el.children.length > 0 || el.getClientRects().length === 0 || el.closest("[data-gallery-item]")) continue;
      const cs = getComputedStyle(el);
      const clamp = cs.getPropertyValue("-webkit-line-clamp");
      const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.textOverflow === "ellipsis" || (clamp !== "" && clamp !== "none");
      if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(text);
    }
    for (const bar of Array.from(panel.querySelectorAll<HTMLElement>('[role="toolbar"]'))) {
      if (bar.scrollWidth > bar.clientWidth + 1) out.push(`(${bar.getAttribute("aria-label")}: groups overflow by ${bar.scrollWidth - bar.clientWidth} px)`);
    }
    return out;
  });
}

/**
 * Compact layout (P10-LF): texts that clip in the top bar, the command bar (chips and the strip of the current tab)
 * and, if given, an open bottom sheet – the rule of `clippedRibbonLabels` (and of compact.spec.ts) – plus labels whose
 * text sticks out of their button (the bars wrap labels instead of clipping them). The document title's ellipsis is by
 * design; gallery items crop like Office's previews.
 */
export function clippedCompactLabels(page: Page, sheetTestId?: string): Promise<string[]> {
  return page.evaluate((sheet) => {
    const out: string[] = [];
    const roots = ['[data-testid="command-bar"]', '[data-testid="compact-topbar"]'];
    if (sheet) roots.push(`[data-testid="${sheet}"]`);
    for (const root of Array.from(document.querySelectorAll<HTMLElement>(roots.join(", ")))) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const text = el.textContent?.trim();
        if (!text || el.children.length > 0 || el.getClientRects().length === 0) continue;
        if (el.closest('[data-gallery-item], [data-testid="compact-title"], [data-compact-strip] [data-testid]')) continue;
        if (el.matches("[data-compact-strip], [role=tablist]")) continue;
        const cs = getComputedStyle(el);
        const clamp = cs.getPropertyValue("-webkit-line-clamp");
        const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.textOverflow === "ellipsis" || (clamp !== "" && clamp !== "none");
        if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
          out.push(text);
          continue;
        }
        // The bars' labels do not clip but wrap (overflow visible): a label is too long when its text sticks out of
        // its button (an unbreakable word wider than the 44 px+ target, or more lines than the button is high).
        const button = el.closest("button, [role=menuitem], [role=tab]");
        if (!button || !root.contains(button)) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        if (r.width > 0 && (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1)) {
          out.push(`${text} (sticks out of its button by ${Math.round(Math.max(b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom))} px)`);
        }
      }
    }
    return out;
  }, sheetTestId);
}
