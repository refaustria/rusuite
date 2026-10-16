import { RibbonButton } from "../../ribbon/controls";
import type { RibbonGroup } from "../../ribbon/Ribbon";
import { t } from "../../i18n/locale";
import type { Assistant } from "../controller";
import { useAssistant } from "./hooks";

/** Home › AI: toggles the assistant panel (Ctrl+Shift+A). */
export function AiRibbonButton({ ai }: { ai: Assistant }) {
  const open = useAssistant(ai, (s) => s.panelOpen);
  return <RibbonButton label={t("ai.ribbon.button")} icon="sparkle" size="large" pressed={open} shortcut="Mod+Shift+A" tooltip={t("ai.ribbon.tip")} onClick={() => ai.togglePanel()} />;
}

/** The Home tab's AI group (omitted when the backend has no assistant, e.g. in tests). */
export function aiRibbonGroup(ai: Assistant | null | undefined): RibbonGroup {
  return { label: t("ai.ribbon.group"), items: ai ? <AiRibbonButton ai={ai} /> : null };
}
