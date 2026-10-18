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

/** A picture sent with a turn (base64, already downscaled; see `images.ts`). */
export interface AiImage {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Base64 without the `data:` prefix. */
  data: string;
  width: number;
  height: number;
  /** What it is, for the panel ("Picture 1", "Slide 3", "Chart 2"). */
  label: string;
}

/** One part of a message: text, or a picture (Anthropic image block / OpenAI `image_url`). */
export type AiContentPart = { type: "text"; text: string } | { type: "image"; image: AiImage };

export interface AiMessage {
  role: "user" | "assistant";
  /** Text, or parts (pictures first, then the text) for a turn with attachments. */
  content: string | AiContentPart[];
}

/** The text of a message (its text parts joined). */
export function messageText(m: AiMessage): string {
  return typeof m.content === "string" ? m.content : m.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}

export interface AiRequest {
  model: string;
  system: string;
  /**
   * The whole document ("Include whole document"), sent apart from the messages so that the provider can cache it:
   * Anthropic gets it as its own system block marked `cache_control: { type: "ephemeral" }` (follow-up turns of the
   * conversation read it from the cache); OpenAI-compatible endpoints get it appended to the system message (no
   * cache marker – OpenAI caches long prefixes by itself, local servers do not).
   */
  documentContext?: string;
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
  /**
   * Token counts so far. `inputTokens` is the whole input (uncached + cache read + cache write); `cacheReadTokens` /
   * `cacheWriteTokens` are the parts read from / written to the provider's prompt cache.
   */
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
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
