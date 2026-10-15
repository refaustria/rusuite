// The speaker notes pane under the stage (View › Notes): plain text of the
// current slide's notes, committed (`SetNotes`) on blur or when the
// slide changes.

import { useEffect, useRef, useState } from "react";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";

export function NotesPane({ store }: { store: ShowStore }) {
  const t = useT();
  const visible = useShow(store, (s) => s.notesVisible);
  const current = useShow(store, (s) => s.current);
  const notes = useShow(store, (s) => s.pres?.slides.find((x) => x.id === s.current)?.notes ?? "");
  const [draft, setDraft] = useState(notes);
  const editing = useRef<{ slide: number | null; text: string } | null>(null);

  // A new slide or a patch (undo) replaces the draft unless it is being typed in.
  useEffect(() => {
    if (!editing.current) setDraft(notes);
  }, [notes, current]);

  // Leaving a slide commits what was typed for it.
  useEffect(
    () => () => {
      const e = editing.current;
      if (e && e.slide !== null) void store.setNotes(e.slide, e.text);
      editing.current = null;
    },
    [current, store],
  );

  if (!visible) return null;
  return (
    <div className="h-28 shrink-0 border-t border-ui-border bg-ui-panel p-1" data-testid="notes-pane">
      <textarea
        aria-label={t("show.speakerNotes")}
        placeholder={t("show.addNotes")}
        className="h-full w-full resize-none rounded border border-ui-border bg-ui-bg p-2 text-sm text-ui-fg outline-none focus:border-ui-focus"
        value={draft}
        disabled={current === null}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          editing.current = { slide: current, text: e.currentTarget.value };
        }}
        onBlur={() => {
          const e = editing.current;
          editing.current = null;
          if (e && e.slide !== null) void store.setNotes(e.slide, e.text);
        }}
      />
    </div>
  );
}
