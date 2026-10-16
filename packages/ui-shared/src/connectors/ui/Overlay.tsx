// What the connections need on screen outside the pages: the password question, the save-conflict question
// (Overwrite / Save a copy / Reload theirs) and error/offline notices. Rendered by the backstage, also while closed.

import { useEffect, useState } from "react";
import { Dialog } from "../../Dialog";
import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import type { Connectors } from "../controller";
import { originOf } from "../paths";
import { BUTTON, INPUT, PRIMARY } from "./hooks";
import { useConnectors } from "./hooks";

function PasswordPrompt({ connectors }: { connectors: Connectors }) {
  const t = useT();
  const prompt = useConnectors(connectors, (s) => s.prompt);
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    setSecret("");
    setRemember(false);
  }, [prompt]);
  if (prompt?.kind !== "password") return null;
  const c = prompt.connection;
  return (
    <Dialog open title={t("conn.password.title", { name: c.name })} onClose={() => connectors.answer(null)}>
      <form
        className="flex w-80 flex-col gap-3"
        data-testid="password-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          connectors.answer({ secret, remember });
        }}
      >
        <p className="text-sm">
          {t("conn.password.text", { user: c.auth.kind === "basic" ? c.auth.username : "", host: originOf(c.baseUrl) })}
        </p>
        {prompt.error && <p className="text-sm text-red-700 dark:text-red-400">{prompt.error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          {t("conn.dialog.password")}
          <input type="password" autoComplete="current-password" className={INPUT} value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("conn.dialog.remember")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => connectors.answer(null)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={`${PRIMARY} ${FOCUS_RING}`}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ConflictPrompt({ connectors }: { connectors: Connectors }) {
  const t = useT();
  const prompt = useConnectors(connectors, (s) => s.prompt);
  if (prompt?.kind !== "conflict") return null;
  return (
    <Dialog open title={t("conn.conflict.title", { name: prompt.name })} onClose={() => connectors.answer("cancel")}>
      <div className="flex max-w-md flex-col gap-3" data-testid="conflict-dialog">
        <p className="text-sm">{t("conn.conflict.text", { name: prompt.name, connection: prompt.connection })}</p>
        <ul className="list-disc pl-5 text-xs text-ui-muted">
          <li>{t("conn.conflict.overwriteTip")}</li>
          <li>{t("conn.conflict.copyTip")}</li>
          <li>{t("conn.conflict.reloadTip")}</li>
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => connectors.answer("cancel")}>
            {t("common.cancel")}
          </button>
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => connectors.answer("reload")}>
            {t("conn.conflict.reload")}
          </button>
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => connectors.answer("copy")}>
            {t("conn.conflict.copy")}
          </button>
          <button type="button" className={`${PRIMARY} ${FOCUS_RING}`} onClick={() => connectors.answer("overwrite")}>
            {t("conn.conflict.overwrite")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Notice({ connectors }: { connectors: Connectors }) {
  const t = useT();
  const notice = useConnectors(connectors, (s) => s.notice);
  if (!notice) return null;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      data-testid="connector-notice"
      className={`fixed bottom-10 right-4 z-50 flex max-w-md items-start gap-3 rounded border bg-ui-panel px-3 py-2 text-sm shadow-lg ${
        notice.tone === "error" ? "border-red-600/50" : "border-ui-border"
      }`}
    >
      <span className="flex-1">
        {notice.text}
        {notice.help && (
          <>
            {" "}
            <a className="underline" href={notice.help} target="_blank" rel="noreferrer noopener">
              {t("conn.help")}
            </a>
          </>
        )}
      </span>
      <button type="button" className={`h-6 shrink-0 rounded px-1.5 text-xs hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => connectors.dismissNotice()}>
        {t("cmd.dismiss")}
      </button>
    </div>
  );
}

/** The connections' dialogs and notices for one window; offline warnings for a remote document. */
export function ConnectorsOverlay({ connectors }: { connectors: Connectors }) {
  const t = useT();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const offline = () => {
      const loc = connectors.getState().location;
      const c = loc && connectors.connection(loc.connectionId);
      if (c) connectors.notify("info", t("conn.offline", { connection: c.name }));
    };
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, [connectors, t]);
  return (
    <>
      <PasswordPrompt connectors={connectors} />
      <ConflictPrompt connectors={connectors} />
      <Notice connectors={connectors} />
    </>
  );
}
