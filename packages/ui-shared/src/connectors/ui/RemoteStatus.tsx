import type { Connectors } from "../controller";
import { RibbonIcon } from "../../ribbon/icons";
import { useT } from "../../i18n/react";
import { useConnectors } from "./hooks";

/** Status-bar item for a document of a connection: the connection's name, the path as tooltip. */
export function RemoteStatus({ connectors, className }: { connectors: Connectors; className?: string }) {
  const t = useT();
  const loc = useConnectors(connectors, (s) => s.location);
  const conn = useConnectors(connectors, (s) => (s.location ? s.connections.find((c) => c.id === s.location!.connectionId) : undefined));
  if (!loc || !conn) return null;
  return (
    <span data-testid="remote-status" className={`inline-flex items-center gap-1 ${className ?? ""}`} title={t("conn.status.tip", { connection: conn.name, path: loc.path })}>
      <RibbonIcon name="cloud" size={14} />
      {conn.name}
    </span>
  );
}
