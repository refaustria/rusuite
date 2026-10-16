// (.tsx so that Tailwind scans the class names below.)
import { useSyncExternalStore } from "react";
import type { Assistant, AssistantState } from "../controller";
import { providerName } from "../providers";

/** Subscribes a component to a slice of the assistant state. */
export function useAssistant<T>(ai: Assistant, select: (s: AssistantState) => T): T {
  return useSyncExternalStore(ai.subscribe, () => select(ai.getState()));
}

/** The configured provider's display name. */
export function useProviderName(ai: Assistant): string {
  const settings = useAssistant(ai, (s) => s.settings);
  return providerName(settings);
}

export const AI_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded border border-ui-border px-3 text-sm hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40";
export const AI_PRIMARY =
  "inline-flex h-8 items-center gap-1.5 rounded bg-ui-focus px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const AI_INPUT = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
export const AI_CHIP =
  "inline-flex min-h-8 items-center rounded-full border border-ui-border px-3 py-1 text-xs hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-ui-active";
