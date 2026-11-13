// File › Home of Notes: the notebooks stored in this browser (Open), the recently opened pages, and where the
// notes are kept with "Remove local data from this browser" (ADR 0009 rule 4).

import { useState } from "react";
import { FOCUS_RING, getLocale, RibbonIcon } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { useT } from "../i18n";
import { useDialog } from "./dialogs";
import { useNotes } from "./hooks";

const ROW = `flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-ui-hover ${FOCUS_RING}`;

/** Leaves the backstage (its Back button) before a command that shows something in the app. */
function leave() {
  document.querySelector<HTMLButtonElement>('[data-testid="backstage-back"]')?.click();
}

export function BackstageHome({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const open = useDialog();
  const known = useNotes(ctl, (s) => s.known);
  const recent = useNotes(ctl, (s) => s.recent);
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const [removed, setRemoved] = useState(false);
  const locale = getLocale();
  const sorted = [...known].sort((a, b) => b.lastOpened - a.lastOpened);
  return (
    <div className="flex max-w-2xl flex-col gap-6" data-testid="backstage-notes">
      <section aria-label={t("notes.backstage.notebooks")}>
        <h2 className="mb-2 text-lg font-semibold">{t("notes.backstage.notebooks")}</h2>
        {sorted.length === 0 && <p className="text-sm text-ui-muted">{t("notes.backstage.noNotebooks")}</p>}
        <ul data-testid="known-notebooks">
          {sorted.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className={ROW}
                data-testid="known-notebook"
                onClick={() => {
                  leave();
                  void ctl.openKnown(k.id);
                }}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: k.color ?? "var(--notes-accent)" }} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{k.name}</span>
                  <span className="text-xs text-ui-muted">{notebooks.some((n) => n.summary.id === k.id) ? t("notes.backstage.open") : t("notes.backstage.closed")}</span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-ui-muted">{new Date(k.lastOpened).toLocaleDateString(locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t("notes.backstage.recent")}>
        <h2 className="mb-2 text-lg font-semibold">{t("notes.backstage.recent")}</h2>
        {recent.length === 0 && <p className="text-sm text-ui-muted">{t("notes.backstage.noRecent")}</p>}
        <ul data-testid="recent-pages">
          {recent.map((r) => (
            <li key={r.docId}>
              <button
                type="button"
                className={ROW}
                onClick={() => {
                  leave();
                  void ctl.openPageByDoc(r.docId);
                }}
              >
                <RibbonIcon name="recent" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{r.title || t("notes.untitled")}</span>
                  <span className="truncate text-xs text-ui-muted">{known.find((k) => k.id === r.notebook)?.name ?? ""}</span>
                </span>
                <span className="ml-auto shrink-0 text-xs text-ui-muted">{new Date(r.at).toLocaleString(locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t("privacy.title")} className="border-t border-ui-border pt-4" data-testid="privacy">
        <h2 className="mb-2 text-lg font-semibold">{t("privacy.title")}</h2>
        <p className="mb-3 text-sm" data-testid="privacy-text">
          {t("notes.privacy.text")}
        </p>
        <p className="mb-3 text-sm text-ui-muted">{t("privacy.report")}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="privacy-remove"
            className={`rounded border border-ui-border px-3 py-1.5 text-sm hover:bg-ui-hover ${FOCUS_RING}`}
            onClick={() =>
              open({
                kind: "confirm",
                title: t("notes.privacy.remove"),
                message: t("notes.privacy.removeConfirm"),
                confirm: t("notes.privacy.removeConfirmButton"),
                onConfirm: () =>
                  void ctl.clearLocalData().then(() => {
                    setRemoved(true);
                    leave();
                  }),
              })
            }
          >
            {t("notes.privacy.remove")}
          </button>
          {removed && (
            <span role="status" className="text-sm text-ui-muted" data-testid="privacy-removed">
              {t("notes.privacy.removed")}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
