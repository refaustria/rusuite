// The remote file browser of File › Open and File › Save As (P8-36): breadcrumbs, a folder tree, the folder's
// entries (name, size, modified; 32 px rows; filtered by the app's extensions), New folder, Rename, Delete (with a
// confirmation) and Refresh. Keyboard: ↑/↓/Home/End select, Enter opens a folder or the file, Backspace goes up,
// F2 renames, Delete deletes. Save As adds the file name box and warns before replacing a file.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Dialog } from "../../Dialog";
import { FOCUS_RING } from "../../Popover";
import { RibbonIcon } from "../../ribbon/icons";
import { useT } from "../../i18n/react";
import type { Connection, Entry } from "../provider";
import { toConnectorError } from "../provider";
import { ancestors, baseName, hasExtension, joinPath, parentPath, splitExt } from "../paths";
import type { Connectors } from "../controller";
import { helpFor } from "../controller";
import { BUTTON, formatModified, formatSize, INPUT, PRIMARY } from "./hooks";

export interface FileBrowserProps {
  connectors: Connectors;
  connection: Connection;
  mode: "open" | "save";
  /** Save As: the proposed file name. */
  defaultName?: string;
  /** Open: a file was chosen. */
  onOpen?: (path: string) => void | Promise<unknown>;
  /** Save As: write to `path` (the overwrite question was answered). */
  onSave?: (path: string) => void | Promise<unknown>;
  onEdit?: () => void;
  onRemove?: () => void;
}

/** Folders first, then by name (natural, case-insensitive). */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** The entries shown: folders and the app's files (all files with `all`). */
export function visibleEntries(entries: Entry[], extensions: readonly string[], all: boolean): Entry[] {
  return sortEntries(entries.filter((e) => e.kind === "folder" || all || hasExtension(e.name, extensions)));
}

/** The Save As name with the app's extension (`Budget` → `Budget.xlsx`; another extension is kept). */
export function saveName(name: string, extensions: readonly string[]): string {
  const n = name.trim();
  const ext = extensions[0] ?? "";
  if (!ext || n === "") return n;
  return splitExt(n)[1] === "" ? `${n}${ext}` : n;
}

type Edit = { kind: "rename"; entry: Entry; value: string } | { kind: "newFolder"; value: string } | null;

