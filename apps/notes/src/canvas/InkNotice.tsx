// Flowing pages keep their strokes in the data but do not show them (ink needs a canvas page).

import type { PageMirror } from "../editor/mirror";
import { useT } from "../i18n";
import { useStrokeCount } from "./hooks";

export function InkHiddenNotice({ mirror }: { mirror: PageMirror }) {
  const t = useT();
  const n = useStrokeCount(mirror);
  if (n === 0) return null;
  return (
    <p className="notes-ink-hidden" role="note" data-testid="ink-hidden">
      {t("notes.canvas.inkHidden")}
    </p>
  );
}
