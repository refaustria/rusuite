import { useEffect, useState } from "react";
import type { PrintDoc } from "../print";

export interface PrintDocState {
  doc: PrintDoc | null;
  busy: boolean;
  error: string | null;
}

/**
 * Builds the print document with `build` (re-run, debounced, whenever its
 * identity changes – wrap it in `useCallback` over the print options);
 * results of superseded builds are dropped.
 */
export function usePrintDoc(build: () => Promise<PrintDoc>, delayMs = 120): PrintDocState {
  const [state, setState] = useState<PrintDocState>({ doc: null, busy: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, busy: true }));
    const timer = setTimeout(() => {
      build().then(
        (doc) => live && setState({ doc, busy: false, error: null }),
        (e: unknown) => live && setState({ doc: null, busy: false, error: e instanceof Error ? e.message : String(e) }),
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [build, delayMs]);
  return state;
}
