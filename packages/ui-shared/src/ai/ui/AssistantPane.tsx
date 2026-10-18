// The assistant panel (right task pane; Home › AI, Ctrl+Shift+A): the app's action chips, a prompt box, the
// streamed answers of this document session with Insert / Replace selection / Copy (or the action's own Apply
// buttons after a preview), Stop, the token usage and a model picker. Context: the selection plus a one-line
// description of the document; the whole document only with "Include whole document" (with a size warning).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import { formatNumber } from "../../i18n/format";
import { eventCombo } from "../../shortcuts/keys";
import { RibbonIcon } from "../../ribbon/icons";
import type { AiAction, AiTurn, Assistant } from "../controller";
import type { AiAppAdapter } from "../adapter";
import { askAction, type AiAttachSource } from "../adapter";
import { errorText } from "../controller";
import { CONTEXT_LIMITS, estimateTokens } from "../prompts";
import { AI_BUTTON, AI_CHIP, AI_PRIMARY, useAssistant, useProviderName } from "./hooks";

/** Mod+Shift+A toggles the panel (capture phase: before the apps' own shortcut layers). */
export function useAssistantShortcut(ai: Assistant | null | undefined): void {
  useEffect(() => {
    if (!ai?.available) return;
    const onKey = (e: KeyboardEvent) => {
      if (eventCombo(e) !== "mod+shift+a") return;
      e.preventDefault();
      e.stopPropagation();
      ai.togglePanel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ai]);
}

function Turn({ ai, turn }: { ai: Assistant; turn: AiTurn }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const structured = !!turn.action.tool;
  const done = turn.status === "done";
  return (
    <li className="flex flex-col gap-1.5 border-b border-ui-border pb-3" data-testid="ai-turn" data-status={turn.status}>
      <p className="text-xs font-semibold">{turn.prompt}</p>
      <p className="text-[11px] text-ui-muted">{turn.contextLabel}</p>
      {turn.images?.length ? (
        <p className="text-[11px] text-ui-muted" data-testid="ai-turn-images">
          {t("ai.pane.sentPictures", { list: turn.images.join(", ") })}
        </p>
      ) : null}
      {turn.thinking && (
        // The reasoning summary: collapsed, apart from the answer (Insert / Replace use the answer only).
        <details className="rounded border border-ui-border px-2 py-1 text-xs text-ui-muted" data-testid="ai-thinking">
          <summary className={`cursor-pointer select-none ${FOCUS_RING}`}>{t("ai.pane.thinking")}</summary>
          <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words" data-testid="ai-thinking-text">
            {turn.thinking}
          </div>
        </details>
      )}
      {structured && done && turn.action.preview ? (
        <div className="text-sm" data-testid="ai-preview">
          {turn.action.preview(turn.value)}
        </div>
      ) : (
        (turn.text || turn.status === "streaming") && (
          <div className="whitespace-pre-wrap break-words rounded bg-ui-bg p-2 text-sm" data-testid="ai-answer">
            {structured && turn.status === "streaming" ? t("ai.pane.working") : turn.text || "…"}
          </div>
        )
      )}
      {turn.status === "stopped" && <p className="text-xs text-ui-muted">{t("ai.pane.stopped")}</p>}
      {turn.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400" data-testid="ai-error">
          {turn.error}
        </p>
      )}
      {turn.applied && (
        <p role="status" className="text-xs text-green-700 dark:text-green-400" data-testid="ai-applied">
          {turn.applied}
        </p>
      )}
      {done && (
        <div className="flex flex-wrap gap-1.5">
          {turn.action.apply.map((a, i) => {
            const reason = a.disabled?.(turn.value as never) ?? null;
            return (
              <button
                key={a.label}
                type="button"
                className={`${i === 0 ? AI_PRIMARY : AI_BUTTON} h-7 px-2 text-xs ${FOCUS_RING}`}
                disabled={reason !== null}
                title={reason ?? a.label}
                onClick={() => void ai.apply(turn.id, i)}
              >
                {a.label}
              </button>
            );
          })}
          {!structured && (
            <button
              type="button"
              className={`${AI_BUTTON} h-7 px-2 text-xs ${FOCUS_RING}`}
              onClick={() => {
                void navigator.clipboard?.writeText(turn.text).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? t("ai.pane.copied") : t("ai.pane.copy")}
            </button>
          )}
        </div>
      )}
      {turn.document && (
        <p className="text-[11px] text-ui-muted" data-testid="ai-turn-document" data-document={turn.document}>
          {t(`ai.pane.doc.${turn.document}`)}
        </p>
      )}
      {(turn.usage.input > 0 || turn.usage.output > 0) && (
        <p className="text-[11px] text-ui-muted" data-testid="ai-turn-usage">
          {t("ai.pane.turnUsage", { input: formatNumber(turn.usage.input), output: formatNumber(turn.usage.output) })}
          {turn.usage.cacheRead > 0 || turn.usage.cacheWrite > 0 ? (
            <span data-testid="ai-turn-cache">
              {" · "}
              {t("ai.pane.cacheUsage", { read: formatNumber(turn.usage.cacheRead), write: formatNumber(turn.usage.cacheWrite) })}
            </span>
          ) : null}
          {turn.model ? ` · ${turn.model}` : ""}
          {turn.effort ? <span data-testid="ai-turn-effort">{` · ${t("ai.pane.effort", { level: t(`ai.effort.${turn.effort}`) })}`}</span> : null}
        </p>
      )}
    </li>
  );
}

/** "Attach selected picture" / "Attach current slide as image" and the pictures waiting for the next turn. */
function Attachments({ ai, sources, disabled }: { ai: Assistant; sources: AiAttachSource[]; disabled: boolean }) {
  const t = useT();
  const pending = useAssistant(ai, (s) => s.attachments);
  const settings = useAssistant(ai, (s) => s.settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!sources.length && !pending.length) return null;
  const vision = ai.acceptsImages();
  const attach = async (src: AiAttachSource) => {
    setError(null);
    setBusy(true);
    try {
      ai.attach(await src.load());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="ai-attachments">
      <div className="flex flex-wrap gap-1.5">
        {sources.map((src) => {
          const reason = !vision ? t("ai.pane.noVision", { model: settings.models[settings.provider] }) : src.unavailable();
          return (
            <button
              key={src.id}
              type="button"
              className={`${AI_BUTTON} h-7 px-2 text-xs ${FOCUS_RING}`}
              disabled={disabled || busy || reason !== null}
              title={reason ?? src.label}
              onClick={() => void attach(src)}
            >
              <RibbonIcon name="image" size={14} />
              {src.label}
            </button>
          );
        })}
      </div>
      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("ai.pane.attached")} data-testid="ai-pending-pictures">
          {pending.map((img, i) => (
            <li key={`${i}:${img.label}`} className="flex items-center gap-1 rounded border border-ui-border bg-ui-bg p-0.5 pr-1">
              <img src={`data:${img.mediaType};base64,${img.data}`} alt="" className="h-8 w-8 rounded object-contain" />
              <span>{img.label}</span>
              <span className="text-ui-muted">
                {img.width}×{img.height}
              </span>
              <button type="button" className={`rounded px-1 hover:bg-ui-hover ${FOCUS_RING}`} aria-label={t("ai.pane.detach", { name: img.label })} onClick={() => ai.detach(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400" data-testid="ai-attach-error">
          {error}
        </p>
      )}
    </div>
  );
}

export interface AssistantPaneProps {
  ai: Assistant | null | undefined;
  adapter: AiAppAdapter;
}

/** The panel; renders nothing while closed (the Ctrl+Shift+A shortcut is always installed). */
export function AssistantPane({ ai, adapter }: AssistantPaneProps) {
  useAssistantShortcut(ai);
  if (!ai?.available) return null;
  return <Pane ai={ai} adapter={adapter} />;
}

function Pane({ ai, adapter }: { ai: Assistant; adapter: AiAppAdapter }) {
  const t = useT();
  const open = useAssistant(ai, (s) => s.panelOpen);
  const settings = useAssistant(ai, (s) => s.settings);
  const hasKey = useAssistant(ai, (s) => s.hasKey);
  const turns = useAssistant(ai, (s) => s.turns);
  const running = useAssistant(ai, (s) => s.running);
  const includeDocument = useAssistant(ai, (s) => s.includeDocument);
  const usage = useAssistant(ai, (s) => s.usage);
  const provider = useProviderName(ai);
  const label = useSyncExternalStore(adapter.subscribe, () => adapter.selectionLabel());
  const hasSelection = useSyncExternalStore(adapter.subscribe, () => adapter.hasSelection());
  // Re-render when what can be attached changes (a picture selected, …).
  useSyncExternalStore(adapter.subscribe, () => (adapter.attachSources ?? []).map((a) => a.unavailable() ?? "").join("\u0001"));
  const [pending, setPending] = useState<AiAction<unknown> | null>(null);
  const [needsDoc, setNeedsDoc] = useState<{ action: AiAction<unknown>; input: string } | null>(null);
  const [input, setInput] = useState("");
  const [docSize, setDocSize] = useState(0);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const actions = adapter.actions() as AiAction<unknown>[];
  const ask = useMemo(() => askAction(t("ai.pane.ask"), adapter.textApply) as AiAction<unknown>, [t, adapter]);

  useEffect(() => {
    if (open) prompt.current?.focus();
  }, [open]);
  useEffect(() => {
    if (includeDocument) setDocSize(adapter.documentSize());
  }, [includeDocument, adapter, label]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  if (!open) return null;
  const ready = settings.enabled && (hasKey === true || settings.provider === "openai");
  const model = settings.models[settings.provider];
  const models = ai.models();

  const start = async (action: AiAction<unknown>, text: string) => {
    if (action.needsDocument && !ai.getState().includeDocument) {
      setNeedsDoc({ action, input: text });
      return;
    }
    setNeedsDoc(null);
    setPending(null);
    setInput("");
    const ctx = await adapter.context(ai.getState().includeDocument);
    await ai.run(action, text, ctx, adapter.anchor?.());
  };

  const send = () => {
    const action = pending ?? ask;
    const text = input.trim();
    if (running || ((action.input?.required ?? action === ask) && !text)) return;
    void start(action, text);
  };

  const chip = (a: AiAction<unknown>) => {
    const reason = a.needsSelection && !hasSelection ? t("ai.pane.selectFirst") : (a.unavailable?.() ?? null);
    const disabled = !ready || running || reason !== null;
    return (
      <button
        key={a.id}
        type="button"
        className={`${AI_CHIP} ${FOCUS_RING}`}
        disabled={disabled}
        aria-pressed={pending?.id === a.id}
        title={reason ?? a.label}
        onClick={() => {
          if (a.input) {
            setPending(pending?.id === a.id ? null : a);
            prompt.current?.focus();
          } else void start(a, "");
        }}
      >
        {a.label}
      </button>
    );
  };

  return (
    <aside
      aria-label={t("ai.pane.title")}
      data-testid="ai-pane"
      className="flex w-80 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-ui-fg"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !running) {
          e.stopPropagation();
          ai.closePanel();
        }
      }}
    >
      <header className="flex items-center gap-1 border-b border-ui-border px-2 py-1.5">
        <RibbonIcon name="sparkle" size={16} />
        <h2 className="flex-1 text-sm font-semibold">{t("ai.pane.title")}</h2>
        <button type="button" className={`rounded p-1 hover:bg-ui-hover ${FOCUS_RING}`} aria-label={t("ai.pane.settings")} title={t("ai.pane.settings")} onClick={() => ai.openSettings()}>
          <RibbonIcon name="options" size={16} />
        </button>
        <button type="button" className={`rounded p-1 hover:bg-ui-hover ${FOCUS_RING}`} aria-label={t("common.close")} title={t("common.close")} onClick={() => ai.closePanel()}>
          <RibbonIcon name="close" size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        {!settings.enabled ? (
          <div className="flex flex-col items-start gap-2 text-sm" data-testid="ai-off">
            <p>{t("ai.pane.off")}</p>
            <button type="button" className={`${AI_PRIMARY} ${FOCUS_RING}`} onClick={() => ai.openSettings()}>
              {t("ai.pane.openSettings")}
            </button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col items-start gap-2 text-sm" data-testid="ai-no-key">
            <p>{hasKey === null ? t("ai.pane.loading") : t("ai.pane.noKey", { provider })}</p>
            <button type="button" className={`${AI_PRIMARY} ${FOCUS_RING}`} onClick={() => ai.openSettings()}>
              {t("ai.pane.openSettings")}
            </button>
          </div>
        ) : null}
        <p className="text-[11px] text-ui-muted" data-testid="ai-pane-notice">
          {t("ai.notice", { provider })}
        </p>
        <div className="flex flex-col gap-1 text-xs">
          <span data-testid="ai-context">{t("ai.pane.context", { what: label })}</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDocument} onChange={(e) => ai.setIncludeDocument(e.target.checked)} data-testid="ai-include-document" />
            {t("ai.pane.includeDocument")}
          </label>
          {includeDocument && (
            <span
              role="note"
              data-testid="ai-doc-warning"
              className={docSize > CONTEXT_LIMITS.warnDocument ? "text-amber-700 dark:text-amber-400" : "text-ui-muted"}
            >
              {t(docSize > CONTEXT_LIMITS.document ? "ai.pane.docTooLarge" : docSize > CONTEXT_LIMITS.warnDocument ? "ai.pane.docLarge" : "ai.pane.docSize", {
                chars: formatNumber(docSize),
                tokens: formatNumber(estimateTokens(Math.min(docSize, CONTEXT_LIMITS.document))),
                provider,
              })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ai.pane.actions")} data-testid="ai-actions">
          {actions.map(chip)}
        </div>
        <Attachments ai={ai} sources={adapter.attachSources ?? []} disabled={!ready || running} />
        {needsDoc && (
          <div role="alert" className="flex flex-col items-start gap-1.5 rounded border border-amber-600/40 p-2 text-xs" data-testid="ai-needs-document">
            <p>{t("ai.pane.needsDocument", { chars: formatNumber(adapter.documentSize()), provider })}</p>
            <button
              type="button"
              className={`${AI_BUTTON} h-7 px-2 text-xs ${FOCUS_RING}`}
              onClick={() => {
                ai.setIncludeDocument(true);
                const n = needsDoc;
                setNeedsDoc(null);
                void start(n.action, n.input);
              }}
            >
              {t("ai.pane.includeAndRun")}
            </button>
          </div>
        )}
        <ol ref={list} className="flex flex-col gap-3" aria-live="polite" data-testid="ai-turns">
          {turns.map((turn) => (
            <Turn key={turn.id} ai={ai} turn={turn} />
          ))}
        </ol>
      </div>
      <form
        className="flex flex-col gap-1.5 border-t border-ui-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {pending && (
          <div className="flex items-center gap-1 text-xs" data-testid="ai-pending">
            <span className="font-semibold">{pending.label}</span>
            <button type="button" className={`ml-auto rounded px-1 hover:bg-ui-hover ${FOCUS_RING}`} aria-label={t("common.cancel")} onClick={() => setPending(null)}>
              ×
            </button>
          </div>
        )}
        <textarea
          ref={prompt}
          rows={3}
          className="resize-none rounded border border-ui-border bg-ui-bg p-1.5 text-sm text-ui-fg"
          aria-label={t("ai.pane.prompt")}
          placeholder={pending?.input?.placeholder ?? t("ai.pane.promptPlaceholder")}
          value={input}
          disabled={!ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t("ai.pane.model")}
            className="h-7 min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-1 text-xs text-ui-fg"
            value={model}
            disabled={running}
            onChange={(e) => ai.saveSettings({ models: { ...settings.models, [settings.provider]: e.target.value } })}
          >
            {!models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {running ? (
            <button type="button" className={`${AI_BUTTON} h-7 px-2 text-xs ${FOCUS_RING}`} onClick={() => ai.stop()}>
              {t("ai.pane.stop")}
            </button>
          ) : (
            <button type="submit" className={`${AI_PRIMARY} h-7 px-2 text-xs ${FOCUS_RING}`} disabled={!ready || (!input.trim() && (pending?.input?.required ?? true))}>
              {t("ai.pane.send")}
            </button>
          )}
        </div>
        <p className="flex items-center gap-2 text-[11px] text-ui-muted" data-testid="ai-usage">
          <span className="flex-1">
            {t("ai.pane.usage", { input: formatNumber(usage.input), output: formatNumber(usage.output) })}
            {usage.cacheRead > 0 ? ` (${t("ai.pane.usageCached", { read: formatNumber(usage.cacheRead) })})` : ""}
          </span>
          {turns.length > 0 && !running && (
            <button type="button" className={`rounded px-1 hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => ai.clearConversation()}>
              {t("ai.pane.clear")}
            </button>
          )}
        </p>
      </form>
    </aside>
  );
}
