// Table Design › Border Painter: while it is on, a click on a cell edge
// paints that edge with the pen (Border Styles / Line Style / Line Weight /
// Pen Color) and the facing edge of the neighbouring cell (`SetCellProps`).
// Esc or the button turns it off (Word).

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { BorderSide } from "../generated/BorderSide";
import type { WriteCommand } from "../generated/WriteCommand";
import { edgeAt, paintEdgeCommands } from "./tables2";

export const borderPainterKey = new PluginKey("rusuiteBorderPainter");

/** The commands for a click at (`x`, `y`) on cell element `td` of the editor, or null when it is not on an edge. */
export function paintAt(view: EditorView, td: HTMLElement, x: number, y: number, pen: BorderSide): WriteCommand[] | null {
  const edge = edgeAt(td.getBoundingClientRect(), x, y, 8);
  if (!edge) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(td, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name !== "tableCell") continue;
    const table = $pos.node(d - 2);
    if (table?.type.name !== "table") return null;
    const map = TableMap.get(table);
    const rect = map.findCell($pos.before(d) - $pos.start(d - 2));
    return paintEdgeCommands(table, rect, edge, pen);
  }
  return null;
}

/** The plugin; `state()` tells whether the painter is on and with which pen. */
export function borderPainterPlugin(state: () => { on: boolean; pen: BorderSide }, run: (cmds: WriteCommand[]) => void): Plugin {
  return new Plugin({
    key: borderPainterKey,
    props: {
      attributes: (): Record<string, string> => (state().on ? { "data-border-painter": "" } : {}),
      handleDOMEvents: {
        mousedown(view, e) {
          const s = state();
          if (!s.on || e.button !== 0) return false;
          const td = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLElement | null;
          if (!td || !view.dom.contains(td)) return false;
          const cmds = paintAt(view, td, e.clientX, e.clientY, s.pen);
          if (!cmds?.length) return false;
          e.preventDefault();
          // Keep the keyboard in the editor (Esc ends the painter).
          view.focus();
          run(cmds);
          return true;
        },
      },
    },
  });
}
