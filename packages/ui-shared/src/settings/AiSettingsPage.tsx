// Settings › AI (File › Options… › AI): off by default; provider, API key (masked; stored only on this device),
// base URL, model, max tokens, temperature, "Include whole document" default, Test and Forget key. Nothing is sent
// until the user presses Test or runs an AI action.

import { useEffect, useId, useState } from "react";
import { FOCUS_RING } from "../Popover";
import { useT } from "../i18n/react";
import type { Assistant } from "../ai/controller";
import { errorText } from "../ai/controller";
import { providerName, providerOrigin } from "../ai/providers";
import { MAX_TOKENS_LIMIT, parseAiSettings, type AiSettings } from "../ai/settings";
import { AI_EFFORTS, type AiEffort, type AiProviderKind } from "../ai/types";
import { AI_BUTTON, AI_INPUT, AI_PRIMARY, useAssistant } from "../ai/ui/hooks";

const OTHER = "__other__";

export function AiSettingsPage({ ai, onDone }: { ai: Assistant; onDone: () => void }) {
  const t = useT();
  const saved = useAssistant(ai, (s) => s.settings);
  const hasKey = useAssistant(ai, (s) => s.hasKey);
  const [draft, setDraft] = useState<AiSettings>(saved);
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const f = (s: string) => `${id}-${s}`;
  useEffect(() => {
    void ai.loadKey();
  }, [ai]);

  const provider = draft.provider;
  const model = draft.models[provider];
  const known = ai.modelsOf(provider);
  const isKnown = known.some((m) => m.id === model);
  const [custom, setCustom] = useState(!isKnown);
  const web = ai.storeKind !== "desktop";
  const name = providerName(draft);
  let origin = "";
  let urlOk = true;
  try {
    origin = providerOrigin(draft);
    new URL(draft.baseUrls[provider]);
  } catch {
    urlOk = false;
  }
  const keyIsSaved = hasKey === true && provider === saved.provider;

  const patch = (p: Partial<AiSettings>) => {
    setResult(null);
    setDraft((d) => ({ ...d, ...p }));
  };
  const setProvider = (p: AiProviderKind) => {
    setKey("");
    setCustom(!ai.modelsOf(p).some((m) => m.id === draft.models[p]));
    patch({ provider: p });
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const models = await ai.test({ provider, baseUrl: draft.baseUrls[provider], model, key });
      setResult({ ok: true, text: t("ai.settings.testOk", { count: models.length }) });
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      ai.saveSettings(parseAiSettings(draft));
      if (key.trim()) await ai.setKey(key);
      onDone();
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const row = "flex flex-col gap-1 text-sm";
  return (
    <form
      className="flex w-[32rem] max-w-[calc(100vw-3rem)] flex-col gap-3"
      data-testid="ai-settings"
      aria-label={t("ai.settings.title")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} data-testid="ai-enabled" />
        {t("ai.settings.enable")}
      </label>
      <p className="text-xs text-ui-muted" data-testid="ai-data-notice">
        {t("ai.notice", { provider: name })} {t("ai.settings.noServer")}
      </p>
      <label className={row} htmlFor={f("provider")}>
        {t("ai.settings.provider")}
        <select id={f("provider")} className={AI_INPUT} value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKind)}>
          <option value="anthropic">{t("ai.settings.providerAnthropic")}</option>
          <option value="openai">{t("ai.settings.providerOpenAi")}</option>
        </select>
      </label>
      <div className={row}>
        <label htmlFor={f("key")}>{t("ai.settings.key")}</label>
        <div className="flex gap-2">
          <input
            id={f("key")}
            type="password"
            className={`${AI_INPUT} min-w-0 flex-1`}
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={keyIsSaved ? t("ai.settings.keySaved") : provider === "openai" ? t("ai.settings.keyOptional") : ""}
            aria-describedby={f("key-note")}
            onChange={(e) => {
              setResult(null);
              setKey(e.target.value);
            }}
          />
          <button
            type="button"
            className={`${AI_BUTTON} ${FOCUS_RING}`}
            disabled={!keyIsSaved || busy}
            onClick={() => void ai.forgetKey().then(() => setResult({ ok: true, text: t("ai.settings.keyForgotten") }))}
          >
            {t("ai.settings.forgetKey")}
          </button>
        </div>
        <span id={f("key-note")} className="text-xs text-ui-muted">
          {t(web ? "ai.settings.keyWeb" : "ai.settings.keyDesktop")}
        </span>
      </div>
      <label className={row} htmlFor={f("base")}>
        {t(provider === "anthropic" ? "ai.settings.baseUrlAdvanced" : "ai.settings.baseUrl")}
        <input
          id={f("base")}
          className={AI_INPUT}
          value={draft.baseUrls[provider]}
          inputMode="url"
          spellCheck={false}
          aria-invalid={!urlOk}
          onChange={(e) => patch({ baseUrls: { ...draft.baseUrls, [provider]: e.target.value } })}
        />
        {provider === "openai" && <span className="text-xs text-ui-muted">{t("ai.settings.baseUrlNote")}</span>}
      </label>
      <div className={row}>
        <label htmlFor={f("model")}>{t("ai.settings.model")}</label>
        <div className="flex gap-2">
          <select
            id={f("model")}
            className={`${AI_INPUT} min-w-0 flex-1`}
            value={custom ? OTHER : model}
            onChange={(e) => {
              if (e.target.value === OTHER) setCustom(true);
              else {
                setCustom(false);
                patch({ models: { ...draft.models, [provider]: e.target.value } });
              }
            }}
          >
            {known.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value={OTHER}>{t("ai.settings.modelOther")}</option>
          </select>
          {custom && (
            <input
              aria-label={t("ai.settings.modelId")}
              className={`${AI_INPUT} min-w-0 flex-1`}
              value={model}
              spellCheck={false}
              onChange={(e) => patch({ models: { ...draft.models, [provider]: e.target.value } })}
            />
          )}
        </div>
      </div>
      {provider === "openai" && (
        <div className="flex items-start gap-2 text-sm">
          <input
            id={f("vision")}
            type="checkbox"
            className="mt-0.5"
            checked={draft.visionModels.includes(model)}
            aria-describedby={f("vision-note")}
            data-testid="ai-vision"
            onChange={(e) =>
              patch({ visionModels: e.target.checked ? [...draft.visionModels.filter((m) => m !== model), model] : draft.visionModels.filter((m) => m !== model) })
            }
          />
          <span>
            <label htmlFor={f("vision")}>{t("ai.settings.vision")}</label>
            <span id={f("vision-note")} className="block text-xs text-ui-muted">
              {t("ai.settings.visionNote")}
            </span>
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={row} htmlFor={f("max")}>
          {t("ai.settings.maxTokens")}
          <input
            id={f("max")}
            type="number"
            min={1}
            max={MAX_TOKENS_LIMIT}
            className={AI_INPUT}
            value={draft.maxTokens}
            onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
          />
        </label>
        <label className={row} htmlFor={f("temp")}>
          {t("ai.settings.temperature")}
          <input
            id={f("temp")}
            type="number"
            min={0}
            max={2}
            step={0.1}
            className={AI_INPUT}
            value={draft.temperature}
            aria-describedby={f("temp-note")}
            onChange={(e) => patch({ temperature: Number(e.target.value) })}
          />
          <span id={f("temp-note")} className="text-xs text-ui-muted">
            {t("ai.settings.temperatureNote")}
          </span>
        </label>
      </div>
      <label className={row} htmlFor={f("effort")}>
        {t("ai.settings.reasoning")}
        <select
          id={f("effort")}
          className={AI_INPUT}
          value={draft.effort}
          disabled={provider !== "anthropic"}
          aria-describedby={f("effort-note")}
          data-testid="ai-effort"
          onChange={(e) => patch({ effort: e.target.value as AiEffort })}
        >
          {AI_EFFORTS.map((level) => (
            <option key={level} value={level}>
              {t(`ai.effort.${level}`)}
            </option>
          ))}
        </select>
        <span id={f("effort-note")} className="text-xs text-ui-muted">
          {t(provider === "anthropic" ? "ai.settings.reasoningNote" : "ai.settings.reasoningAnthropicOnly")}
        </span>
      </label>
      <div className="flex items-start gap-2 text-sm">
        <input id={f("whole")} type="checkbox" className="mt-0.5" checked={draft.includeDocument} aria-describedby={f("whole-note")} onChange={(e) => patch({ includeDocument: e.target.checked })} />
        <span>
          <label htmlFor={f("whole")}>{t("ai.settings.includeDocument")}</label>
          <span id={f("whole-note")} className="block text-xs text-ui-muted">
            {t("ai.settings.includeDocumentNote")}
          </span>
        </span>
      </div>
      <p className="text-xs text-ui-muted" data-testid="ai-contacts">
        {urlOk ? t(web ? "ai.settings.contactsWeb" : "ai.settings.contactsDesktop", { origin }) : t("ai.settings.badUrl")}
      </p>
      {result && (
        <p
          role="status"
          data-testid="ai-test-result"
          className={`rounded border px-2 py-1.5 text-sm ${result.ok ? "border-green-600/40 text-green-800 dark:text-green-300" : "border-red-600/40 text-red-800 dark:text-red-300"}`}
        >
          {result.text}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2">
        <button type="button" className={`${AI_BUTTON} ${FOCUS_RING}`} disabled={busy || !urlOk} onClick={() => void test()}>
          {t("ai.settings.test")}
        </button>
        <span className="flex-1" />
        <button type="button" className={`${AI_BUTTON} ${FOCUS_RING}`} onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button type="submit" className={`${AI_PRIMARY} ${FOCUS_RING}`} disabled={busy || !urlOk}>
          {t("ai.settings.save")}
        </button>
      </div>
    </form>
  );
}
