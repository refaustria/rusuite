// Insert › Symbol: the common symbols of the gallery, the More Symbols
// dialog's subsets (Unicode blocks), names for the search, character codes,
// the recently used row (this browser only) and Word's Special Characters.

/** A subset of the More Symbols dialog: a Unicode range (or list). */
export interface SymbolSubset {
  id: string;
  /** i18n key of the subset's name. */
  label: string;
  chars: string[];
}

const range = (from: number, to: number, skip: number[] = []): string[] => {
  const out: string[] = [];
  for (let c = from; c <= to; c++) if (!skip.includes(c)) out.push(String.fromCodePoint(c));
  return out;
};

/** The subsets (Word's "Subset" dropdown, the blocks a document most often needs). */
export const SYMBOL_SUBSETS: SymbolSubset[] = [
  { id: "basicLatin", label: "write.symbol.subset.basicLatin", chars: range(0x21, 0x7e) },
  { id: "latin1", label: "write.symbol.subset.latin1", chars: range(0xa1, 0xff, [0xad]) },
  { id: "greek", label: "write.symbol.subset.greek", chars: [...range(0x391, 0x3a9, [0x3a2]), ...range(0x3b1, 0x3c9)] },
  { id: "currency", label: "write.symbol.subset.currency", chars: ["$", "¢", "£", "¤", "¥", "ƒ", ...range(0x20a0, 0x20bf)] },
  { id: "arrows", label: "write.symbol.subset.arrows", chars: range(0x2190, 0x21ff) },
  { id: "math", label: "write.symbol.subset.math", chars: range(0x2200, 0x22ff) },
  { id: "box", label: "write.symbol.subset.box", chars: range(0x2500, 0x257f) },
  { id: "geometric", label: "write.symbol.subset.geometric", chars: range(0x25a0, 0x25ff) },
  {
    id: "dingbats",
    label: "write.symbol.subset.dingbats",
    chars: [...range(0x2600, 0x2653), ...range(0x2701, 0x27bf), ...range(0x1f600, 0x1f64f), ...["❤", "👍", "👎", "👏", "🔥", "✨", "⭐", "✅", "❌"]],
  },
];

/** The gallery of Insert › Symbol (Word's default set before anything was used). */
export const COMMON_SYMBOLS = ["€", "£", "¥", "©", "®", "™", "±", "≠", "≤", "≥", "÷", "×", "∞", "µ", "α", "β", "π", "Ω", "∑", "☺"];

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
  "final sigma", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];

