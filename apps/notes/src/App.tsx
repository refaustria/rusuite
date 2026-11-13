import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { FOCUS_RING, RibbonIcon, useCompact } from "@rusuite/ui-shared";
import type { NotesController } from "./controller";
import type { TabLock } from "./tablock";
import { TabLockOverlay } from "./ui/TabLockOverlay";
import { BusyCard, ImportResultDialog } from "./ui/ImportExport";
import { NotesShortcuts } from "./ShortcutLayer";
import { DialogHost } from "./ui/dialogs";
import { useNotes } from "./ui/hooks";
import { NavPane } from "./ui/NavPane";
import { NotesRibbon, NOTES_ACCENT } from "./ui/NotesRibbon";
import { PageArea } from "./ui/PageView";
import { PersistHint, StatusBar, Toast } from "./ui/StatusBar";
import { useT } from "./i18n";

/** Applies View › Dark mode (system / light / dark) to `<html data-theme>`. */
function useTheme(theme: "system" | "light" | "dark") {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

/** `#page=<page doc id>` links (Copy link to page) open their page. */
function useHashLinks(ctl: NotesController) {
  const phase = useNotes(ctl, (s) => s.phase);
  useEffect(() => {
    if (phase !== "ready") return;
    const go = () => {
      const m = /^#page=([A-Za-z0-9_-]+)$/.exec(location.hash);
      if (!m) return;
      void ctl.openPageByDoc(m[1]!).then(() => history.replaceState(null, "", location.pathname + location.search));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [ctl, phase]);
}

export default function App({ ctl, lock }: { ctl: NotesController; lock?: TabLock }) {
  const t = useT();
  const [editor, setEditor] = useState<Editor | null>(null);
  const onEditor = useCallback((e: Editor | null) => setEditor(e), []);
  const settings = useNotes(ctl, (s) => s.settings);
  const title = useNotes(ctl, (s) => s.opened?.title ?? null);
  const compact = useCompact();
  const [drawer, setDrawer] = useState(false);
  useTheme(settings.theme);
  useHashLinks(ctl);
  useEffect(() => {
    void ctl.backend.setTitle(`${title || t("notes.untitled")} – Rusuite Notes`).catch(() => undefined);
  }, [ctl, title, t]);
  const navButton = compact ? (
    <button
      type="button"
      aria-label={t("notes.view.nav")}
      aria-expanded={drawer}
      data-testid="nav-drawer-button"
      className={`inline-flex h-11 w-11 items-center justify-center rounded hover:bg-ui-hover ${FOCUS_RING}`}
      onClick={() => setDrawer(!drawer)}
    >
      <RibbonIcon name="menu" size={20} />
    </button>
  ) : undefined;
  return (
    <DialogHost ctl={ctl}>
      <main className="flex h-screen flex-col bg-ui-bg text-ui-fg" data-rs-app="" style={{ ["--notes-accent" as string]: NOTES_ACCENT }}>
        <NotesRibbon ctl={ctl} editor={editor} rightSlot={navButton} />
        <PersistHint ctl={ctl} />
        <div className="relative flex min-h-0 flex-1">
          {!compact && settings.navOpen && <NavPane ctl={ctl} width={settings.navWidth} onResize={(w) => ctl.updateSettings({ navWidth: w })} />}
          {compact && drawer && (
            <div className="fixed inset-0 z-30 flex" data-testid="nav-drawer">
              <div className="flex w-[85%] max-w-sm flex-col bg-ui-panel shadow-xl">
                <NavPane ctl={ctl} onNavigate={() => setDrawer(false)} />
              </div>
              <button type="button" aria-label={t("notes.close")} className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
            </div>
          )}
          <PageArea ctl={ctl} onEditor={onEditor} />
        </div>
        <StatusBar ctl={ctl} editor={editor} />
        <Toast ctl={ctl} />
        <BusyCard ctl={ctl} />
        <ImportResultDialog ctl={ctl} />
        <NotesShortcuts ctl={ctl} />
        {lock && <TabLockOverlay ctl={ctl} lock={lock} />}
      </main>
    </DialogHost>
  );
}
