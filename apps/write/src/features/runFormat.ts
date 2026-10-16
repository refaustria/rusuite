// Character formatting from the Font dialog (Ctrl+D) and Home › Font ›
// Text Effects: a run-property patch applied to the selection's marks
// (the mapper sends `SetRunProps`), in the main editor or in the text box
// that has the caret.

import type { Editor } from "@tiptap/core";
import { propsFromMarks, linkFromMarks, styleFromMarks } from "../sync/fromPM";
import { RUN_TOGGLES, type RunProperties } from "../sync/model";
import { marksFromProps } from "../sync/toPM";
import { innerEditors } from "./drawings/innerEditors";

/** A patch of run properties: a value sets, `null` removes (a toggle's `false` removes it too). */
export type RunPatch = { [K in keyof RunProperties]?: RunProperties[K] | null };

/** `props` with `patch` applied (see `RunPatch`). */
export function patchRun(props: RunProperties, patch: RunPatch): RunProperties {
  const out: Record<string, unknown> = { ...props };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || (v === false && (RUN_TOGGLES as readonly string[]).includes(k))) delete out[k];
    else out[k] = v;
  }
  // Superscript / subscript and baseline are one property.
  return out as RunProperties;
}

/** The editor run formatting goes to: the text box with the caret, else the main editor. */
export function formatTarget(editor: Editor): Editor {
  return innerEditors.active() ?? editor;
}

/** Applies `patch` to the selected text (or the stored marks at a caret). */
export function applyRunPatch(editor: Editor, patch: RunPatch): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const schema = state.schema;
  const tr = state.tr;
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const props = patchRun(propsFromMarks(marks), patch);
    tr.setStoredMarks(marksFromProps(schema, props, styleFromMarks(marks), linkFromMarks(marks)));
    editor.view.dispatch(tr);
    return true;
  }
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const props = patchRun(propsFromMarks(node.marks), patch);
    const marks = marksFromProps(schema, props, styleFromMarks(node.marks), linkFromMarks(node.marks));
    for (const m of node.marks) tr.removeMark(start, end, m.type);
    for (const m of marks) tr.addMark(start, end, m);
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** The fields of `next` that differ from `prev` (removed toggles as `false`, removed values as `null`). */
export function runPatchBetween(prev: RunProperties, next: RunProperties): RunPatch {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const a = (prev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    out[k] = b === undefined ? ((RUN_TOGGLES as readonly string[]).includes(k) ? false : null) : b;
  }
  return out as RunPatch;
}

/** Home › Font › Text Effects presets. */
export const TEXT_EFFECTS = ["outline", "shadow", "emboss", "imprint"] as const;
export type TextEffect = (typeof TEXT_EFFECTS)[number];

/** Toggles a text effect (the others of emboss / engrave are exclusive, as in Word's Font dialog). */
export function toggleEffect(editor: Editor, fx: TextEffect, current: RunProperties): boolean {
  const on = !current[fx];
  const patch: RunPatch = { [fx]: on };
  if (on && fx === "emboss") patch.imprint = false;
  if (on && fx === "imprint") patch.emboss = false;
  return applyRunPatch(editor, patch);
}

/** Removes every text effect. */
export function clearEffects(editor: Editor): boolean {
  return applyRunPatch(editor, { outline: false, shadow: false, emboss: false, imprint: false });
}