/** Names of the characters people search for (Unicode names, lower case). */
const NAMES: Record<string, string> = {
  "!": "exclamation mark", '"': "quotation mark", "#": "number sign", $: "dollar sign", "%": "percent sign", "&": "ampersand", "'": "apostrophe",
  "(": "left parenthesis", ")": "right parenthesis", "*": "asterisk", "+": "plus sign", ",": "comma", "-": "hyphen-minus", ".": "full stop",
  "/": "solidus slash", ":": "colon", ";": "semicolon", "<": "less-than sign", "=": "equals sign", ">": "greater-than sign", "?": "question mark",
  "@": "commercial at", "[": "left square bracket", "\\": "reverse solidus backslash", "]": "right square bracket", "^": "circumflex accent",
  _: "low line underscore", "`": "grave accent", "{": "left curly bracket", "|": "vertical line", "}": "right curly bracket", "~": "tilde",
  "¡": "inverted exclamation mark", "¢": "cent sign", "£": "pound sign", "¤": "currency sign", "¥": "yen sign", "¦": "broken bar",
  "§": "section sign", "¨": "diaeresis", "©": "copyright sign", ª: "feminine ordinal indicator", "«": "left-pointing double angle quotation mark",
  "¬": "not sign", "®": "registered sign", "¯": "macron", "°": "degree sign", "±": "plus-minus sign", "²": "superscript two",
  "³": "superscript three", "´": "acute accent", µ: "micro sign", "¶": "pilcrow sign paragraph", "·": "middle dot", "¸": "cedilla",
  "¹": "superscript one", º: "masculine ordinal indicator", "»": "right-pointing double angle quotation mark", "¼": "vulgar fraction one quarter",
  "½": "vulgar fraction one half", "¾": "vulgar fraction three quarters", "¿": "inverted question mark", "×": "multiplication sign",
  "÷": "division sign", Ä: "latin capital letter a with diaeresis umlaut", Ö: "latin capital letter o with diaeresis umlaut",
  Ü: "latin capital letter u with diaeresis umlaut", ä: "latin small letter a with diaeresis umlaut", ö: "latin small letter o with diaeresis umlaut",
  ü: "latin small letter u with diaeresis umlaut", ß: "latin small letter sharp s eszett", Æ: "latin capital letter ae", æ: "latin small letter ae",
  Ø: "latin capital letter o with stroke", ø: "latin small letter o with stroke", Å: "latin capital letter a with ring above",
  å: "latin small letter a with ring above", Ç: "latin capital letter c with cedilla", ç: "latin small letter c with cedilla",
  É: "latin capital letter e with acute", é: "latin small letter e with acute", È: "latin capital letter e with grave", è: "latin small letter e with grave",
  Ñ: "latin capital letter n with tilde", ñ: "latin small letter n with tilde",
  "€": "euro sign", "₹": "indian rupee sign", "₽": "ruble sign", "₩": "won sign", "₪": "new sheqel sign", "₫": "dong sign", "₺": "turkish lira sign",
  "₿": "bitcoin sign", "₱": "peso sign", "₴": "hryvnia sign", "₦": "naira sign", ƒ: "latin small letter f with hook florin",
  "←": "leftwards arrow", "↑": "upwards arrow", "→": "rightwards arrow", "↓": "downwards arrow", "↔": "left right arrow", "↕": "up down arrow",
  "⇐": "leftwards double arrow", "⇒": "rightwards double arrow implies", "⇔": "left right double arrow if and only if", "↵": "downwards arrow with corner leftwards return",
  "∀": "for all", "∂": "partial differential", "∃": "there exists", "∅": "empty set", "∇": "nabla", "∈": "element of", "∉": "not an element of",
  "∏": "n-ary product", "∑": "n-ary summation sum", "−": "minus sign", "∓": "minus-or-plus sign", "√": "square root", "∛": "cube root",
  "∝": "proportional to", "∞": "infinity", "∠": "angle", "∧": "logical and", "∨": "logical or", "∩": "intersection", "∪": "union",
  "∫": "integral", "∴": "therefore", "∵": "because", "∼": "tilde operator", "≈": "almost equal to approximately", "≠": "not equal to",
  "≡": "identical to", "≤": "less-than or equal to", "≥": "greater-than or equal to", "⊂": "subset of", "⊃": "superset of", "⊆": "subset of or equal to",
  "⊇": "superset of or equal to", "⊕": "circled plus", "⊗": "circled times", "⊥": "up tack perpendicular", "⋅": "dot operator",
  "■": "black square", "□": "white square", "▲": "black up-pointing triangle", "△": "white up-pointing triangle", "▶": "black right-pointing triangle",
  "▼": "black down-pointing triangle", "◆": "black diamond", "◇": "white diamond", "○": "white circle", "●": "black circle", "◎": "bullseye",
  "★": "black star", "☆": "white star", "☎": "black telephone", "☐": "ballot box", "☑": "ballot box with check", "☒": "ballot box with x",
  "☺": "white smiling face", "☹": "white frowning face", "☀": "black sun with rays", "☁": "cloud", "☂": "umbrella", "☕": "hot beverage coffee",
  "♠": "black spade suit", "♣": "black club suit", "♥": "black heart suit", "♦": "black diamond suit", "♪": "eighth note music", "♫": "beamed eighth notes",
  "✓": "check mark tick", "✔": "heavy check mark tick", "✗": "ballot x", "✘": "heavy ballot x", "✉": "envelope", "✎": "lower right pencil",
  "✂": "black scissors", "❤": "heavy black heart", "✨": "sparkles", "⭐": "white medium star", "✅": "white heavy check mark", "❌": "cross mark",
  "😀": "grinning face", "😁": "beaming face with smiling eyes", "😂": "face with tears of joy", "😃": "grinning face with big eyes", "😉": "winking face",
  "😊": "smiling face with smiling eyes", "😍": "smiling face with heart-eyes", "😎": "smiling face with sunglasses", "😢": "crying face",
  "😮": "face with open mouth", "🙂": "slightly smiling face", "🙁": "slightly frowning face", "👍": "thumbs up", "👎": "thumbs down",
  "👏": "clapping hands", "🔥": "fire",
  "—": "em dash", "–": "en dash", "…": "horizontal ellipsis", "‘": "left single quotation mark", "’": "right single quotation mark",
  "“": "left double quotation mark", "”": "right double quotation mark", "„": "double low-9 quotation mark", "‚": "single low-9 quotation mark",
  "•": "bullet", "†": "dagger", "‡": "double dagger", "‰": "per mille sign", "™": "trade mark sign", "‹": "single left-pointing angle quotation mark",
  "›": "single right-pointing angle quotation mark", " ": "no-break space", "‑": "non-breaking hyphen", "­": "soft hyphen",
  " ": "en space", " ": "em space", " ": "four-per-em space",
};

