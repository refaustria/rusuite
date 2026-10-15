import { BLOCK_COLS, BLOCK_ROWS, type CalcStore } from "../state/store";

/** Upper bound of cells fetched for printing. */
export const MAX_PRINT_CELLS = 2_000_000;

/**
 * Loads the used range of a sheet into the store's cache and returns its
 * extent. The backend has no used-range query, so snapshot blocks are
 * fetched outward from A1 until the last loaded block row and block column
 * are empty (a gap of a whole empty block ends the scan).
 */
export async function loadUsedRange(store: CalcStore, sheet: number): Promise<{ lastRow: number; lastCol: number }> {
  let rows = BLOCK_ROWS;
  let cols = BLOCK_COLS;
  for (;;) {
    await store.ensureRegion(sheet, 0, 0, rows - 1, cols - 1);
    const { lastRow, lastCol } = store.usedExtent(sheet);
    const growRows = lastRow >= rows - BLOCK_ROWS;
    const growCols = lastCol >= cols - BLOCK_COLS;
    if (growRows) rows += BLOCK_ROWS;
    if (growCols) cols += BLOCK_COLS;
    if ((!growRows && !growCols) || rows * cols > MAX_PRINT_CELLS) return { lastRow, lastCol };
  }
}
