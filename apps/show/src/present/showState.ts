// The slide show as a pure state machine (P7-8): the slide index, a blanked
// screen (B black, W white), the "End of slide show" slide after the last
// one and the slide number being typed (number + Enter jumps). Both the
// single-window show and the presenter view drive it; the audience window
// only renders it.

export type Blank = "none" | "black" | "white";

export interface ShowState {
  index: number;
  count: number;
  blank: Blank;
  /** The black "End of slide show" slide after the last one. */
  ended: boolean;
  /** Digits typed for "number + Enter". */
  typed: string;
}

export type ShowAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "goto"; index: number }
  | { type: "blank"; color: "black" | "white" }
  | { type: "digit"; digit: string }
  | { type: "enter" }
  | { type: "exit" };

export function initialShow(count: number, index = 0): ShowState {
  return { index: clamp(index, count), count, blank: "none", ended: false, typed: "" };
}

function clamp(i: number, count: number): number {
  return Math.max(0, Math.min(i, count - 1));
}

/** The state after `action`; `"exit"` ends the show. */
export function reduceShow(s: ShowState, action: ShowAction): ShowState | "exit" {
  const base = { ...s, typed: "" };
  switch (action.type) {
    case "exit":
      return "exit";
    case "digit":
      return { ...s, typed: (s.typed + action.digit).slice(-4) };
    case "blank":
      return { ...base, blank: s.blank === action.color ? "none" : action.color };
    case "enter":
      if (s.typed) return { ...base, index: clamp(Number(s.typed) - 1, s.count), blank: "none", ended: false };
      return reduceShow(s, { type: "next" });
    case "next":
      // A key on a blanked screen only brings the slide back (PowerPoint).
      if (s.blank !== "none") return { ...base, blank: "none" };
      if (s.ended) return "exit";
      if (s.index >= s.count - 1) return { ...base, ended: true };
      return { ...base, index: s.index + 1 };
    case "prev":
      if (s.blank !== "none") return { ...base, blank: "none" };
      if (s.ended) return { ...base, ended: false };
      return { ...base, index: Math.max(0, s.index - 1) };
    case "first":
      return { ...base, index: 0, blank: "none", ended: false };
    case "last":
      return { ...base, index: Math.max(0, s.count - 1), blank: "none", ended: false };
    case "goto":
      return { ...base, index: clamp(action.index, s.count), blank: "none", ended: false };
  }
}

/** The show action of a key (`null` = not a show key). */
export function keyAction(key: string): ShowAction | null {
  if (/^[0-9]$/.test(key)) return { type: "digit", digit: key };
  switch (key) {
    case "Escape":
      return { type: "exit" };
    case "Enter":
      return { type: "enter" };
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "n":
    case "N":
      return { type: "next" };
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
    case "P":
      return { type: "prev" };
    case "Home":
      return { type: "first" };
    case "End":
      return { type: "last" };
    case "b":
    case "B":
    case ".":
      return { type: "blank", color: "black" };
    case "w":
    case "W":
    case ",":
      return { type: "blank", color: "white" };
    default:
      return null;
  }
}

/** A click or tap at `x` of a `width`-wide screen: right half next, left half previous. */
export function clickAction(x: number, width: number): ShowAction {
  return x < width / 2 ? { type: "prev" } : { type: "next" };
}
