import type { AiProvider, AiProviderKind } from "../types";
import type { AiSettings } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatibleProvider } from "./openai";
import type { FetchLike } from "./http";

export type ProviderFactory = (kind: AiProviderKind, key: string, baseUrl: string) => AiProvider;

/** The real providers (`fetch` from this page / webview). */
export function createProvider(kind: AiProviderKind, key: string, baseUrl: string, fetchImpl?: FetchLike): AiProvider {
  return kind === "anthropic" ? new AnthropicProvider(key, baseUrl, fetchImpl) : new OpenAiCompatibleProvider(key, baseUrl, fetchImpl);
}

/** The display name of the configured provider ("Anthropic", "OpenAI", "localhost:11434"). */
export function providerName(settings: AiSettings): string {
  try {
    return createProvider(settings.provider, "", settings.baseUrls[settings.provider]).name;
  } catch {
    return settings.provider === "anthropic" ? "Anthropic" : "OpenAI-compatible";
  }
}

/** The origin the configured provider is contacted at. */
export function providerOrigin(settings: AiSettings): string {
  try {
    return createProvider(settings.provider, "", settings.baseUrls[settings.provider]).origin;
  } catch {
    return settings.baseUrls[settings.provider];
  }
}

export { AnthropicProvider, ANTHROPIC_MODELS, ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_MODEL, acceptsTemperature, anthropicBody, anthropicContent, anthropicDeltas, anthropicSystem, reasoningParams, supportsEffort, usageDelta } from "./anthropic";
export { OpenAiCompatibleProvider, OPENAI_MODELS, OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL, normalizeOpenAiBase, openAiBody, openAiContent, openAiDeltas, openAiSystem } from "./openai";
export { sseEvents, retryAfterSeconds, noteAiCspViolation, type FetchLike } from "./http";
