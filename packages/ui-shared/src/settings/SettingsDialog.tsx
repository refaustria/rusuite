// File › Options…: the shared options dialog. Pages: AI (P8-37) and – for an app with options of its own (Write's
// user name) – General, which opens them.

import { useState } from "react";
import { Dialog } from "../Dialog";
import { FOCUS_RING } from "../Popover";
import { useT } from "../i18n/react";
import type { Assistant } from "../ai/controller";
import { useAssistant, AI_BUTTON } from "../ai/ui/hooks";
import { AiSettingsPage } from "./AiSettingsPage";

type Page = "ai" | "general";

export function SettingsDialog({ ai }: { ai: Assistant }) {
  const t = useT();
  const open = useAssistant(ai, (s) => s.settingsOpen);
  const [page, setPage] = useState<Page>("ai");
  if (!open) return null;
  const more = ai.moreOptions;
  const close = () => {
    setPage("ai");
    ai.closeSettings();
  };
  const tab = (p: Page, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={page === p}
      className={`rounded px-3 py-1.5 text-left text-sm hover:bg-ui-hover aria-selected:bg-ui-active ${FOCUS_RING}`}
      onClick={() => setPage(p)}
    >
      {label}
    </button>
  );
  return (
    <Dialog open title={t("settings.title")} onClose={close}>
      <div className="flex gap-4" data-testid="settings-dialog">
        <div role="tablist" aria-label={t("settings.pages")} aria-orientation="vertical" className="flex w-32 shrink-0 flex-col gap-1 border-r border-ui-border pr-2">
          {tab("ai", t("settings.ai"))}
          {more && tab("general", t("settings.general"))}
        </div>
        <div role="tabpanel" className="min-w-0">
          {page === "ai" || !more ? (
            <AiSettingsPage ai={ai} onDone={close} />
          ) : (
            <div className="flex w-[32rem] max-w-[calc(100vw-3rem)] flex-col items-start gap-3">
              <p className="text-sm">{t("settings.generalText")}</p>
              <button
                type="button"
                className={`${AI_BUTTON} ${FOCUS_RING}`}
                onClick={() => {
                  close();
                  more();
                }}
              >
                {t("settings.appOptions")}
              </button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
