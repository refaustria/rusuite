// (.tsx so that Tailwind scans the class names below – `@source "./**/*.tsx"`.)
import { useSyncExternalStore } from "react";
import type { Connectors, ConnectorsState } from "../controller";
import { formatDate, formatNumber } from "../../i18n/format";

/** Subscribes a component to a slice of the connections state. */
export function useConnectors<T>(c: Connectors, select: (s: ConnectorsState) => T): T {
  return useSyncExternalStore(c.subscribe, () => select(c.getState()));
}

/** "12 KB", "3.4 MB". */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${formatNumber(v, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

export function formatModified(ms: number | null): string {
  return ms === null ? "" : formatDate(ms, { dateStyle: "medium", timeStyle: "short" });
}

export const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded border border-ui-border px-3 text-sm hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40";
export const PRIMARY =
  "inline-flex h-8 items-center gap-1.5 rounded bg-ui-focus px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const INPUT = "h-8 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm";
