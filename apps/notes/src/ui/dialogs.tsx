// The app's dialogs: one at a time, opened through `DialogHost`'s `open(...)`.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { BTN, Dialog, FOCUS_RING, PromptDialog, publicVersion, RUSUITE_VERSION } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { allPages, allSections, SECTION_COLORS } from "../tree";
import { useT } from "../i18n";
import { useNotes } from "./hooks";
import { CustomizeTagsDialog } from "./TagsDialog";

export type DialogSpec =
  | { kind: "prompt"; title: string; label: string; initial?: string; confirm?: string; onSubmit: (value: string) => void }
  | { kind: "confirm"; title: string; message: string; confirm: string; onConfirm: () => void }
  | { kind: "color"; title: string; value: string | null; onPick: (color: string | null) => void }
  | { kind: "link"; initial: string; onSubmit: (href: string, text: string) => void }
  | { kind: "pagePicker"; onPick: (page: { docId: string; title: string }) => void }
  | { kind: "moveTo"; node: string; notebook: string }
  | { kind: "about" }
  | { kind: "customizeTags" }
  | { kind: "options" };

const DialogContext = createContext<(d: DialogSpec | null) => void>(() => undefined);

/** Opens a dialog (`null` closes). */
export function useDialog(): (d: DialogSpec | null) => void {
  return useContext(DialogContext);
}

export function DialogHost({ ctl, children }: { ctl: NotesController; children: ReactNode }) {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const open = useMemo(() => (d: DialogSpec | null) => setSpec(d), []);
  const close = () => setSpec(null);
  return (
    <DialogContext.Provider value={open}>
      {children}
      {spec?.kind === "prompt" && (
        <PromptDialog
          open
          title={spec.title}
          label={spec.label}
          initial={spec.initial ?? ""}
          confirmLabel={spec.confirm}
          onClose={close}
          onSubmit={(v) => {
            close();
            spec.onSubmit(v);
          }}
        />
      )}
      {spec?.kind === "confirm" && <ConfirmDialog spec={spec} onClose={close} />}
      {spec?.kind === "color" && <ColorDialog spec={spec} onClose={close} />}
      {spec?.kind === "link" && <LinkDialog spec={spec} onClose={close} />}
      {spec?.kind === "pagePicker" && <PagePicker ctl={ctl} onPick={spec.onPick} onClose={close} />}
      {spec?.kind === "moveTo" && <MoveToDialog ctl={ctl} node={spec.node} notebook={spec.notebook} onClose={close} />}
      {spec?.kind === "about" && <AboutDialog onClose={close} />}
      {spec?.kind === "customizeTags" && <CustomizeTagsDialog ctl={ctl} onClose={close} />}
      {spec?.kind === "options" && <OptionsDialog ctl={ctl} onClose={close} />}
    </DialogContext.Provider>
  );
}

/** The link field's hint (a URL scheme, not text). */
const URL_HINT = "https://";
const BUTTON = `rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover ${FOCUS_RING}`;
const PRIMARY = `rounded bg-[var(--notes-accent)] px-3 py-1 text-sm text-white hover:brightness-110 ${FOCUS_RING}`;

