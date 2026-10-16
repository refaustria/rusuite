import { RibbonButton } from "../../ribbon/controls";
import type { RibbonGroup } from "../../ribbon/Ribbon";
import { FOCUS_RING } from "../../Popover";
import { t } from "../../i18n/locale";
import { useT } from "../../i18n/react";
import { reportProblem, type ReportController } from "../controller";
import type { DocStats } from "../types";
import { ReportIcon } from "./hooks";

/**
 * The Home tab's Help group (right end): Report a problem…. `docStats` gives the document's size (counts only) for
 * the diagnostics; it is read when the dialog opens.
 */
export function reportRibbonGroup(docStats?: () => DocStats | null | undefined, controller: ReportController = reportProblem): RibbonGroup {
  controller.setDocStats(docStats ?? null);
  return {
    label: t("group.help"),
    collapsePriority: 3,
    items: <RibbonButton label={t("report.menu")} icon={<ReportIcon size={22} />} size="large" tooltip={t("report.tip")} onClick={() => controller.open()} />,
  };
}

/** File › Report a problem… (`pick` leaves the backstage first). */
export function ReportBackstageItem({ pick, controller = reportProblem }: { pick: (fn: () => void) => void; controller?: ReportController }) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        title={t("report.tip")}
        className={`flex w-full items-center gap-3 px-5 py-2 text-left text-sm hover:bg-white/15 ${FOCUS_RING}`}
        onClick={() => pick(() => controller.open())}
      >
        <ReportIcon size={18} />
        {t("report.menu")}
      </button>
    </li>
  );
}