/** The name of character `ch` (Unicode, lower case; a generic one for unnamed characters of a known block). */
export function symbolName(ch: string): string {
  const named = NAMES[ch];
  if (named) return named;
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x391 && cp <= 0x3a9) return `greek capital letter ${GREEK[cp - 0x391] ?? ""}`.trim();
  if (cp >= 0x3b1 && cp <= 0x3c9) return `greek small letter ${GREEK[cp - 0x3b1] ?? ""}`.trim();
  if (cp >= 0x41 && cp <= 0x5a) return `latin capital letter ${ch.toLowerCase()}`;
  if (cp >= 0x61 && cp <= 0x7a) return `latin small letter ${ch}`;
  if (cp >= 0x30 && cp <= 0x39) return `digit ${["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][cp - 0x30]}`;
  if (cp >= 0xc0 && cp <= 0xff) return `latin letter ${ch}`;
  if (cp >= 0x2500 && cp <= 0x257f) return "box drawings";
  if (cp >= 0x2190 && cp <= 0x21ff) return "arrow";
  if (cp >= 0x2200 && cp <= 0x22ff) return "mathematical operator";
  if (cp >= 0x25a0 && cp <= 0x25ff) return "geometric shape";
  return "";
}

/** The character code as Word shows it (`20AC`, four hex digits at least). */
export const charCode = (ch: string): string => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

/** The character of a typed code (`20AC`, `U+20AC`, `0x20ac`), or null. */
export function fromCharCode(text: string): string | null {
  const m = /^(?:u\+|0x)?([0-9a-f]{1,6})$/i.exec(text.trim());
  if (!m) return null;
  const cp = parseInt(m[1]!, 16);
  if (cp < 0x20 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return String.fromCodePoint(cp);
}

/** The subset holding `ch` (null when none). */
export const subsetOf = (ch: string): SymbolSubset | null => SYMBOL_SUBSETS.find((s) => s.chars.includes(ch)) ?? null;

/** Search by name (every word must match) or by code; at most `limit` characters from all subsets. */
export function searchSymbols(query: string, limit = 200): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const code = fromCharCode(q);
  const words = q.split(/\s+/);
  const out: string[] = code ? [code] : [];
  const seen = new Set(out);
  for (const s of SYMBOL_SUBSETS) {
    for (const ch of s.chars) {
      if (out.length >= limit) return out;
      if (seen.has(ch)) continue;
      const name = symbolName(ch);
      if (name && words.every((w) => name.includes(w))) {
        out.push(ch);
        seen.add(ch);
      }
    }
  }
  return out;
}

/** Word's Special Characters tab: character, i18n key of its name, Word's shortcut. */
export const SPECIAL_CHARACTERS: { ch: string; label: string; shortcut?: string }[] = [
  { ch: "—", label: "write.special.emDash", shortcut: "Alt+Ctrl+Num -" },
  { ch: "–", label: "write.special.enDash", shortcut: "Ctrl+Num -" },
  { ch: "‑", label: "write.special.nbHyphen", shortcut: "Ctrl+Shift+_" },
  { ch: "­", label: "write.special.softHyphen", shortcut: "Ctrl+-" },
  { ch: " ", label: "write.special.emSpace" },
  { ch: " ", label: "write.special.enSpace" },
  { ch: " ", label: "write.special.quarterSpace" },
  { ch: " ", label: "write.special.nbSpace", shortcut: "Ctrl+Shift+Space" },
  { ch: "©", label: "write.special.copyright", shortcut: "Alt+Ctrl+C" },
  { ch: "®", label: "write.special.registered", shortcut: "Alt+Ctrl+R" },
  { ch: "™", label: "write.special.trademark", shortcut: "Alt+Ctrl+T" },
  { ch: "§", label: "write.special.section" },
  { ch: "¶", label: "write.special.paragraph" },
  { ch: "…", label: "write.special.ellipsis", shortcut: "Alt+Ctrl+." },
  { ch: "‘", label: "write.special.singleOpen" },
  { ch: "’", label: "write.special.singleClose" },
  { ch: "“", label: "write.special.doubleOpen" },
  { ch: "”", label: "write.special.doubleClose" },
];

/** What a special character looks like in the list (spaces and hyphens are invisible otherwise). */
export function specialGlyph(ch: string): string {
  if (ch === " " || ch === " " || ch === " " || ch === " ") return "°";
  if (ch === "­") return "¬";
  if (ch === "‑") return "‑";
  return ch;
}

const RECENT_KEY = "rusuite.write.recentSymbols";
const RECENT_MAX = 20;

/** The recently used symbols (this browser only; Word's gallery shows them first). */
export function recentSymbols(storage: Pick<Storage, "getItem"> | null = safeStorage()): string[] {
  try {
    const v = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts `ch` first in the recently used list. */
export function rememberSymbol(ch: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): string[] {
  const list = [ch, ...recentSymbols(storage).filter((x) => x !== ch)].slice(0, RECENT_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private mode: nothing remembered
  }
  return list;
}

/** The gallery: the recently used symbols, then the common ones (20 in all). */
export function gallerySymbols(recent: string[]): string[] {
  const out = [...recent];
  for (const c of COMMON_SYMBOLS) if (!out.includes(c)) out.push(c);
  return out.slice(0, 20);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
