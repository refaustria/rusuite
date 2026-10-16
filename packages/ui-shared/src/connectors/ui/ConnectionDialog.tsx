// Add / Edit a connection: name, server URL, user name, password, root folder, "allow http", "Remember password on
// this device" and "Test connection" (lists the root folder and says how it went).

import { useState } from "react";
import { Dialog } from "../../Dialog";
import { FOCUS_RING } from "../../Popover";
import { useT } from "../../i18n/react";
import type { Connection } from "../provider";
import { toConnectorError } from "../provider";
import { checkBaseUrl, originOf } from "../paths";
import type { ConnectionDraft, Connectors } from "../controller";
import { helpFor } from "../controller";
import { BUTTON, INPUT, PRIMARY } from "./hooks";

export interface ConnectionDialogProps {
  connectors: Connectors;
  /** The connection to edit; absent = a new one. */
  editing?: Connection | null;
  onClose: () => void;
  onSaved: (c: Connection) => void;
}

/** The dialog's fields → a connection draft (exported for tests). */
export function draftOf(f: { name: string; url: string; username: string; password: string; root: string; allowHttp: boolean; remember: boolean }): ConnectionDraft {
  return {
    kind: "webdav",
    name: f.name.trim(),
    baseUrl: f.url.trim().replace(/\/+$/, ""),
    auth: { kind: "basic", username: f.username.trim(), password: f.password },
    rootPath: f.root.trim() || "/",
    allowHttp: f.allowHttp,
    rememberPassword: f.remember,
  };
}

export function ConnectionDialog({ connectors, editing, onClose, onSaved }: ConnectionDialogProps) {
  const t = useT();
  const [name, setName] = useState(editing?.name ?? "");
  const [url, setUrl] = useState(editing?.baseUrl ?? "");
  const [username, setUsername] = useState(editing?.auth.kind === "basic" ? editing.auth.username : "");
  const [password, setPassword] = useState("");
  const [root, setRoot] = useState(editing?.rootPath ?? "/");
  const [allowHttp, setAllowHttp] = useState(editing?.allowHttp ?? false);
  const [remember, setRemember] = useState(editing?.rememberPassword ?? false);
  const [result, setResult] = useState<{ ok: boolean; text: string; help?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const web = connectors.platform.kind === "web";

  const fields = { name, url, username, password, root, allowHttp, remember };
  let urlError: string | null = null;
  if (url.trim()) {
    try {
      checkBaseUrl(url, allowHttp);
    } catch (e) {
      urlError = toConnectorError(e).kind === "insecure" ? t("conn.dialog.httpOff") : t("conn.dialog.badUrl");
    }
  }
  const valid = url.trim() !== "" && urlError === null;

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const n = await connectors.test(draftOf(fields));
      setResult({ ok: true, text: t("conn.dialog.testOk", { count: n }) });
    } catch (e) {
      const err = toConnectorError(e);
      setResult({ ok: false, text: connectors.describe(err), help: helpFor(err) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      onSaved(await connectors.saveConnection(draftOf(fields), editing?.id));
    } catch (e) {
      setResult({ ok: false, text: connectors.describe(e) });
    } finally {
      setBusy(false);
    }
  };

  const id = (s: string) => `conn-dlg-${s}`;
  const row = "flex flex-col gap-1 text-sm";
  return (
    <Dialog open title={editing ? t("conn.dialog.editTitle") : t("conn.dialog.addTitle")} onClose={onClose}>
      <form
        className="flex w-[30rem] max-w-[calc(100vw-3rem)] flex-col gap-3"
        data-testid="connection-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-xs text-ui-muted">{t("conn.dialog.intro")}</p>
        <label className={row} htmlFor={id("name")}>
          {t("conn.dialog.name")}
          <input
            id={id("name")}
            className={INPUT}
            value={name}
            placeholder="Nextcloud" // i18n-ignore
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className={row}>
          <label htmlFor={id("url")}>{t("conn.dialog.url")}</label>
          <input
            id={id("url")}
            className={INPUT}
            value={url}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://cloud.example.com/remote.php/dav/files/alice" // i18n-ignore
            aria-invalid={urlError !== null}
            aria-describedby={urlError ? id("url-error") : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {urlError && (
            <span id={id("url-error")} className="text-xs text-red-700 dark:text-red-400" data-testid="conn-url-error">
              {urlError}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={row} htmlFor={id("user")}>
            {t("conn.dialog.username")}
            <input id={id("user")} className={INPUT} value={username} autoComplete="username" spellCheck={false} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className={row} htmlFor={id("password")}>
            {t("conn.dialog.password")}
            <input
              id={id("password")}
              type="password"
              className={INPUT}
              value={password}
              autoComplete="current-password"
              placeholder={editing ? t("conn.dialog.passwordKeep") : ""}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        </div>
        <label className={row} htmlFor={id("root")}>
          {t("conn.dialog.root")}
          <input id={id("root")} className={INPUT} value={root} spellCheck={false} onChange={(e) => setRoot(e.target.value)} />
        </label>
        <div className="flex items-start gap-2 text-sm">
          <input id={id("remember")} type="checkbox" className="mt-0.5" checked={remember} aria-describedby={id("remember-note")} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            <label htmlFor={id("remember")}>{t("conn.dialog.remember")}</label>
            <span id={id("remember-note")} className="block text-xs text-ui-muted">
              {t(web ? "conn.dialog.rememberWeb" : "conn.dialog.rememberDesktop")}
            </span>
          </span>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <input id={id("http")} type="checkbox" className="mt-0.5" checked={allowHttp} aria-describedby={id("http-note")} onChange={(e) => setAllowHttp(e.target.checked)} />
          <span>
            <label htmlFor={id("http")}>{t("conn.dialog.allowHttp")}</label>
            <span id={id("http-note")} className="block text-xs text-ui-muted">
              {t("conn.dialog.allowHttpNote")}
            </span>
          </span>
        </div>
        <p className="text-xs text-ui-muted" data-testid="conn-contacts">
          {valid
            ? t(web ? "conn.dialog.contactsWeb" : "conn.dialog.contactsDesktop", {
                origin: originOf(url.trim()),
                site: typeof location === "undefined" ? "" : location.origin,
              })
            : t("conn.dialog.contactsNone")}
        </p>
        {result && (
          <p
            role="status"
            data-testid="conn-test-result"
            className={`rounded border px-2 py-1.5 text-sm ${result.ok ? "border-green-600/40 text-green-800 dark:text-green-300" : "border-red-600/40 text-red-800 dark:text-red-300"}`}
          >
            {result.text}
            {result.help && (
              <>
                {" "}
                <a className="underline" href={result.help} target="_blank" rel="noreferrer noopener">
                  {t("conn.help")}
                </a>
              </>
            )}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} disabled={!valid || busy} onClick={() => void test()}>
            {t("conn.dialog.test")}
          </button>
          <span className="flex-1" />
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={`${PRIMARY} ${FOCUS_RING}`} disabled={!valid || busy}>
            {t("conn.dialog.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
