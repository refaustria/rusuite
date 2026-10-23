// "Creating PDF…" (P10-M6): shown while `exportPdfDocument` waits for the shell's PDF renderer (a save dialog or
// picker may follow). Mounted once by the backstage, which every app renders.

import { useSyncExternalStore } from "react";
import { isPdfBusy, subscribePdfBusy } from "../print";
import { useT } from "../i18n/react";

export function PdfBusySheet() {
  const t = useT();
  const busy = useSyncExternalStore(subscribePdfBusy, isPdfBusy, () => false);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 sm:items-center" data-testid="pdf-busy" data-busy="true">
      <div role="status" aria-live="polite" className="m-4 flex items-center gap-3 rounded-lg border border-ui-border bg-ui-panel px-5 py-4 text-sm text-ui-fg shadow-lg">
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-ui-border border-t-ui-focus" />
        {t("pdf.creating")}
      </div>
    </div>
  );
}
