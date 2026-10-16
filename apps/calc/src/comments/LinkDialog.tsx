// Insert › Link (Ctrl+K): Excel's Insert/Edit Hyperlink dialog with its
// three targets – an existing file or web page, a place in this document
// (a sheet and cell reference, or a defined name) and an e-mail address
// (with subject) – plus Text to Display and the ScreenTip. And the user
// name prompt shown before the first comment (the name is remembered in
// this browser only, ADR 0009).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { NameInfo } from "../generated/NameInfo";
import type { SheetInfo } from "../generated/SheetInfo";
import { sheetPrefix } from "../grid/address";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import type { UserNext } from "./controller";
import { defaultLinkText, initialsOf, normalizeUrl } from "./model";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
/** The address field's hint (a scheme, not text). */
const URL_HINT = "https://"; // i18n-ignore
const FIELD = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

export type LinkKind = "web" | "place" | "email";

export interface LinkForm {
  kind: LinkKind;
  text: string;
  tooltip: string;
  address: string;
  /** Place in this document: a sheet name and a cell reference, or a defined name. */
  sheet: string;
  cell: string;
  name: string;
  email: string;
  subject: string;
}

/** The dialog's fields for an existing link (or a new one on `sheet` showing `text`). */
export function formFromLink(link: Hyperlink | undefined, text: string, sheet: string): LinkForm {
  const base: LinkForm = { kind: "web", text, tooltip: link?.tooltip ?? "", address: "", sheet, cell: "A1", name: "", email: "", subject: "" };
  const t = link?.target;
  if (!t) return base;
  if (t.kind === "url") return { ...base, kind: "web", address: t.url };
  if (t.kind === "email") return { ...base, kind: "email", email: t.address, subject: t.subject ?? "" };
  const bang = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(t.location);
  if (bang) return { ...base, kind: "place", sheet: bang[1] !== undefined ? bang[1].replace(/''/g, "'") : bang[2]!, cell: bang[3]!.replace(/\$/g, "") };
  return { ...base, kind: "place", name: t.location };
}

/** The target the fields describe (`null`: incomplete). */
export function linkFromForm(f: LinkForm): LinkTarget | null {
  switch (f.kind) {
    case "web": {
      const url = normalizeUrl(f.address);
      if (!url) return null;
      if (url.startsWith("mailto:")) return { kind: "email", address: url.slice(7) };
      return { kind: "url", url };
    }
    case "email": {
      const address = f.email.trim().replace(/^mailto:/i, "");
      if (!address) return null;
      return f.subject.trim() ? { kind: "email", address, subject: f.subject.trim() } : { kind: "email", address };
    }
    case "place": {
      if (f.name.trim()) return { kind: "location", location: f.name.trim() };
      const cell = f.cell.trim().replace(/\$/g, "").toUpperCase();
      if (!/^[A-Z]{1,3}[0-9]+(:[A-Z]{1,3}[0-9]+)?$/.test(cell) || !f.sheet) return null;
      return { kind: "location", location: `${sheetPrefix(f.sheet)}${cell}` };
    }
  }
}

