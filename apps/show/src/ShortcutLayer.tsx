// Keyboard shortcuts of Show: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). Slide-editor keys go through `shortcutFor`
// (state/shortcuts.ts) and `ShowStore.shortcut`.

import { useMemo, useState } from "react";
import { openBackstage, PromptDialog, ShortcutHelp, fromField, useShortcuts, withExtension, type ShortcutEntry, type ShortcutMap, type UnsavedGuard } from "@rusuite/ui-shared";
import type { RunProperties } from "../../../packages/ui-shared/src/generated/RunProperties";
import { shortcutFor } from "./state/shortcuts";
import type { ShowStore } from "./state/store";
import { formattingOf } from "./ui/ShowToolbar";
import { useT } from "./i18n";

export interface ShowShortcutProps {
  store: ShowStore;
  /** Asks about unsaved changes before New / Open. */
  guard: UnsavedGuard;
  /** Shortcuts are off while presenting (the presenter has its own keys). */
  enabled: boolean;
  /** Starts the show; `fromStart` = from the first slide, else from the current one. */
  onPresent: (fromStart: boolean) => void;
  /** Starts the presenter view (notes and timer here, the slide in a second window). */
  onPresenterView: () => void;
}

/** Entry running the slide-editor action `shortcutFor` derives from the key event. */
function action(store: ShowStore, label: string, group: string): ShortcutEntry {
  return {
    label,
    group,
    run: (e) => {
      const a = shortcutFor(e);
      return a ? store.shortcut(a) : false;
    },
  };
}

export function ShortcutLayer({ store, guard, enabled, onPresent, onPresenterView }: ShowShortcutProps) {
  const t = useT();
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const map = useMemo<ShortcutMap>(() => {
    const File = t("sc.file");
    const fileIo = (run: () => void) => () => {
      if (store.getState().fileIo) run();
    };
    /** B/I/U also work inside the text overlay (they format its selection). */
    const format = (label: string, toggle: (run: NonNullable<ReturnType<typeof formattingOf>>["run"]) => RunProperties): ShortcutEntry => ({
      label,
      group: t("sc.format"),
      inField: true,
      when: (e) => store.getState().editing !== null || !fromField(e.target),
      run: () => void store.applyRunPatch(toggle(formattingOf(store.getState())?.run ?? {})),
    });
    const fontStep = (label: string, dir: 1 | -1): ShortcutEntry => ({
      label,
      group: t("sc.format"),
      inField: true,
      when: (e) => store.getState().editing !== null || !fromField(e.target),
      run: () => {
        const f = formattingOf(store.getState());
        if (!f?.hasText) return false;
        void store.stepFont(dir, f.run.size ?? 1800);
      },
    });
    const edit = (label: string) => action(store, label, t("sc.edit"));
    const slide = (label: string) => action(store, label, t("show.sc.slide"));
    return {
      "Mod+N": { label: t("show.sc.newPres"), group: File, inField: true, run: () => void guard.run(() => store.newFile()) },
      "Mod+O": { label: t("cmd.open"), group: File, inField: true, run: fileIo(() => void guard.run(() => store.open())) },
      "Mod+S": { label: t("cmd.save"), group: File, inField: true, run: fileIo(() => void store.save()) },
      "Mod+Shift+S": { label: t("cmd.saveAs"), group: File, inField: true, run: fileIo(() => setSaveAsOpen(true)) },
      "Mod+P": {
        label: t("sc.printTip"),
        group: File,
        inField: true,
        run: () => {
          void store.commitEdit();
          openBackstage("print");
        },
      },
      "Mod+/": { label: t("shortcuts.title"), inField: true, run: () => setHelpOpen(true) },
      F5: { label: t("show.sc.presentFirst"), group: t("show.slideShow"), run: () => onPresent(true) },
      "Shift+F5": { label: t("show.sc.presentCurrent"), group: t("show.slideShow"), run: () => onPresent(false) },
      "Alt+F5": { label: t("show.sc.presenter"), group: t("show.slideShow"), run: () => onPresenterView() },
      "Mod+Z": edit(t("cmd.undo")),
      "Mod+Y": edit(t("cmd.redo")),
      "Mod+Shift+Z": edit(t("cmd.redo")),
      "Mod+A": edit(t("show.sc.selectAll")),
      Escape: edit(t("show.sc.deselect")),
      Enter: edit(t("show.sc.editText")),
      F2: edit(t("show.sc.editText")),
      Delete: edit(t("show.sc.delete")),
      Backspace: edit(t("show.sc.delete")),
      "Mod+B": format(t("fmt.bold"), (r) => ({ bold: !r.bold })),
      "Mod+I": format(t("fmt.italic"), (r) => ({ italic: !r.italic })),
      "Mod+U": format(t("fmt.underline"), (r) => ({ underline: r.underline && r.underline !== "none" ? "none" : "single" })),
      "Mod+C": edit(t("show.sc.copy")),
      "Mod+X": edit(t("show.sc.cut")),
      "Mod+V": edit(t("cmd.paste")),
      "Mod+Shift+>": fontStep(t("show.fontBigger"), 1),
      "Mod+Shift+<": fontStep(t("show.fontSmaller"), -1),
      "Mod+D": edit(t("show.duplicate")),
      "Mod+G": edit(t("show.group")),
      "Mod+Shift+G": edit(t("show.ungroup")),
      "Mod+]": slide(t("show.order.bringForward")),
      "Mod+Shift+]": slide(t("show.order.bringToFront")),
      "Mod+[": slide(t("show.order.sendBackward")),
      "Mod+Shift+[": slide(t("show.order.sendToBack")),
      ArrowLeft: slide(t("show.sc.nudgeLeft")),
      ArrowRight: slide(t("show.sc.nudgeRight")),
      ArrowUp: slide(t("show.sc.nudgeUp")),
      ArrowDown: slide(t("show.sc.nudgeDown")),
      "Shift+ArrowLeft": slide(t("show.sc.nudgeLeft10")),
      "Shift+ArrowRight": slide(t("show.sc.nudgeRight10")),
      "Shift+ArrowUp": slide(t("show.sc.nudgeUp10")),
      "Shift+ArrowDown": slide(t("show.sc.nudgeDown10")),
    };
  }, [store, guard, onPresent, onPresenterView, t]);

  useShortcuts(map, { enabled });

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} />
      <PromptDialog
        open={saveAsOpen}
        title={t("cmd.saveAs")}
        label={t("saveAs.fileName")}
        initial={store.getState().name ?? t("show.defaultName")}
        confirmLabel={t("cmd.save")}
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          void store.save(withExtension(name, ".pptx"));
        }}
      />
    </>
  );
}
