// File › Options…: the shared options dialog. Pages: AI (P8-37), Language (P9-L0) and – for an app with options of
// its own (Write's user name) – General, which opens them.

import { useState } from "react";
import { Dialog } from "../Dialog";
import { FOCUS_RING } from "../Popover";
import { LanguageList, useT } from "../i18n/react";
import type { Assistant } from "../ai/controller";
import { useAssistant, AI_BUTTON } from "../ai/ui/hooks";
import { AiSettingsPage } from "./AiSettingsPage";

/** The downloads page of the desktop apps (a plain link: following it is the user's action). */
export const DESKTOP_DOWNLOADS_URL = "https://github.com/refaustria/rusuite/releases";

/** Settings › AI on the web build: no form, no key field – the assistant is a desktop feature (ADR 0009). */
export function AiDesktopOnly() {
  const t = useT();
  return (
    <div className="flex w-[32rem] max-w-[calc(100vw-3rem)] flex-col items-start gap-3" data-testid="ai-desktop-only">
      <p className="text-sm">{t("ai.settings.desktopOnly")}</p>
      <a className={`text-sm text-ui-focus underline ${FOCUS_RING}`} href={DESKTOP_DOWNLOADS_URL} target="_blank" rel="noopener noreferrer" data-testid="ai-desktop-downloads">
        {t("ai.settings.desktopDownloads")}
      </a>
    </div>
  );
}

type Page = "ai" | "language" | "general";

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
          {tab("language", t("settings.language"))}
          {more && tab("general", t("settings.general"))}
        </div>
        <div role="tabpanel" className="min-w-0">
          {page === "language" ? (
            <LanguageList />
          ) : page === "ai" || !more ? (
            ai.available ? <AiSettingsPage ai={ai} onDone={close} /> : <AiDesktopOnly />
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