export function LinkDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const st = store.getState();
  const sheet = st.activeSheet;
  const anchor = store.activeAnchor();
  const existing = store.comments.link({ sheet, ...anchor });
  const cell = store.activeCell();
  const sheets: SheetInfo[] = st.info?.sheets ?? [];
  const sheetName = sheets.find((s) => s.id === sheet)?.name ?? "Sheet1";
  const [f, setF] = useState<LinkForm>(() => formFromLink(existing, cell?.display ?? "", sheetName));
  const set = (p: Partial<LinkForm>) => setF((x) => ({ ...x, ...p }));
  const names: NameInfo[] = (st.info?.names ?? []).filter((n) => !n.hidden && (n.sheet === undefined || n.sheet === sheet));
  const target = linkFromForm(f);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const kinds: [LinkKind, string][] = [
    ["web", t("calc.link.kindWeb")],
    ["place", t("calc.link.kindPlace")],
    ["email", t("calc.link.kindEmail")],
  ];
  return (
    <Dialog open title={existing ? t("calc.link.editTitle") : t("calc.link.insertTitle")} onClose={close}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-3 text-sm"
        data-testid="link-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!target) return;
          close();
          // An empty cell shows the address when Text to Display is left empty (Excel).
          const text = f.text || (cell?.input ? "" : defaultLinkText(target));
          void store.comments.setLink(target, text, f.tooltip);
        }}
      >
        <div role="radiogroup" aria-label={t("calc.link.linkTo")} className="flex flex-wrap gap-1">
          {kinds.map(([k, label]) => (
            <label key={k} className={`flex min-h-8 cursor-pointer items-center gap-1 rounded border px-2 ${f.kind === k ? "border-ui-focus bg-ui-active" : "border-ui-border"}`}>
              <input type="radio" name="link-kind" checked={f.kind === k} onChange={() => set({ kind: k })} />
              {label}
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          {t("calc.link.text")}
          <input className={FIELD} value={f.text} onChange={(e) => set({ text: e.target.value })} />
        </label>
        {f.kind === "web" && (
          <label className="flex flex-col gap-1">
            {t("calc.link.address")}
            <input className={FIELD} value={f.address} placeholder={URL_HINT} onChange={(e) => set({ address: e.target.value })} autoFocus />
          </label>
        )}
        {f.kind === "place" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              {t("calc.link.cellRef")}
              <input className={FIELD} value={f.cell} onChange={(e) => set({ cell: e.target.value, name: "" })} />
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.sheet")}
              <select className={FIELD} value={f.sheet} onChange={(e) => set({ sheet: e.target.value, name: "" })}>
                {sheets.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {names.length > 0 && (
              <label className="col-span-2 flex flex-col gap-1">
                {t("calc.link.definedName")}
                <select className={FIELD} value={f.name} onChange={(e) => set({ name: e.target.value })}>
                  <option value="">{t("calc.link.noName")}</option>
                  {names.map((n) => (
                    <option key={`${n.sheet ?? ""}:${n.name}`} value={n.name}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {f.kind === "email" && (
          <>
            <label className="flex flex-col gap-1">
              {t("calc.link.email")}
              <input className={FIELD} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.link.subject")}
              <input className={FIELD} value={f.subject} onChange={(e) => set({ subject: e.target.value })} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          {t("calc.link.screenTip")}
          <input className={FIELD} value={f.tooltip} onChange={(e) => set({ tooltip: e.target.value })} />
        </label>
        <div className="flex justify-between gap-2">
          <span>
            {existing && (
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  close();
                  void store.comments.removeLink();
                }}
              >
                {t("calc.link.remove")}
              </button>
            )}
          </span>
          <span className="flex gap-2">
            <button type="button" className={BTN} onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" className={BTN} disabled={!target}>
              {t("common.ok")}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for the user's name before the first comment. */
export function UserNameDialog({ store, next }: { store: CalcStore; next: UserNext }) {
  const t = useT();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const close = () => {
    store.comments.afterUser = null;
    store.closeDialog();
    store.focusGrid();
  };
  return (
    <Dialog open title={t("calc.user.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        data-testid="user-dialog"
        data-next={next}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const then = store.comments.afterUser;
          store.comments.afterUser = null;
          store.closeDialog();
          void store.comments.setUser(name, initials).then(() => then?.());
        }}
      >
        <p className="text-xs text-ui-muted">{t("calc.user.privacy")}</p>
        <label className="flex flex-col gap-1">
          {t("calc.user.name")}
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          {t("calc.user.initials")}
          <input className={FIELD} value={initials} placeholder={name ? initialsOf(name) : ""} onChange={(e) => setInitials(e.target.value)} maxLength={4} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={!name.trim()}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
