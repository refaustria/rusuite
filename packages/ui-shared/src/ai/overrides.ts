// Per-action model and reasoning overrides (Settings › AI › Actions) and what a request finally uses.

import type { AiSettings } from "./settings";
import { supportsEffort } from "./providers/anthropic";
import { AI_EFFORTS, type AiEffort } from "./types";

/** The effort of a request: the setting, raised to the action's minimum – unless the setting is "off". */
export function effectiveEffort(setting: AiEffort, action?: AiEffort): AiEffort {
  if (setting === "off" || !action) return setting;
  return AI_EFFORTS.indexOf(action) > AI_EFFORTS.indexOf(setting) ? action : setting;
}

/** Whether the model takes a reasoning effort: Claude models with adaptive thinking; OpenAI-compatible ones the user marked. */
export function modelTakesEffort(settings: Pick<AiSettings, "provider" | "reasoningModels">, model: string): boolean {
  return settings.provider === "anthropic" ? supportsEffort(model) : settings.reasoningModels.includes(model);
}

export interface ResolvedAction {
  /** The model for this action: its own pin, else the general model. */
  model: string;
  /** Whether `model` is pinned by the action (not the general one). */
  pinned: boolean;
  /** The reasoning level before the action's minimum is applied (its own pin, else the general setting). */
  setting: AiEffort;
  /** The effort to send, or `undefined` where the model takes none. */
  effort: AiEffort | undefined;
}

/** Resolves the model and reasoning of `actionId` (`minEffort`: `AiAction.effort`). */
export function resolveAction(settings: AiSettings, actionId: string, minEffort?: AiEffort): ResolvedAction {
  const o = settings.actionOverrides[settings.provider][actionId];
  const pinnedModel = o?.model?.trim();
  const model = pinnedModel || settings.models[settings.provider];
  const setting = o?.effort ?? settings.effort;
  return { model, pinned: !!pinnedModel, setting, effort: modelTakesEffort(settings, model) ? effectiveEffort(setting, minEffort) : undefined };
}
