// Key names in shortcut texts per UI language (P9-L0), as the Office of
// that language prints them in tooltips and help: German "Strg+Umschalt+S",
// French "Ctrl+Maj+S", Spanish "Ctrl+Mayús+S". A language or key missing
// here keeps the English name (most Office localisations keep "Ctrl",
// "Shift", "Alt"); translation tasks extend the table from the glossary
// (docs/i18n-glossary/<lang>.md). The combo specs themselves never change.

import type { Locale } from "./locales";

/** The keys whose names are localised (canonical lower-case names of combo specs). */
export type NamedKey =
  | "ctrl" | "shift" | "alt" | "delete" | "enter" | "esc" | "tab" | "space"
  | "backspace" | "insert" | "home" | "end" | "pageup" | "pagedown";

/** Spellings of the named keys in combo specs (`Del`, `Return`, `PgUp` …). */
const SPELLINGS: Record<string, NamedKey> = {
  ctrl: "ctrl", control: "ctrl", shift: "shift", alt: "alt", del: "delete", delete: "delete", enter: "enter", return: "enter",
  esc: "esc", escape: "esc", tab: "tab", space: "space", backspace: "backspace", ins: "insert", insert: "insert",
  home: "home", end: "end", pageup: "pageup", pgup: "pageup", pagedown: "pagedown", pgdn: "pagedown",
};

/** Localised key names; a key not listed keeps its English name. */
export const KEY_NAMES: Partial<Record<Locale, Partial<Record<NamedKey, string>>>> = {
  de: {
    ctrl: "Strg", shift: "Umschalt", delete: "Entf", enter: "Eingabe", space: "Leertaste", backspace: "Rücktaste",
    insert: "Einfg", home: "Pos1", end: "Ende", pageup: "Bild-auf", pagedown: "Bild-ab",
  },
  fr: {
    shift: "Maj", delete: "Suppr", enter: "Entrée", esc: "Échap", space: "Espace", backspace: "Retour arrière",
    insert: "Inser", home: "Origine", end: "Fin", pageup: "Pg.Préc", pagedown: "Pg.Suiv",
  },
  es: {
    shift: "Mayús", delete: "Supr", enter: "Entrar", space: "Barra espaciadora", backspace: "Retroceso",
    home: "Inicio", end: "Fin", pageup: "Re Pág", pagedown: "Av Pág",
  },
  it: { shift: "Maiusc", delete: "Canc", enter: "Invio", space: "Barra spaziatrice", insert: "Ins", end: "Fine", pageup: "PagSu", pagedown: "PagGiù" },
  sv: { shift: "Skift" },
  da: { shift: "Skift" },
  fi: { shift: "Vaihto" },
};

/** The canonical name of a combo part (`Del` → `delete`), or null for other keys. */
export function namedKey(part: string): NamedKey | null {
  return SPELLINGS[part.toLowerCase()] ?? null;
}

/** The name of `key` in `locale`'s Office, or null when it keeps the English name. */
export function keyName(locale: Locale, key: NamedKey): string | null {
  return KEY_NAMES[locale]?.[key] ?? null;
}
