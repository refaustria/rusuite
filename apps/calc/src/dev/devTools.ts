// Dev-only helpers: the `?fake=1` backend switch and `window.__calc`
// (bulk fill for the scroll-performance check).

import type { CalcBackend } from "../backend/calcApi";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcStore } from "../state/store";
import { FakeBackend } from "./fakeBackend";

function query(): URLSearchParams {
  return new URLSearchParams(typeof location === "undefined" ? "" : location.search);
}

/** In dev builds, `?fake=1` swaps in the in-memory fake backend. */
export function pickBackend(backend: CalcBackend): CalcBackend {
  return import.meta.env.DEV && query().has("fake") ? new FakeBackend() : backend;
}

export function perfOverlayEnabled(): boolean {
  return import.meta.env.DEV && query().has("perf");
}

/**
 * Fills `rows × cols` cells of the active sheet with numbers and text,
 * one `compound` of `setInput`s per row. Resolves to the elapsed ms.
 */
export async function fill(store: CalcStore, rows: number, cols: number): Promise<number> {
  const t0 = performance.now();
  const sheet = store.getState().activeSheet;
  for (let row = 0; row < rows; row++) {
    const commands: CalcCommand[] = [];
    for (let col = 0; col < cols; col++) {
      const input = col % 5 === 4 ? `item ${row}-${col}` : String(row * cols + col);
      commands.push({ type: "setInput", sheet, row, col, input });
    }
    await store.apply({ type: "compound", commands });
  }
  return performance.now() - t0;
}

export function installDevTools(store: CalcStore): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window as unknown as { __calc: unknown }).__calc = {
    store,
    fill: (rows: number, cols: number) => fill(store, rows, cols),
  };
}
