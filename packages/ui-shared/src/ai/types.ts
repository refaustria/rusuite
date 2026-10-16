// The AI assistant (P8-37, docs/ai-plan.md, ADR 0009): the user's own provider account and API key, requests made
// straight from this page / webview to the provider the user configured, only when the user runs an AI action.
// No Rusuite server, no telemetry, nothing in the background.

/** The provider kinds: Anthropic's Messages API and any OpenAI-compatible `/v1/chat/completions` endpoint. */
export type AiProviderKind = "anthropic" | "openai";

export interface ModelInfo {
  id: string;
  /** Display name (the id when unknown). */
  name: string;
}

/** A JSON schema (the subset the actions use: objects, arrays, strings, numbers, booleans, enums). */
export type JsonSchema = Record<string, unknown>;

/** A structured result: the model is asked to call this tool (Anthropic) / to answer with this JSON schema (OpenAI). */
export interface AiTool {
  name: string;
  description: string;
  schema: JsonSchema;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /** Sent only where the model accepts it (Claude 4.7+ and 5.x models reject sampling parameters). */
  temperature?: number;
  /** At most one tool: the action's structured result. */
  tools?: AiTool[];
  stream: true;
  signal?: AbortSignal;
}

/** One piece of a streamed answer. */
export type Delta =
  | { type: "text"; text: string }
  /** A complete tool call (input parsed from the streamed JSON). */
  | { type: "toolUse"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  /** `end_turn`, `max_tokens`, `tool_use`, `refusal`, `stop` (OpenAI), … */
  | { type: "stop"; reason: string }
  /** The model that answered (a server-side fallback may name another one). */
  | { type: "model"; model: string };

export type AiErrorKind =
  | "auth"
  | "rateLimit"
  | "overloaded"
  | "network"
  | "cors"
  | "csp"
  | "server"
  | "invalid"
  | "notFound"
  | "aborted"
  | "refusal"
  | "badResponse"
  | "truncated"
  | "noResult"
  | "off"
  | "busy"
  | "noKey";

/** A failure with a message for the user (never containing the API key). */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Seconds to wait (429 `retry-after`). */
    readonly retryAfter: number | null = null,
    /** The provider's own message, or the origin for `csp` / `cors` (shown after the localized text). */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiProvider {
  readonly kind: AiProviderKind;
  /** "Anthropic", "OpenAI-compatible (localhost:11434)". */
  readonly name: string;
  /** The origin requests go to (`https://api.anthropic.com`). */
  readonly origin: string;
  /** Known models (offered in the pickers; a free-text id is always possible). */
  models(): ModelInfo[];
  /** Settings › Test: the provider's model list (or a 1-token request). */
  test(model: string): Promise<ModelInfo[]>;
  complete(req: AiRequest): AsyncIterable<Delta>;
}
