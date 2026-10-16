import { useSyncExternalStore } from "react";
import type { ReportController, ReportState } from "../controller";

/** Subscribes a component to a slice of the report state. */
export function useReport<T>(c: ReportController, select: (s: ReportState) => T): T {
  return useSyncExternalStore(c.subscribe, () => select(c.getState()));
}

/** A speech bubble with "!" (Help › Report a problem…). */
export function ReportIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h14v9H9l-4 3v-3H3z" />
      <path d="M10 6.8v3.4M10 12v.2" />
    </svg>
  );
}
