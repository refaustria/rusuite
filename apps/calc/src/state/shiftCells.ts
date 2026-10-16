// Excel's Insert / Delete dialogs (Home › Insert ▾ › Insert Cells…, Ctrl++ /
// Ctrl+- on a cell selection): the four choices and the command each one
// sends (P8-44, C-13).

import type { CalcCommand } from "../generated/CalcCommand";
import type { Range } from "../grid/Selection";

export type CellsMode = "insert" | "delete";
/** Insert: right / down; delete: left / up; both: entire rows / columns. */
export type CellsChoice = "right" | "down" | "left" | "up" | "rows" | "cols";

/** The dialog's options in Excel's order. */
export function cellsChoices(mode: CellsMode): CellsChoice[] {
  return mode === "insert" ? ["right", "down", "rows", "cols"] : ["left", "up", "rows", "cols"];
}

/** Excel's preselected option: a selection taller than wide shifts sideways, anything else vertically. */
export function defaultCellsChoice(mode: CellsMode, r: Range): CellsChoice {
  const tall = r.r1 - r.r0 > r.c1 - r.c0;
  if (mode === "insert") return tall ? "right" : "down";
  return tall ? "left" : "up";
}

/** The command for `choice` on the selection `r`. */
export function cellsCommand(mode: CellsMode, choice: CellsChoice, sheet: number, r: Range): CalcCommand {
  const { r0, c0, r1, c1 } = r;
  if (choice === "rows") {
    return { type: mode === "insert" ? "insertRows" : "deleteRows", sheet, at: r0, count: r1 - r0 + 1 };
  }
  if (choice === "cols") {
    return { type: mode === "insert" ? "insertCols" : "deleteCols", sheet, at: c0, count: c1 - c0 + 1 };
  }
  if (mode === "insert") {
    return { type: "insertCells", sheet, r0, c0, r1, c1, shift: choice === "right" || choice === "left" ? "right" : "down" };
  }
  return { type: "deleteCells", sheet, r0, c0, r1, c1, shift: choice === "right" || choice === "left" ? "left" : "up" };
}
