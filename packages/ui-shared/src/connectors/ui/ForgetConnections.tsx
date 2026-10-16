import { useState } from "react";
import type { Connectors } from "../controller";
import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import { useConnectors } from "./hooks";

/** The privacy section's connections part: what is contacted, and "Forget all connections". */
export function ForgetConnections({ connectors }: { connectors: Connectors }) {
  const t = useT();
  const count = useConnectors(connectors, (s) => s.connections.length);
  const [done, setDone] = useState(false);
  const web = connectors.platform.kind === "web";
  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="privacy-connections">
      <p className="text-sm">{t(web ? "conn.privacy.web" : "conn.privacy.desktop", { count })}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="privacy-forget-connections"
          className={`rounded border border-ui-border px-3 py-1.5 text-sm hover:bg-ui-hover ${FOCUS_RING}`}
          onClick={() => void connectors.forgetAll().then(() => setDone(true))}
        >
          {t("conn.privacy.forget")}
        </button>
        {done && (
          <span role="status" className="text-sm text-ui-muted" data-testid="privacy-forgotten">
            {t("conn.privacy.forgotten")}
          </span>
        )}
      </div>
    </div>
  );
}
