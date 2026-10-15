// Keyboard shortcuts of Show: one `useShortcuts` map plus the dialogs some
// of them open (Save As, help). Slide-editor keys go through `shortcutFor`
// (state/shortcuts.ts) and `ShowStore.shortcut`.

import { useMemo, useState } from "react";
import { PromptDialog, ShortcutHelp, fromField, useShortcuts, withExtension, type ShortcutEntry, type ShortcutMap } from "@rusuite/ui-shared";
import type { RunProperties } from "../../../packages/ui-shared/src/generated/RunProperties";
import { shortcutFor } from "./state/shortcuts";
import type { ShowStore } from "./state/store";
import { formattingOf } from "./ui/ShowToolbar";

export interface ShowShortcutProps {
  store: ShowStore;
  /** Shortcuts are off while presenting (the presenter has its own keys). */
  enabled: boolean;
  /** Starts the show; `fromStart` = from the first slide, else from the current one. */
  onPresent: (fromStart: boolean) => void;
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

export function ShortcutLayer({ store, enabled, onPresent }: ShowShortcutProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const map = useMemo<ShortcutMap>(() => {
    const File = "File";
    const fileIo = (run: () => void) => () => {
      if (store.getState().fileIo) run();
    };
    /** B/I/U also work inside the text overlay (they format its selection). */
    const format = (label: string, toggle: (run: NonNullable<ReturnType<typeof formattingOf>>["run"]) => RunProperties): ShortcutEntry => ({
      label,
      group: "Format",
      inField: true,
      when: (e) => store.getState().editing !== null || !fromField(e.target),
      run: () => void store.applyRunPatch(toggle(formattingOf(store.getState())?.run ?? {})),
    });
    const edit = (label: string) => action(store, label, "Edit");
    const slide = (label: string) => action(store, label, "Slide");
    return {
      "Mod+N": {
        label: "New presentation",
        group: File,
        inField: true,
        run: () => {
          if (store.getState().dirty && typeof window.confirm === "function" && !window.confirm("Discard unsaved changes?")) return;
          void store.newFile();
        },
      },
      "Mod+O": { label: "Open", group: File, inField: true, run: fileIo(() => void store.open()) },
      "Mod+S": { label: "Save", group: File, inField: true, run: fileIo(() => void store.save()) },
      "Mod+Shift+S": { label: "Save as", group: File, inField: true, run: fileIo(() => setSaveAsOpen(true)) },
      // Replaced by the PDF export task (P5-2); a no-op until then.
      "Mod+P": { label: "Print / export PDF", group: File, inField: true, run: () => undefined },
      "Mod+/": { label: "Keyboard shortcuts", inField: true, run: () => setHelpOpen(true) },
      F5: { label: "Present from the first slide", group: "Slide show", run: () => onPresent(true) },
      "Shift+F5": { label: "Present from the current slide", group: "Slide show", run: () => onPresent(false) },
      "Mod+Z": edit("Undo"),
      "Mod+Y": edit("Redo"),
      "Mod+Shift+Z": edit("Redo"),
      "Mod+A": edit("Select all shapes"),
      Escape: edit("Deselect"),
      Enter: edit("Edit text of the selected shape"),
      F2: edit("Edit text of the selected shape"),
      Delete: edit("Delete selection"),
      Backspace: edit("Delete selection"),
      "Mod+B": format("Bold", (r) => ({ bold: !r.bold })),
      "Mod+I": format("Italic", (r) => ({ italic: !r.italic })),
      "Mod+U": format("Underline", (r) => ({ underline: r.underline && r.underline !== "none" ? "none" : "single" })),
      "Mod+D": edit("Duplicate"),
      "Mod+G": edit("Group"),
      "Mod+Shift+G": edit("Ungroup"),
      "Mod+]": slide("Bring forward"),
      "Mod+Shift+]": slide("Bring to front"),
      "Mod+[": slide("Send backward"),
      "Mod+Shift+[": slide("Send to back"),
      ArrowLeft: slide("Nudge left (Shift: 10x)"),
      ArrowRight: slide("Nudge right"),
      ArrowUp: slide("Nudge up"),
      ArrowDown: slide("Nudge down"),
      "Shift+ArrowLeft": slide("Nudge left by 10"),
      "Shift+ArrowRight": slide("Nudge right by 10"),
      "Shift+ArrowUp": slide("Nudge up by 10"),
      "Shift+ArrowDown": slide("Nudge down by 10"),
    };
  }, [store, onPresent]);

  useShortcuts(map, { enabled });

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} />
      <PromptDialog
        open={saveAsOpen}
        title="Save as"
        label="File name"
        initial={store.getState().name ?? "Presentation.pptx"}
        confirmLabel="Save"
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          void store.save(withExtension(name, ".pptx"));
        }}
      />
    </>
  );
}