export function FileBrowser({ connectors, connection, mode, defaultName = "", onOpen, onSave, onEdit, onRemove }: FileBrowserProps) {
  const t = useT();
  const id = connection.id;
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<{ text: string; help?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<Edit>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete"; entry: Entry } | { kind: "overwrite"; path: string } | { kind: "remove" } | null>(null);
  const [name, setName] = useState(defaultName);
  const [tree, setTree] = useState<Map<string, string[]>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["/"]));
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);

  const fail = useCallback(
    (e: unknown) => {
      const err = toConnectorError(e);
      setError({ text: connectors.describe(err), help: helpFor(err) });
    },
    [connectors],
  );

  const load = useCallback(
    async (p: string, keepSel = false) => {
      const req = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const list = await connectors.list(id, p);
        if (req !== reqRef.current) return;
        setPath(p);
        setEntries(list);
        if (!keepSel) setSel(0);
        setTree((old) => new Map(old).set(p, sortEntries(list.filter((e) => e.kind === "folder")).map((e) => e.path)));
        setExpanded((old) => new Set([...old, ...ancestors(p)]));
      } catch (e) {
        if (req !== reqRef.current) return;
        fail(e);
      } finally {
        if (req === reqRef.current) setLoading(false);
      }
    },
    [connectors, id, fail],
  );

  useEffect(() => {
    setTree(new Map());
    setEntries(null);
    void load("/");
  }, [load]);

  const shown = entries ? visibleEntries(entries, connectors.extensions, all) : [];
  const current = shown[Math.min(sel, shown.length - 1)] as Entry | undefined;

  const activate = (e: Entry | undefined) => {
    if (!e) return;
    if (e.kind === "folder") void load(e.path);
    else if (mode === "open") void onOpen?.(e.path);
    else setName(e.name);
  };

  const act = async (fn: () => Promise<unknown>, reloadAfter = true) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (reloadAfter) await load(path, true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Enter commits and moves the focus, whose blur must not commit again.
  const editRef = useRef<Edit>(null);
  editRef.current = edit;
  const commitEdit = () => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    const value = e.value.trim();
    setEdit(null);
    if (!value) return;
    if (e.kind === "newFolder") void act(() => connectors.run(id, (p) => p.mkdir(joinPath(path, value))));
    else if (value !== e.entry.name) void act(() => connectors.run(id, (p) => p.rename(e.entry.path, joinPath(parentPath(e.entry.path), value))));
    listRef.current?.focus();
  };

  const save = () => {
    const n = saveName(name, connectors.extensions);
    if (!n || n.includes("/")) return;
    const target = joinPath(path, n);
    const exists = (entries ?? []).find((e) => e.name.toLowerCase() === n.toLowerCase());
    if (exists?.kind === "folder") {
      setError({ text: t("conn.browser.isFolder", { name: n }) });
      return;
    }
    if (exists) setConfirm({ kind: "overwrite", path: exists.path });
    else void act(async () => onSave?.(target), false);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit) return;
    const last = shown.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setSel(Math.max(0, Math.min(last, i)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(sel + 1);
      case "ArrowUp":
        return move(sel - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(sel + 10);
      case "PageUp":
        return move(sel - 10);
      case "Enter":
        e.preventDefault();
        return activate(current);
      case "Backspace":
        e.preventDefault();
        if (path !== "/") void load(parentPath(path));
        return;
      case "F2":
        e.preventDefault();
        if (current) setEdit({ kind: "rename", entry: current, value: current.name });
        return;
      case "Delete":
        e.preventDefault();
        if (current) setConfirm({ kind: "delete", entry: current });
        return;
    }
  };

  // Keep the selected row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [sel]);

  const treeNode = (p: string, depth: number): JSX.Element => {
    const kids = tree.get(p);
    const open = expanded.has(p);
    return (
      <li key={p}>
        <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            aria-label={open ? t("conn.browser.collapse") : t("conn.browser.expand")}
            className={`flex h-8 w-6 shrink-0 items-center justify-center text-ui-muted ${FOCUS_RING}`}
            tabIndex={-1}
            onClick={() => {
              setExpanded((old) => {
                const next = new Set(old);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              });
              if (!kids) void connectors.list(id, p).then((list) => setTree((old) => new Map(old).set(p, sortEntries(list.filter((e) => e.kind === "folder")).map((e) => e.path)))).catch(fail);
            }}
          >
            <RibbonIcon name={open ? "chevronDown" : "chevronRight"} size={12} />
          </button>
          <button
            type="button"
            aria-current={p === path ? "true" : undefined}
            className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left text-sm hover:bg-ui-hover ${p === path ? "bg-ui-active font-medium" : ""} ${FOCUS_RING}`}
            onClick={() => void load(p)}
          >
            <RibbonIcon name={p === "/" ? "cloud" : "folder"} />
            <span className="truncate">{p === "/" ? connection.name : baseName(p)}</span>
          </button>
        </div>
        {open && kids && kids.length > 0 && <ul>{kids.map((k) => treeNode(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" aria-label={connection.name} data-testid="file-browser">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex min-w-0 items-center gap-2 text-lg font-semibold">
          <RibbonIcon name="cloud" size={20} />
          <span className="truncate">{connection.name}</span>
          <span className="truncate text-xs font-normal text-ui-muted" title={connection.baseUrl}>
            {connection.baseUrl}
          </span>
        </h2>
        {onEdit && (
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={onEdit}>
            {t("conn.browser.edit")}
          </button>
        )}
        {onRemove && (
          <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => setConfirm({ kind: "remove" })}>
            {t("conn.browser.removeConnection")}
          </button>
        )}
      </div>
      <nav aria-label={t("conn.browser.breadcrumbs")} className="flex flex-wrap items-center gap-0.5 text-sm" data-testid="breadcrumbs">
        {ancestors(path).map((p, i, list) => (
          <span key={p} className="flex items-center">
            {i > 0 && <RibbonIcon name="chevronRight" size={12} />}
            <button
              type="button"
              aria-current={i === list.length - 1 ? "location" : undefined}
              className={`h-8 rounded px-1.5 hover:bg-ui-hover ${i === list.length - 1 ? "font-semibold" : ""} ${FOCUS_RING}`}
              onClick={() => void load(p)}
            >
              {p === "/" ? connection.name : baseName(p)}
            </button>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("conn.browser.tools")}>
        <button type="button" className={`${BUTTON} ${FOCUS_RING}`} disabled={busy} onClick={() => setEdit({ kind: "newFolder", value: t("conn.browser.newFolderName") })}>
          <RibbonIcon name="plus" />
          {t("conn.browser.newFolder")}
        </button>
        <button type="button" className={`${BUTTON} ${FOCUS_RING}`} disabled={!current || busy} onClick={() => current && setEdit({ kind: "rename", entry: current, value: current.name })}>
          <RibbonIcon name="rename" />
          {t("conn.browser.rename")}
        </button>
        <button type="button" className={`${BUTTON} ${FOCUS_RING}`} disabled={!current || busy} onClick={() => current && setConfirm({ kind: "delete", entry: current })}>
          <RibbonIcon name="trash" />
          {t("conn.browser.delete")}
        </button>
        <button type="button" className={`${BUTTON} ${FOCUS_RING}`} disabled={loading} onClick={() => void load(path, true)}>
          <RibbonIcon name="refresh" />
          {t("conn.browser.refresh")}
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t("conn.browser.allFiles")}
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-600/40 px-2 py-1.5 text-sm text-red-800 dark:text-red-300" data-testid="browser-error">
          {error.text}
          {error.help && (
            <>
              {" "}
              <a className="underline" href={error.help} target="_blank" rel="noreferrer noopener">
                {t("conn.help")}
              </a>
            </>
          )}
        </p>
      )}
      <div className="flex min-h-48 min-w-0 flex-1 gap-3">
        <ul className="hidden w-52 shrink-0 overflow-auto border-r border-ui-border pr-2 md:block" aria-label={t("conn.browser.tree")} data-testid="folder-tree">
          {treeNode("/", 0)}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="grid h-8 grid-cols-[minmax(0,1fr)_6rem_11rem] items-center gap-2 border-b border-ui-border px-2 text-xs text-ui-muted" aria-hidden="true">
            <span>{t("conn.browser.colName")}</span>
            <span className="text-right">{t("conn.browser.colSize")}</span>
            <span>{t("conn.browser.colModified")}</span>
          </div>
          <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label={t("conn.browser.files")}
            aria-activedescendant={current ? `fb-row-${sel}` : undefined}
            aria-busy={loading}
            data-testid="file-list"
            className={`min-h-0 flex-1 overflow-auto ${FOCUS_RING}`}
            onKeyDown={onListKey}
          >
            {edit?.kind === "newFolder" && (
              <div className="flex h-8 items-center gap-2 px-2">
                <RibbonIcon name="folder" />
                <input
                  autoFocus
                  aria-label={t("conn.browser.newFolderLabel")}
                  className={INPUT}
                  value={edit.value}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEdit(null);
                  }}
                  onBlur={commitEdit}
                />
              </div>
            )}
            {entries && shown.length === 0 && !edit && (
              <p className="px-2 py-3 text-sm text-ui-muted" data-testid="folder-empty">
                {t("conn.browser.empty")}
              </p>
            )}
            {shown.map((e, i) =>
              edit?.kind === "rename" && edit.entry.path === e.path ? (
                <div key={e.path} className="flex h-8 items-center gap-2 px-2">
                  <RibbonIcon name={e.kind === "folder" ? "folder" : "file"} />
                  <input
                    autoFocus
                    aria-label={t("conn.browser.renameLabel", { name: e.name })}
                    className={INPUT}
                    value={edit.value}
                    onFocus={(ev) => ev.currentTarget.setSelectionRange(0, splitExt(edit.value)[0].length)}
                    onChange={(ev) => setEdit({ ...edit, value: ev.target.value })}
                    onKeyDown={(ev) => {
                      ev.stopPropagation();
                      if (ev.key === "Enter") commitEdit();
                      if (ev.key === "Escape") setEdit(null);
                    }}
                    onBlur={commitEdit}
                  />
                </div>
              ) : (
                <div
                  key={e.path}
                  id={`fb-row-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === sel}
                  data-testid="file-entry"
                  data-kind={e.kind}
                  className={`grid h-8 cursor-default select-none grid-cols-[minmax(0,1fr)_6rem_11rem] items-center gap-2 rounded px-2 text-sm hover:bg-ui-hover ${i === sel ? "bg-ui-active" : ""}`}
                  onClick={() => {
                    setSel(i);
                    listRef.current?.focus();
                    if (e.kind === "folder") void load(e.path);
                    else if (mode === "save") setName(e.name);
                  }}
                  onDoubleClick={() => activate(e)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <RibbonIcon name={e.kind === "folder" ? "folder" : "file"} />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <span className="text-right text-xs text-ui-muted">{formatSize(e.size)}</span>
                  <span className="truncate text-xs text-ui-muted">{formatModified(e.modified)}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-ui-border pt-3">
        {mode === "save" ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label htmlFor="fb-save-name" className="shrink-0 text-sm">
              {t("conn.browser.fileName")}
            </label>
            <input id="fb-save-name" className={INPUT} value={name} data-autofocus onChange={(e) => setName(e.target.value)} />
            <button type="submit" className={`${PRIMARY} ${FOCUS_RING}`} disabled={busy || !name.trim() || entries === null}>
              <RibbonIcon name="save" />
              {t("conn.browser.save")}
            </button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-sm text-ui-muted">{current?.kind === "file" ? current.path : ""}</span>
            <button type="button" className={`${PRIMARY} ${FOCUS_RING}`} disabled={busy || current?.kind !== "file"} onClick={() => current && void act(async () => onOpen?.(current.path), false)}>
              <RibbonIcon name="open" />
              {t("conn.browser.open")}
            </button>
          </>
        )}
      </div>
      {confirm && (
        <Dialog
          open
          title={
            confirm.kind === "delete"
              ? t("conn.browser.deleteTitle")
              : confirm.kind === "overwrite"
                ? t("conn.browser.overwriteTitle")
                : t("conn.browser.removeTitle")
          }
          onClose={() => setConfirm(null)}
        >
          <p className="mb-4 max-w-md text-sm">
            {confirm.kind === "delete"
              ? t(confirm.entry.kind === "folder" ? "conn.browser.deleteFolderText" : "conn.browser.deleteText", { name: confirm.entry.name, connection: connection.name })
              : confirm.kind === "overwrite"
                ? t("conn.browser.overwriteText", { name: baseName(confirm.path), connection: connection.name })
                : t("conn.browser.removeText", { connection: connection.name })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${BUTTON} ${FOCUS_RING}`} onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={`${PRIMARY} ${FOCUS_RING}`}
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c.kind === "delete") void act(() => connectors.run(id, (p) => p.delete(c.entry.path)));
                else if (c.kind === "overwrite") void act(async () => onSave?.(c.path), false);
                else onRemove?.();
              }}
            >
              {confirm.kind === "delete" ? t("conn.browser.delete") : confirm.kind === "overwrite" ? t("conn.browser.replace") : t("conn.browser.removeConnection")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