function ConfirmDialog({ spec, onClose }: { spec: Extract<DialogSpec, { kind: "confirm" }>; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open title={spec.title} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3 text-sm" data-testid="confirm-dialog">
        <p>{spec.message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.cancel")}
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              onClose();
              spec.onConfirm();
            }}
          >
            {spec.confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ColorDialog({ spec, onClose }: { spec: Extract<DialogSpec, { kind: "color" }>; onClose: () => void }) {
  const t = useT();
  const pick = (c: string | null) => {
    onClose();
    spec.onPick(c);
  };
  return (
    <Dialog open title={spec.title} onClose={onClose}>
      <div className="flex w-72 flex-col gap-3 text-sm">
        <div className="grid grid-cols-6 gap-2" role="listbox" aria-label={spec.title}>
          {SECTION_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={spec.value?.toLowerCase() === c.toLowerCase()}
              aria-label={t("notes.color.n", { n: i + 1 })}
              title={c}
              data-color={c}
              className={`h-8 w-8 rounded-full border-2 ${spec.value?.toLowerCase() === c.toLowerCase() ? "border-ui-fg" : "border-transparent"} ${FOCUS_RING}`}
              style={{ background: c }}
              onClick={() => pick(c)}
            />
          ))}
        </div>
        <div className="flex justify-between">
          <button type="button" className={BUTTON} onClick={() => pick(null)}>
            {t("notes.color.none")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function LinkDialog({ spec, onClose }: { spec: Extract<DialogSpec, { kind: "link" }>; onClose: () => void }) {
  const t = useT();
  const [href, setHref] = useState(spec.initial);
  const [text, setText] = useState("");
  return (
    <Dialog open title={t("notes.link.title")} onClose={onClose}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          spec.onSubmit(href.trim(), text.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          {t("notes.link.address")}
          <input className="h-7 rounded border border-ui-border bg-ui-bg px-2" value={href} onChange={(e) => setHref(e.target.value)} placeholder={URL_HINT} autoComplete="off" data-testid="link-href" />
        </label>
        <label className="flex flex-col gap-1">
          {t("notes.link.text")}
          <input className="h-7 rounded border border-ui-border bg-ui-bg px-2" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.cancel")}
          </button>
          <button type="submit" className={PRIMARY}>
            {t("notes.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Insert › Page link: every page of the open notebooks, filtered as you type. */
function PagePicker({ ctl, onPick, onClose }: { ctl: NotesController; onPick: (p: { docId: string; title: string }) => void; onClose: () => void }) {
  const t = useT();
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  const [q, setQ] = useState("");
  const pages = notebooks.flatMap((nb) => allPages(nb.tree).map((p) => ({ nb: nb.summary.info.name, docId: p.pageDoc!, title: p.title || t("notes.untitled") })));
  const shown = pages.filter((p) => p.title.toLowerCase().includes(q.toLowerCase().trim())).slice(0, 50);
  const pick = (p: { docId: string; title: string }) => {
    onClose();
    onPick(p);
  };
  return (
    <Dialog open title={t("notes.pageLink.title")} onClose={onClose}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        data-testid="page-picker"
        onSubmit={(e) => {
          e.preventDefault();
          if (shown[0]) pick(shown[0]);
        }}
      >
        <input className="h-7 rounded border border-ui-border bg-ui-bg px-2" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("notes.pageLink.filter")} placeholder={t("notes.pageLink.filter")} autoComplete="off" />
        <ul className="max-h-72 overflow-auto" role="listbox" aria-label={t("notes.pageLink.title")}>
          {shown.map((p) => (
            <li key={p.docId}>
              <button type="button" role="option" aria-selected={false} className={`flex w-full flex-col rounded px-2 py-1 text-left hover:bg-ui-hover ${FOCUS_RING}`} onClick={() => pick(p)}>
                <span>{p.title}</span>
                <span className="text-xs text-ui-muted">{p.nb}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1 text-ui-muted">{t("notes.pageLink.none")}</li>}
        </ul>
      </form>
    </Dialog>
  );
}

/** Move to…: a section of any open notebook. */
function MoveToDialog({ ctl, node, notebook, onClose }: { ctl: NotesController; node: string; notebook: string; onClose: () => void }) {
  const t = useT();
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  return (
    <Dialog open title={t("notes.moveTo.title")} onClose={onClose}>
      <div className="flex max-h-96 w-96 flex-col gap-2 overflow-auto text-sm" data-testid="move-to">
        {notebooks.map((nb) => (
          <section key={nb.summary.id}>
            <h3 className="px-2 text-xs font-semibold uppercase text-ui-muted">{nb.summary.info.name}</h3>
            <ul>
              {allSections(nb.tree).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-ui-hover ${FOCUS_RING}`}
                    onClick={() => {
                      onClose();
                      if (nb.summary.id === notebook) void ctl.move(node, s.id, s.children.filter((c) => c.kind === "page").length);
                      else void ctl.movePageToNotebook(node, nb.summary.id, s.id);
                    }}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color ?? "var(--ui-border)" }} />
                    {s.title || t("notes.untitledSection")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open title={t("notes.about.title")} onClose={onClose}>
      <div className="flex w-96 flex-col gap-2 text-sm" data-testid="about-dialog">
        <p className="text-lg font-semibold">Rusuite Notes {publicVersion(RUSUITE_VERSION)}</p>
        <p>{t("notes.about.text")}</p>
        <p className="text-ui-muted">{t("notes.about.license")}</p>
        <div className="flex justify-end">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function OptionsDialog({ ctl, onClose }: { ctl: NotesController; onClose: () => void }) {
  const t = useT();
  const settings = useNotes(ctl, (s) => s.settings);
  const storage = useNotes(ctl, (s) => s.storage);
  return (
    <Dialog open title={t("notes.options.title")} onClose={onClose}>
      <div className="flex w-96 flex-col gap-3 text-sm" data-testid="options-dialog">
        <label className="flex items-center justify-between gap-2">
          {t("notes.view.theme")}
          <select className="h-7 rounded border border-ui-border bg-ui-bg px-1" value={settings.theme} onChange={(e) => ctl.updateSettings({ theme: e.target.value as typeof settings.theme })}>
            <option value="system">{t("notes.view.theme.system")}</option>
            <option value="light">{t("notes.view.theme.light")}</option>
            <option value="dark">{t("notes.view.theme.dark")}</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          {t("notes.view.pageWidth")}
          <select className="h-7 rounded border border-ui-border bg-ui-bg px-1" value={settings.pageWidth} onChange={(e) => ctl.updateSettings({ pageWidth: e.target.value as typeof settings.pageWidth })}>
            <option value="normal">{t("notes.view.width.normal")}</option>
            <option value="wide">{t("notes.view.width.wide")}</option>
          </select>
        </label>
        <p className="text-ui-muted" data-testid="options-storage">
          {t(storage === "persisted" ? "notes.options.persisted" : "notes.options.notPersisted")}
        </p>
        <div className="flex justify-end">
          <button type="button" className={BTN} onClick={onClose}>
            {t("notes.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
