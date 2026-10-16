// `Assistant`: the window's AI state (one per backend, like `Connectors`) – the settings, the key (loaded only when
// needed: Settings › AI, or running an action), the assistant panel, and the conversation of the current document
// (in memory only: cleared when another document is opened or a new one started, never persisted).
//
// Nothing is sent anywhere unless the user enabled AI, entered a key (or chose a keyless local endpoint) and ran
// an action or pressed Test.

import type { ReactNode } from "react";
import { buildMessages, systemPrompt, type DocContext } from "./prompts";
import { createProvider, type ProviderFactory } from "./providers";
import { parseAiSettings, type AiSettings, type AiStore } from "./settings";
import type { AiMessage, AiProvider, AiTool, ModelInfo } from "./types";
import { AiError } from "./types";
import { t } from "../i18n/locale";

/** A button under a result (Insert, Replace selection, Insert formula, Apply, Set as speaker notes, …). */
export interface AiApply<T> {
  label: string;
  /** Runs the edit; resolves a short status ("Inserted") or throws (shown as the turn's error). */
  run(value: T, turn: AiTurn): Promise<string | void>;
  disabled?: (value: T) => string | null;
}

/** One action of an app (a chip in the panel). `T`: the parsed result (`string` for text actions). */
export interface AiAction<T = unknown> {
  id: string;
  label: string;
  /** Asks for text first (the description, the language, …). */
  input?: { placeholder: string; required: boolean };
  /** Needs selected content (the chip is disabled without). */
  needsSelection?: boolean;
  /** Needs the whole document (asks to include it). */
  needsDocument?: boolean;
  /** Why the action cannot run now (e.g. "The active cell has no formula"); `null`: it can. */
  unavailable?: () => string | null;
  /** The task text (`input`: what the user typed). */
  task(input: string, ctx: DocContext): string;
  /** Extra system instructions (e.g. the plain-text rule). */
  system?: string;
  /** A structured result: the tool and its parser. */
  tool?: AiTool;
  parse?: (raw: unknown) => T;
  /** The result as shown before applying (structured actions; text results show the text). */
  preview?: (value: T) => ReactNode;
  apply: AiApply<T>[];
}

export type AiTurnStatus = "streaming" | "done" | "error" | "stopped";

export interface AiTurn {
  id: number;
  action: AiAction<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** What the user asked ("Fix grammar & spelling", or the typed prompt). */
  prompt: string;
  contextLabel: string;
  /** Streamed text. */
  text: string;
  /** The parsed result (structured actions), or the final text. */
  value?: unknown;
  status: AiTurnStatus;
  error?: string;
  /** Status after applying ("Inserted 3 slides"). */
  applied?: string;
  usage: { input: number; output: number };
  model?: string;
  /** The context the result belongs to (e.g. Write's selection range at request time). */
  anchor?: unknown;
}

export interface AssistantState {
  settings: AiSettings;
  /** `null`: not loaded yet. */
  hasKey: boolean | null;
  panelOpen: boolean;
  settingsOpen: boolean;
  turns: AiTurn[];
  running: boolean;
  /** "Include whole document" for this document (starts at the settings' default). */
  includeDocument: boolean;
  /** Tokens of this document session. */
  usage: { input: number; output: number };
}

export interface AssistantOptions {
  store: AiStore;
  provider?: ProviderFactory;
  /**
   * `false` on the web build (ADR 0009, owner decision 2026-10-16): the assistant exists only so that File › Options…
   * can say "available in the desktop apps"; no ribbon group, shortcut, panel or status item, and nothing is sent.
   */
  available?: boolean;
}

let turnSeq = 0;

export class Assistant {
  private state: AssistantState;
  private listeners = new Set<() => void>();
  private key: string | null = null;
  private keyLoaded = false;
  private abort: AbortController | null = null;
  private readonly store: AiStore;
  private readonly factory: ProviderFactory;
  /** File › Options… of an app that has its own options (shown in the dialog's General page). */
  moreOptions: (() => void) | null = null;
  /** Whether AI actions can run here (desktop apps; the web build only shows a note in the options). */
  readonly available: boolean;

  constructor(options: AssistantOptions) {
    this.store = options.store;
    this.available = options.available !== false;
    this.factory = options.provider ?? ((kind, key, base) => createProvider(kind, key, base));
    const settings = this.store.loadSettings();
    this.state = {
      settings,
      hasKey: null,
      panelOpen: false,
      settingsOpen: false,
      turns: [],
      running: false,
      includeDocument: settings.includeDocument,
      usage: { input: 0, output: 0 },
    };
  }

  get storeKind(): AiStore["kind"] {
    return this.store.kind;
  }

