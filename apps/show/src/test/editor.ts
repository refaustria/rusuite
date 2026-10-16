// Driving the in-place text editor in jsdom (no typing there): `beforeinput`
// events as a browser sends them, the selection set through the DOM.

import { act } from "@testing-library/react";
import { writeSelection } from "../canvas/richEditor";

/** Sends a `beforeinput` of `inputType` (with `data`) to the editor. */
export function input(el: HTMLElement, inputType: string, data: string | null = null): void {
  act(() => {
    el.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
  });
}

/** Types `text` at the editor's selection (`\n` = Enter). */
export function typeText(el: HTMLElement, text: string): void {
  for (const part of text.split(/(\n)/)) {
    if (part === "\n") input(el, "insertParagraph");
    else if (part) input(el, "insertText", part);
  }
}

/** Selects `start`…`end` of the editor's text (and tells the editor). */
export function select(el: HTMLElement, start: number, end = start): void {
  act(() => {
    writeSelection(el, start, end);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** Replaces the whole text of the editor by `text`. */
export function replaceAll(el: HTMLElement, text: string): void {
  select(el, 0, (el.textContent ?? "").length + Math.max(0, el.children.length - 1));
  if (text) typeText(el, text);
  else input(el, "deleteContentBackward");
}
