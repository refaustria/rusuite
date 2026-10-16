// Settings › AI and where they are kept: on this device only, never synced, never in URLs or logs (ADR 0009).
// * Web (`BrowserAiStore`): `localStorage` of this site's origin (shared by Calc, Write and Show) – the settings under
//   `rusuite.ai.settings`, the API key under `rusuite.ai.key.<provider>`, unencrypted (the dialog says so).
// * Desktop (`TauriAiStore`): the settings in the webview's storage (the app data directory), the key in the OS
//   keyring (the shells' `connector_secret_*` commands, entry `rusuite-ai-<provider>`).
// AI is off by default; "Forget key" deletes the key.

import { invoke } from "@tauri-apps/api/core";
import type { AiProviderKind } from "./types";
import { ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_MODEL } from "./providers/anthropic";
import { OPENAI_BASE_URL, OPENAI_DEFAULT_MODEL } from "./providers/openai";

export interface AiSettings {
  version: 1;
  /** Off by default: nothing AI-related runs (and nothing is contacted) until the user turns it on. */
  enabled: boolean;
  provider: AiProviderKind;
  /** The model per provider (a known id or a free-text one). */
  models: Record<AiProviderKind, string>;
  /** Base URL per provider (Anthropic: `https://api.anthropic.com`; OpenAI-compatible: `…/v1`). */
  baseUrls: Record<AiProviderKind, string>;
  maxTokens: number;
  /** Used where the model accepts it. */
  temperature: number;
  /** "Include whole document" default (off): otherwise only the selection and a short description are sent. */
  includeDocument: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  version: 1,
  enabled: false,
  provider: "anthropic",
  models: { anthropic: ANTHROPIC_DEFAULT_MODEL, openai: OPENAI_DEFAULT_MODEL },
  baseUrls: { anthropic: ANTHROPIC_BASE_URL, openai: OPENAI_BASE_URL },
  maxTokens: 4096,
  temperature: 0.7,
  includeDocument: false,
};

export const MAX_TOKENS_LIMIT = 128_000;

const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
const str = (v: unknown, dflt: string) => (typeof v === "string" && v.trim() ? v.trim() : dflt);

/** Reads stored settings leniently (unknown fields dropped, broken values → defaults). */
export function parseAiSettings(json: string | null | unknown): AiSettings {
  let v: unknown = json;
  if (typeof json === "string") {
    try {
      v = JSON.parse(json);
    } catch {
      return structuredClone(DEFAULT_AI_SETTINGS);
    }
  }
  if (typeof v !== "object" || v === null) return structuredClone(DEFAULT_AI_SETTINGS);
  const o = v as Partial<AiSettings>;
  const d = DEFAULT_AI_SETTINGS;
  return {
    version: 1,
    enabled: o.enabled === true,
    provider: o.provider === "openai" ? "openai" : "anthropic",
    models: { anthropic: str(o.models?.anthropic, d.models.anthropic), openai: str(o.models?.openai, d.models.openai) },
    baseUrls: { anthropic: str(o.baseUrls?.anthropic, d.baseUrls.anthropic), openai: str(o.baseUrls?.openai, d.baseUrls.openai) },
    maxTokens: Math.round(clamp(o.maxTokens, 1, MAX_TOKENS_LIMIT, d.maxTokens)),
    temperature: clamp(o.temperature, 0, 2, d.temperature),
    includeDocument: o.includeDocument === true,
  };
}

export interface AiStore {
  readonly kind: "browser" | "desktop" | "memory";
  loadSettings(): AiSettings;
  saveSettings(settings: AiSettings): void;
  getKey(provider: AiProviderKind): Promise<string | null>;
  setKey(provider: AiProviderKind, key: string): Promise<void>;
  /** Deleting a missing key is not an error. */
  deleteKey(provider: AiProviderKind): Promise<void>;
}

export const AI_SETTINGS_KEY = "rusuite.ai.settings";
export const aiKeyName = (provider: AiProviderKind) => `rusuite.ai.key.${provider}`;

function local(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Settings in `localStorage` (both platforms). */
abstract class LocalSettings {
  loadSettings(): AiSettings {
    return parseAiSettings(local()?.getItem(AI_SETTINGS_KEY) ?? null);
  }

  saveSettings(settings: AiSettings): void {
    try {
      local()?.setItem(AI_SETTINGS_KEY, JSON.stringify(parseAiSettings(settings)));
    } catch {
      // storage full or blocked: the settings last for this page
    }
  }
}

/** Web: settings and key in this browser's `localStorage`. */
export class BrowserAiStore extends LocalSettings implements AiStore {
  readonly kind = "browser" as const;

  async getKey(provider: AiProviderKind): Promise<string | null> {
    return local()?.getItem(aiKeyName(provider)) ?? null;
  }

  async setKey(provider: AiProviderKind, key: string): Promise<void> {
    local()?.setItem(aiKeyName(provider), key);
  }

  async deleteKey(provider: AiProviderKind): Promise<void> {
    local()?.removeItem(aiKeyName(provider));
  }
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Desktop: the key in the OS keyring (via the shells' secret commands). */
export class TauriAiStore extends LocalSettings implements AiStore {
  readonly kind = "desktop" as const;

  constructor(private readonly inv: Invoke = invoke) {
    super();
  }

  getKey(provider: AiProviderKind): Promise<string | null> {
    return this.inv<string | null>("connector_secret_get", { id: `rusuite-ai-${provider}` });
  }

  async setKey(provider: AiProviderKind, key: string): Promise<void> {
    await this.inv("connector_secret_set", { id: `rusuite-ai-${provider}`, secret: key });
  }

  async deleteKey(provider: AiProviderKind): Promise<void> {
    await this.inv("connector_secret_delete", { id: `rusuite-ai-${provider}` });
  }
}

/** Tests and pages without storage. */
export class MemoryAiStore implements AiStore {
  readonly kind = "memory" as const;
  settings: AiSettings = structuredClone(DEFAULT_AI_SETTINGS);
  readonly keys = new Map<AiProviderKind, string>();

  loadSettings(): AiSettings {
    return structuredClone(this.settings);
  }

  saveSettings(settings: AiSettings): void {
    this.settings = parseAiSettings(settings);
  }

  async getKey(provider: AiProviderKind): Promise<string | null> {
    return this.keys.get(provider) ?? null;
  }

  async setKey(provider: AiProviderKind, key: string): Promise<void> {
    this.keys.set(provider, key);
  }

  async deleteKey(provider: AiProviderKind): Promise<void> {
    this.keys.delete(provider);
  }
}
