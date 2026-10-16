import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import type { Assistant } from "../controller";
import { useAssistant, useProviderName } from "./hooks";

/** Status-bar item while AI is enabled: "AI: Anthropic" (opens the panel). */
export function AiStatus({ ai, className }: { ai: Assistant; className?: string }) {
  const t = useT();
  const enabled = useAssistant(ai, (s) => s.settings.enabled);
  const running = useAssistant(ai, (s) => s.running);
  const provider = useProviderName(ai);
  if (!enabled || !ai.available) return null;
  return (
    <button
      type="button"
      data-testid="ai-status"
      className={`rounded px-1 hover:bg-ui-hover ${FOCUS_RING} ${className ?? ""}`}
      title={t("ai.status.tip", { provider })}
      onClick={() => ai.togglePanel()}
    >
      {t(running ? "ai.status.running" : "ai.status.on", { provider })}
    </button>
  );
}