  getState = (): AssistantState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<AssistantState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  private updateTurn(id: number, patch: Partial<AiTurn>): void {
    this.set({ turns: this.state.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  // --- settings and key -----------------------------------------------------------

  saveSettings(patch: Partial<AiSettings>): void {
    const settings = parseAiSettings({ ...this.state.settings, ...patch });
    const providerChanged = settings.provider !== this.state.settings.provider;
    this.store.saveSettings(settings);
    if (providerChanged) {
      this.key = null;
      this.keyLoaded = false;
    }
    this.set({
      settings,
      ...(providerChanged ? { hasKey: null } : {}),
      ...(patch.includeDocument !== undefined ? { includeDocument: settings.includeDocument } : {}),
    });
    if (providerChanged) void this.loadKey();
  }

  /** Loads the key of the current provider (desktop: from the keyring). */
  async loadKey(): Promise<string | null> {
    if (this.keyLoaded) return this.key;
    const provider = this.state.settings.provider;
    try {
      this.key = await this.store.getKey(provider);
    } catch {
      this.key = null;
    }
    if (provider !== this.state.settings.provider) return this.loadKey();
    this.keyLoaded = true;
    this.set({ hasKey: !!this.key });
    return this.key;
  }

  async setKey(key: string): Promise<void> {
    const k = key.trim();
    if (!k) return this.forgetKey();
    await this.store.setKey(this.state.settings.provider, k);
    this.key = k;
    this.keyLoaded = true;
    this.set({ hasKey: true });
  }

  async forgetKey(): Promise<void> {
    await this.store.deleteKey(this.state.settings.provider).catch(() => undefined);
    this.key = null;
    this.keyLoaded = true;
    this.set({ hasKey: false });
  }

  /** Whether requests can be made: enabled and a key (OpenAI-compatible endpoints may go without). */
  ready(): boolean {
    const s = this.state.settings;
    return s.enabled && (this.state.hasKey === true || s.provider === "openai");
  }

  private async provider(keyOverride?: string): Promise<AiProvider> {
    const s = this.state.settings;
    const key = keyOverride ?? (await this.loadKey());
    if (!key && s.provider === "anthropic") throw new AiError("noKey", "Enter your API key in Settings › AI");
    try {
      return this.factory(s.provider, key ?? "", s.baseUrls[s.provider]);
    } catch (e) {
      throw e instanceof AiError ? e : new AiError("invalid", "The base URL is not valid");
    }
  }

  models(): ModelInfo[] {
    try {
      return this.factory(this.state.settings.provider, "", this.state.settings.baseUrls[this.state.settings.provider]).models();
    } catch {
      return [];
    }
  }

  /**
   * Settings › Test with the dialog's (unsaved) values: the provider's model list. `key` empty: the saved key.
   */
  async test(draft: { provider: AiSettings["provider"]; baseUrl: string; model: string; key: string }): Promise<ModelInfo[]> {
    let key = draft.key.trim();
    if (!key && draft.provider === this.state.settings.provider) key = (await this.loadKey()) ?? "";
    if (!key && draft.provider === "anthropic") throw new AiError("noKey", "Enter your API key");
    let p: AiProvider;
    try {
      p = this.factory(draft.provider, key, draft.baseUrl);
    } catch (e) {
      throw e instanceof AiError ? e : new AiError("invalid", "The base URL is not valid");
    }
    return p.test(draft.model);
  }

  /** Known models of a provider (for the pickers). */
  modelsOf(kind: AiSettings["provider"]): ModelInfo[] {
    try {
      return this.factory(kind, "", this.state.settings.baseUrls[kind]).models();
    } catch {
      return [];
    }
  }

  // --- panel ------------------------------------------------------------------------

  openPanel(): void {
    this.set({ panelOpen: true });
    void this.loadKey();
  }

  closePanel(): void {
    this.set({ panelOpen: false });
  }

  togglePanel(): void {
    if (this.state.panelOpen) this.closePanel();
    else this.openPanel();
  }

  openSettings(): void {
    this.set({ settingsOpen: true });
    void this.loadKey();
  }

  closeSettings(): void {
    this.set({ settingsOpen: false });
  }

  setIncludeDocument(on: boolean): void {
    this.set({ includeDocument: on });
  }

  /** Another document was opened or a new one started: the conversation belongs to the old one. */
  documentReplaced(): void {
    this.stop();
    this.set({ turns: [], usage: { input: 0, output: 0 }, includeDocument: this.state.settings.includeDocument });
  }

  clearConversation(): void {
    if (this.state.running) return;
    this.set({ turns: [] });
  }

  // --- running ----------------------------------------------------------------------

  /** Stops the running request (the partial answer stays, marked stopped). */
  stop(): void {
    this.abort?.abort();
  }

  /** Earlier free-form turns as conversation (actions are standalone). */
  private history(action: AiAction<unknown>): AiMessage[] {
    if (action.tool) return [];
    return this.state.turns
      .filter((t) => t.status === "done" && t.action.id === action.id && !t.action.tool && t.text)
      .slice(-6)
      .flatMap((t): AiMessage[] => [
        { role: "user", content: t.prompt },
        { role: "assistant", content: t.text },
      ]);
  }

  /**
   * Runs `action` on `ctx`; resolves with the finished turn. The user's input goes into the task; the context is the
   * selection plus the document's description (the whole document only with "Include whole document").
   */
  async run<T>(action: AiAction<T>, input: string, ctx: DocContext, anchor?: unknown): Promise<AiTurn> {
    if (this.state.running) throw new AiError("busy", "An AI request is already running");
    const id = ++turnSeq;
    const s = this.state.settings;
    const prompt = input.trim() ? (action.input ? `${action.label}: ${input.trim()}` : input.trim()) : action.label;
    const turn: AiTurn = { id, action, prompt, contextLabel: ctx.selectionLabel, text: "", status: "streaming", usage: { input: 0, output: 0 }, anchor };
    this.set({ turns: [...this.state.turns, turn], running: true });
    const abort = new AbortController();
    this.abort = abort;
    let text = "";
    let value: unknown;
    let stopReason = "";
    const usage = { input: 0, output: 0 };
    try {
      if (!s.enabled) throw new AiError("off", "AI is turned off – turn it on in Settings › AI");
      const provider = await this.provider();
      const includeDocument = this.state.includeDocument;
      const messages = buildMessages(ctx, includeDocument, action.task(input.trim(), ctx), this.history(action as AiAction<unknown>));
      let last = 0;
      for await (const d of provider.complete({
        model: s.models[s.provider],
        system: systemPrompt(ctx.app, action.system ?? "", action.tool),
        messages,
        maxTokens: s.maxTokens,
        temperature: s.temperature,
        ...(action.tool ? { tools: [action.tool] } : {}),
        stream: true,
        signal: abort.signal,
      })) {
        if (d.type === "text") {
          text += d.text;
          // Re-render at most every 50 ms while streaming.
          if (Date.now() - last > 50) {
            last = Date.now();
            this.updateTurn(id, { text });
          }
        } else if (d.type === "toolUse") {
          if (action.tool && d.name === action.tool.name && value === undefined) value = d.input;
        } else if (d.type === "usage") {
          if (d.inputTokens !== undefined) usage.input = d.inputTokens;
          if (d.outputTokens !== undefined) usage.output = d.outputTokens;
        } else if (d.type === "model") {
          this.updateTurn(id, { model: d.model });
        } else if (d.type === "stop") {
          stopReason = d.reason;
        }
      }
      if (stopReason === "refusal") throw new AiError("refusal", "The model declined this request");
      let result: unknown;
      if (action.tool) {
        if (stopReason === "max_tokens") throw new AiError("truncated", "The answer was cut off – raise Max tokens in Settings › AI");
        if (value === undefined) throw new AiError("noResult", "The model did not return a structured result – try again or rephrase");
        result = action.parse ? action.parse(value) : value;
      } else {
        result = text;
      }
      this.finish(id, { text, value: result, status: "done", usage }, usage);
    } catch (e) {
      const stopped = e instanceof AiError && e.kind === "aborted";
      this.finish(id, { text, status: stopped ? "stopped" : "error", ...(stopped ? {} : { error: errorText(e) }), usage }, usage);
    } finally {
      if (this.abort === abort) this.abort = null;
    }
    return this.state.turns.find((t) => t.id === id) ?? turn;
  }

  private finish(id: number, patch: Partial<AiTurn>, usage: { input: number; output: number }): void {
    const total = { input: this.state.usage.input + usage.input, output: this.state.usage.output + usage.output };
    this.set({ turns: this.state.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)), running: false, usage: total });
  }

  /** Runs one of a finished turn's apply buttons. */
  async apply(turnId: number, index: number): Promise<void> {
    const turn = this.state.turns.find((t) => t.id === turnId);
    const button = turn?.action.apply[index];
    if (!turn || !button || turn.status !== "done") return;
    try {
      const status = await button.run(turn.value, turn);
      this.updateTurn(turnId, { applied: status || button.label, error: undefined });
    } catch (e) {
      this.updateTurn(turnId, { error: errorText(e) });
    }
  }
}

/** A failure as shown to the user (localized by kind, with the provider's own message after it). */
export function errorText(e: unknown): string {
  if (e instanceof AiError) {
    const head = t(`ai.err.${e.kind}`, { seconds: e.retryAfter ?? 0 });
    const retry = e.kind === "rateLimit" && e.retryAfter !== null ? ` ${t("ai.err.retryIn", { seconds: e.retryAfter })}` : "";
    const extra = e.kind === "badResponse" ? e.message : e.detail;
    return `${head}${retry}${extra ? ` (${extra})` : ""}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
