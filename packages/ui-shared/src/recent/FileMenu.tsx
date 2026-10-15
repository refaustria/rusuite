import { useEffect, useRef } from "react";
import { FOCUS_RING, Popover } from "../Popover";
import type { AnySession } from "./session";
import { formatTime, useSession } from "./useSession";
import { useT } from "../i18n/react";
import { formatCombo } from "../shortcuts/keys";

export interface FileMenuProps {
  session: AnySession;
  onOpen: () => void;
  onSave: () => void;
  disabled?: boolean;
}

const ITEM = `flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-ui-fg hover:bg-ui-hover ${FOCUS_RING}`;

/** "File" menu: Open, Save and the recent files of the session's storage. */
export function FileMenu({ session, onOpen, onSave, disabled }: FileMenuProps) {
  const s = session;
  const t = useT();
  return (
    <Popover label={t("ribbon.file")} disabled={disabled} trigger={<span className="px-1 text-sm">{t("ribbon.file")}</span>} role="menu">
      {(close) => (
        <FileMenuItems
          session={s}
          pick={(fn) => {
            close();
            fn();
          }}
          onOpen={onOpen}
          onSave={onSave}
        />
      )}
    </Popover>
  );
}

function FileMenuItems({
  session,
  pick,
  onOpen,
  onSave,
}: {
  session: AnySession;
  pick: (fn: () => void) => void;
  onOpen: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const recent = useSession(session, (st) => st.recent);
  const ref = useRef<HTMLUListElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  useEffect(() => {
    buttons()[0]?.focus();
    void session.refresh();
  }, [session]);
  const browser = session.storage?.kind === "browser";
  return (
    <ul
      ref={ref}
      role="presentation"
      aria-label={t("ribbon.file")}
      className="flex w-72 max-w-[80vw] flex-col"
      onKeyDown={(e) => {
        const b = buttons();
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") b[(i + 1) % b.length]?.focus();
        else if (e.key === "ArrowUp") b[(i - 1 + b.length) % b.length]?.focus();
        else return;
        e.preventDefault();
      }}
    >
      <li role="none">
        <button type="button" role="menuitem" className={ITEM} onClick={() => pick(onOpen)}>
          {t("backstage.open")} <span className="ml-auto text-xs text-ui-muted">{formatCombo("Mod+O")}</span>
        </button>
      </li>
      <li role="none">
        <button type="button" role="menuitem" className={ITEM} onClick={() => pick(onSave)}>
          {t("backstage.save")} <span className="ml-auto text-xs text-ui-muted">{formatCombo("Mod+S")}</span>
        </button>
      </li>
      <li role="separator" className="my-1 border-t border-ui-border" />
      <li role="none" className="px-2 pb-1 text-xs font-medium text-ui-muted">
        {t("recent.title")}
      </li>
      {recent.length === 0 && (
        <li role="none" className="px-2 py-1 text-sm text-ui-muted" data-testid="recent-empty">
          {t("recent.empty")}
        </li>
      )}
      {recent.map((r) => (
        <li role="none" key={r.path ?? r.blobId ?? r.name}>
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            title={r.path ?? t("recent.browserCopy", { name: r.name })}
            data-testid="recent-entry"
            onClick={() => pick(() => void session.openRecent(r))}
          >
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="ml-auto shrink-0 text-xs text-ui-muted">{formatTime(r.openedAt)}</span>
          </button>
        </li>
      ))}
      {browser && (
        <li role="note" className="px-2 pt-1 text-xs text-ui-muted" data-testid="recent-web-note">
          {t("recent.webNote")}
        </li>
      )}
    </ul>
  );
}
