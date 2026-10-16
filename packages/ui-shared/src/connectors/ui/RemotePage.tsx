// The backstage Open and Save As pages (P8-36): "This device" (the app's own dialog or download) and the
// Connections – the configured ones, then "Add a connection…" – with the file browser of the chosen connection.

import { useEffect, useState } from "react";
import { FOCUS_RING } from "../../Popover";
import { RibbonIcon } from "../../ribbon/icons";
import { useT } from "../../i18n/react";
import type { AnySession } from "../../recent/session";
import type { Connection } from "../provider";
import { ConnectionDialog } from "./ConnectionDialog";
import { FileBrowser } from "./FileBrowser";
import { useConnectors } from "./hooks";

export interface RemotePageProps {
  session: AnySession;
  mode: "open" | "save";
  /** "This device": the app's Open / Save As command (after leaving the backstage). */
  onLocal?: () => void;
  /** Leaves the backstage (after a remote open or save). */
  onDone: () => void;
  /** Save As: the proposed name. */
  defaultName: string;
  disabled?: boolean;
}

const NAV = `flex h-10 w-full items-center gap-3 rounded px-3 text-left text-sm hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

export function RemotePage({ session, mode, onLocal, onDone, defaultName, disabled }: RemotePageProps) {
  const t = useT();
  const connectors = session.connectors!;
  const connections = useConnectors(connectors, (s) => s.connections);
  const blocked = useConnectors(connectors, (s) => s.blocked);
  const loaded = useConnectors(connectors, (s) => s.loaded);
  const location = useConnectors(connectors, (s) => s.location);
  const [selected, setSelected] = useState<string | null>(location?.connectionId ?? null);
  const [dialog, setDialog] = useState<{ editing: Connection | null } | null>(null);
  useEffect(() => {
    void connectors.load();
  }, [connectors]);
  const conn = connections.find((c) => c.id === selected) ?? null;
  const canSave = mode === "open" || session.canSaveRemote();

  return (
    <div className="flex min-h-0 flex-1 gap-6" data-testid={mode === "open" ? "open-page" : "save-page"}>
      <div className="flex w-64 shrink-0 flex-col gap-1">
        <h2 className="mb-1 text-lg font-semibold">{mode === "open" ? t("conn.page.open") : t("conn.page.saveAs")}</h2>
        {onLocal && (
          <button type="button" className={NAV} disabled={disabled} data-autofocus onClick={onLocal}>
            <RibbonIcon name="device" size={20} />
            <span className="flex flex-col">
              <span className="font-medium">{t("conn.page.device")}</span>
              <span className="text-xs text-ui-muted">{mode === "open" ? t("conn.page.browse") : t(connectors.platform.kind === "web" ? "conn.page.download" : "conn.page.saveLocal")}</span>
            </span>
          </button>
        )}
        <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ui-muted">{t("conn.page.connections")}</h3>
        <ul className="flex flex-col gap-0.5" aria-label={t("conn.page.connections")} data-testid="connection-list">
          {connections.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`${NAV} ${c.id === selected ? "bg-ui-active font-medium" : ""}`}
                aria-current={c.id === selected ? "true" : undefined}
                disabled={disabled || !!blocked[c.id] || !canSave}
                title={blocked[c.id] ?? c.baseUrl}
                onClick={() => setSelected(c.id)}
              >
                <RibbonIcon name="cloud" size={20} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{c.name}</span>
                  <span className="truncate text-xs text-ui-muted">{blocked[c.id] ? t("conn.err.csp") : c.baseUrl.replace(/^https?:\/\//, "")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {loaded && connections.length === 0 && (
          <p className="px-3 text-xs text-ui-muted" data-testid="connections-empty">
            {t("conn.page.none")}
          </p>
        )}
        <button type="button" className={NAV} disabled={disabled} onClick={() => setDialog({ editing: null })}>
          <RibbonIcon name="plus" size={20} />
          {t("conn.page.add")}
        </button>
        <p className="mt-auto px-3 pt-4 text-xs text-ui-muted">{t("conn.page.note")}</p>
      </div>
      {conn && !blocked[conn.id] ? (
        <FileBrowser
          key={conn.id}
          connectors={connectors}
          connection={conn}
          mode={mode}
          defaultName={defaultName}
          onOpen={async (path) => {
            if (await session.openRemote(conn.id, path)) onDone();
          }}
          onSave={async (path) => {
            if (await session.saveRemote(conn.id, path)) onDone();
          }}
          onEdit={() => setDialog({ editing: conn })}
          onRemove={() => {
            setSelected(null);
            void connectors.removeConnection(conn.id);
          }}
        />
      ) : (
        <div className="flex flex-1 items-start text-sm text-ui-muted" data-testid="remote-hint">
          {conn && blocked[conn.id] ? blocked[conn.id] : t(mode === "open" ? "conn.page.hintOpen" : "conn.page.hintSave")}
        </div>
      )}
      {dialog && (
        <ConnectionDialog
          connectors={connectors}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={(c) => {
            setDialog(null);
            setSelected(c.id);
          }}
        />
      )}
    </div>
  );
}
