// Find and replace bar (Ctrl+F / Ctrl+H), non-modal so that the
// highlighted matches stay visible: typing highlights every match in the
// editor, Enter / Shift+Enter (or the arrows) move to the next / previous
// one. "Replace" replaces the current match through an editor transaction
// (→ `ReplaceText`); "Replace all" is the Rust `FindReplace` command (one
// undo step).
//
// More ▾ (P8-21, Word's Find and Replace › More): Use wildcards, and a
// Format ▾ menu for the Find and for the Replace field (Font…, Paragraph…,
// Style…, Highlight), No Formatting. With formatting or wildcards the
// matches come from Rust (`find` request: block id + char offsets, so the
// positions stay right for runs with formatting constraints); a replace
// format is applied to the replacement (empty replacement = formatting
// only).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { FindFormat } from "../generated/FindFormat";
import type { FindMatch as CoreMatch } from "../generated/FindMatch";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { WriteCommand } from "../generated/WriteCommand";
import { findState, findStep, replaceCurrent, setFindMatches, setFindQuery, type FindMatch } from "../features/find";
import type { WriteUi } from "../features/WriteFeatures";
import { charOffsetOf, findPos, pmOffsetOf, type SyncController } from "../sync/SyncPlugin";
import { getStyle, isParagraphKind, styleLabel } from "../features/styleCss";
import { describeFormat, FontDialog, StylePickDialog } from "./styleDialogs";
import { ParagraphDialog, type ParagraphValues } from "./dialogs";
import { t, useT } from "../i18n";

const INPUT = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40";

/** "3 of 12" / "No results" for the match counter. */
export function matchLabel(current: number, total: number, query: string): string {
  if (!query) return "";
  if (!total) return t("write.find.none");
  return current >= 0 ? t("write.find.nOfM", { n: current + 1, total }) : t("write.find.results", { count: total });
}

export const isEmptyFormat = (f: FindFormat | null | undefined): boolean =>
  !f || ((!f.run || Object.keys(f.run).length === 0) && (!f.paragraph || Object.keys(f.paragraph).length === 0) && !f.style && f.highlight == null);

/** Word's format line under a field ("Format: Bold, Style: Heading 1, Highlight"). */
export function formatSummary(f: FindFormat | null, styleName: (id: string) => string): string {
  if (!f || isEmptyFormat(f)) return "";
  const parts: string[] = [];
  const d = describeFormat(f.run ?? {}, f.paragraph ?? null, t);
  if (d) parts.push(d);
  if (f.run?.bold === false) parts.push(t("write.find.notBold"));
  if (f.run?.italic === false) parts.push(t("write.find.notItalic"));
  if (f.style) parts.push(`${t("write.find.styleLabel")}: ${styleName(f.style)}`);
  if (f.highlight === true) parts.push(t("write.find.highlight"));
  if (f.highlight === false) parts.push(t("write.find.notHighlight"));
  return `${t("write.find.formatLabel")}: ${parts.join(", ")}`;
}

/** The commands that format `[from, to)` of `block` with a replace format. */
export function formatCommands(block: number, from: number, to: number, f: FindFormat, styleKind: (id: string) => string | null): WriteCommand[] {
  const cmds: WriteCommand[] = [];
  const run: RunProperties = { ...(f.run ?? {}) };
  if (f.highlight === true && !run.highlight) run.highlight = { kind: "rgb", value: "FFFF00" };
  if (f.highlight === false) run.highlight = { kind: "auto" };
  if (Object.keys(run).length && to > from) cmds.push({ type: "setRunProps", block, from, to, patch: run });
  if (f.style) {
    const kind = styleKind(f.style);
    if (kind === "character" && to > from) cmds.push({ type: "applyCharacterStyle", block, from, to, style: f.style });
    else if (kind === "paragraph" || kind === "linked") cmds.push({ type: "setStyle", blocks: [block], style: f.style });
  }
  if (f.paragraph && Object.keys(f.paragraph).length) cmds.push({ type: "setParagraphProps", blocks: [block], patch: f.paragraph });
  return cmds;
}

/** PM positions of Rust matches in the current editor document (unknown blocks dropped). */
export function toPmMatches(editor: Editor, matches: CoreMatch[]): { pm: FindMatch[]; core: CoreMatch[] } {
  const pm: FindMatch[] = [];
  const core: CoreMatch[] = [];
  for (const m of matches) {
    const pos = findPos(editor.state.doc, m.block);
    const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
    if (!node?.isTextblock) continue;
    pm.push({ from: pos + 1 + pmOffsetOf(node, m.from), to: pos + 1 + pmOffsetOf(node, m.to) });
    core.push(m);
  }
  return { pm, core };
}

/** Only the paragraph fields the user changed in the Paragraph dialog (Find › Format › Paragraph…). */
export function paragraphDiff(before: ParagraphValues, after: ParagraphValues): ParagraphProperties {
  const out: ParagraphProperties = {};
  if (after.alignment && after.alignment !== (before.alignment ?? "left")) out.alignment = after.alignment;
  const sp: NonNullable<ParagraphProperties["spacing"]> = {};
  if ((after.spacing.before ?? 0) !== (before.spacing.before ?? 0)) sp.before = after.spacing.before;
  if ((after.spacing.after ?? 0) !== (before.spacing.after ?? 0)) sp.after = after.spacing.after;
  const single = JSON.stringify({ kind: "multiple", value: 1 });
  if (JSON.stringify(after.spacing.line ?? { kind: "multiple", value: 1 }) !== (before.spacing.line ? JSON.stringify(before.spacing.line) : single)) sp.line = after.spacing.line;
  if (Object.keys(sp).length) out.spacing = sp;
  const ind: NonNullable<ParagraphProperties["indent"]> = {};
  if ((after.indent.left ?? 0) !== (before.indent.left ?? 0)) ind.left = after.indent.left;
  if ((after.indent.right ?? 0) !== (before.indent.right ?? 0)) ind.right = after.indent.right;
  if (Object.keys(ind).length) out.indent = ind;
  return out;
}

const NO_PARAGRAPH: ParagraphValues = { alignment: null, indent: {}, spacing: {} };

type Target = "find" | "replace";

export function FindBar({ ctl, editor, ui }: { ctl: SyncController; editor: Editor | null; ui: WriteUi }) {
  const tr = useT();
  const find = useSyncExternalStore(ui.subscribe, () => ui.getState().find);
  const sheet = useSyncExternalStore(ctl.subscribe, () => ctl.styles);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [wildcards, setWildcards] = useState(false);
  const [more, setMore] = useState(false);
  const [findFormat, setFindFormat] = useState<FindFormat | null>(null);
  const [replaceFormat, setReplaceFormat] = useState<FindFormat | null>(null);
  const [formatMenu, setFormatMenu] = useState<Target | null>(null);
  const [sub, setSub] = useState<{ target: Target; kind: "font" | "paragraph" | "style" } | null>(null);
  const [showReplace, setShowReplace] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const coreMatches = useRef<CoreMatch[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const advanced = wildcards || !isEmptyFormat(findFormat);
  const query = useMemo(
    () => ({ text, matchCase: wildcards ? true : matchCase, wholeWord: wildcards ? false : wholeWord, wildcards, ...(isEmptyFormat(findFormat) ? {} : { format: findFormat! }) }),
    [text, matchCase, wholeWord, wildcards, findFormat],
  );
  const hasQuery = !!text || !isEmptyFormat(findFormat);

  // Opening (Ctrl+F / Ctrl+H): seed with the selected text, focus the field.
  useEffect(() => {
    if (!find.open) return;
    setShowReplace((r) => r || find.replace);
    setResult(null);
    if (editor) {
      const { from, to, empty } = editor.state.selection;
      const sel = empty ? "" : editor.state.doc.textBetween(from, to, " ");
      if (sel && !sel.includes("\n") && sel.length < 200) setText(sel);
    }
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
  }, [find.open, find.seed, find.replace, editor]);

  // Highlighting follows the query; closing clears it. Advanced queries ask Rust (again after edits).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!find.open || !hasQuery) {
      setFindQuery(editor.view, null);
      return;
    }
    if (!advanced) {
      setFindQuery(editor.view, { text, matchCase, wholeWord });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      await ctl.idle();
      try {
        const reply = await ctl.api.find(query);
        if (cancelled || editor.isDestroyed) return;
        const { pm, core } = toPmMatches(editor, reply.matches);
        coreMatches.current = core;
        setFindMatches(editor.view, pm);
        setResult(null);
      } catch (e) {
        if (cancelled || editor.isDestroyed) return;
        coreMatches.current = [];
        setFindMatches(editor.view, []);
        setResult(e instanceof Error ? e.message : String(e));
      }
    };
    void ask();
    const on = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(() => void ask(), 200);
    };
    editor.on("transaction", on);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      editor.off("transaction", on);
    };
  }, [editor, ctl, find.open, hasQuery, advanced, text, matchCase, wholeWord, query]);

  // Re-render the counter on editor changes.
  useEffect(() => {
    if (!editor || !find.open) return;
    const on = () => setTick((n) => n + 1);
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor, find.open]);

  if (!find.open) return null;
  const st = editor && !editor.isDestroyed ? findState(editor.state) : null;
  const total = st?.matches.length ?? 0;
  const styleName = (id: string) => {
    const s = getStyle(sheet, id);
    return s ? styleLabel(s) : id;
  };
  const styleKind = (id: string) => getStyle(sheet, id)?.kind ?? null;
  const close = () => {
    ui.closeFind();
    editor?.commands.focus();
  };
  const step = (dir: 1 | -1) => {
    if (editor) findStep(editor.view, dir);
  };
  const withReplaceFormat = !isEmptyFormat(replaceFormat);
  const replaceAll = async () => {
    setResult(null);
    await ctl.run({
      type: "findReplace",
      find: text,
      replace,
      matchCase: query.matchCase,
      wholeWord: query.wholeWord,
      all: true,
      ...(wildcards ? { wildcards: true } : {}),
      ...(query.format ? { format: query.format } : {}),
      ...(withReplaceFormat ? { replaceFormat: replaceFormat! } : {}),
    });
    setResult(ctl.getState().info);
  };
  const replaceOne = async () => {
    if (!editor) return;
    if (!advanced && !withReplaceFormat) {
      replaceCurrent(editor.view, replace);
      return;
    }
    const cur = st?.current ?? -1;
    const sel = editor.state.selection;
    const m = st?.matches[cur];
    if (!m || sel.from !== m.from || sel.to !== m.to) {
      step(1);
      return;
    }
    // The match as Rust knows it: from the advanced result, else from the PM position.
    let core = advanced ? coreMatches.current[cur] : undefined;
    if (!core) {
      const $p = editor.state.doc.resolve(m.from);
      const $e = editor.state.doc.resolve(m.to);
      const block = $p.parent.attrs.id as number | null;
      if (block == null) return;
      core = { block, from: charOffsetOf($p.parent, $p.parentOffset), to: charOffsetOf($e.parent, $e.parentOffset) };
    }
    const cmds: WriteCommand[] = [];
    let end = core.to;
    if (replace || !withReplaceFormat) {
      cmds.push({ type: "replaceText", block: core.block, from: core.from, to: core.to, text: replace });
      end = core.from + [...replace].length;
    }
    if (withReplaceFormat) cmds.push(...formatCommands(core.block, core.from, end, replaceFormat!, styleKind));
    if (cmds.length) await ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
    step(1);
  };
  const formatOf = (target: Target) => (target === "find" ? findFormat : replaceFormat);
  const setFormat = (target: Target, f: FindFormat | null) => (target === "find" ? setFindFormat(f) : setReplaceFormat(f));
  const patchFormat = (target: Target, patch: Partial<FindFormat>) => {
    const next: FindFormat = { ...(formatOf(target) ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof FindFormat)[]) if (next[k] === undefined) delete next[k];
    setFormat(target, isEmptyFormat(next) ? null : next);
  };
  // Word: Highlight → Not Highlight → (none).
  const cycleHighlight = (target: Target) => {
    const h = formatOf(target)?.highlight;
    patchFormat(target, { highlight: h === undefined || h === null ? true : h ? false : undefined });
  };
  const formatButton = (target: Target) => (
    <span className="relative shrink-0">
      <button
        type="button"
        className={`${BUTTON} whitespace-nowrap`}
        aria-haspopup="menu"
        aria-expanded={formatMenu === target}
        aria-label={target === "find" ? tr("write.find.findFormat") : tr("write.find.replaceFormat")}
        onClick={() => setFormatMenu(formatMenu === target ? null : target)}
      >
        {tr("write.find.format")} ▾
      </button>
      {formatMenu === target && (
        <span role="menu" aria-label={tr("write.find.format")} className="absolute right-0 top-8 z-40 flex w-40 flex-col rounded border border-ui-border bg-ui-panel py-1 shadow-lg">
          {(["font", "paragraph", "style"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="min-h-8 px-3 text-left hover:bg-ui-hover"
              onClick={() => {
                setFormatMenu(null);
                setSub({ target, kind });
              }}
            >
              {tr(`write.find.format.${kind}`)}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="min-h-8 px-3 text-left hover:bg-ui-hover"
            onClick={() => {
              setFormatMenu(null);
              cycleHighlight(target);
            }}
          >
            {tr("write.find.highlight")}
          </button>
        </span>
      )}
    </span>
  );
  const summary = (target: Target) => {
    const s = formatSummary(formatOf(target), styleName);
    return s ? (
      <p className="text-xs text-ui-muted" data-testid={`${target}-format`}>
        {s}
      </p>
    ) : null;
  };

  return (
    <div
      role="dialog"
      aria-label={tr("cmd.findReplace")}
      className="fixed right-6 top-[100px] z-30 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-ui-border bg-ui-panel p-3 text-sm text-ui-fg shadow-xl"
      data-testid="find-bar"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (formatMenu) setFormatMenu(null);
          else close();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={input}
          aria-label={tr("cmd.find")}
          className={INPUT}
          placeholder={tr("write.find.search")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <button type="button" className={BUTTON} aria-label={tr("write.find.prevMatch")} title={tr("write.find.prevTip")} disabled={!total} onClick={() => step(-1)}>
          ↑
        </button>
        <button type="button" className={BUTTON} aria-label={tr("write.find.nextMatch")} title={tr("write.find.nextTip")} disabled={!total} onClick={() => step(1)}>
          ↓
        </button>
      </div>
      {summary("find")}
      <div className="flex items-center justify-between text-xs text-ui-muted">
        <span data-testid="match-count">{matchLabel(st?.current ?? -1, total, hasQuery ? text || "·" : "")}</span>
        <span className="flex gap-3">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={wildcards || matchCase} disabled={wildcards} onChange={(e) => setMatchCase(e.target.checked)} /> {tr("write.find.matchCase")}
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!wildcards && wholeWord} disabled={wildcards} onChange={(e) => setWholeWord(e.target.checked)} /> {tr("write.find.wholeWords")}
          </label>
        </span>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className={BUTTON} aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? tr("write.find.less") : tr("write.find.more")} {more ? "▴" : "▾"}
        </button>
        {more && (
          <span className="flex items-center gap-1">
            {formatButton("find")}
            <button type="button" className={BUTTON} disabled={isEmptyFormat(findFormat)} onClick={() => setFindFormat(null)}>
              {tr("write.find.noFormatting")}
            </button>
          </span>
        )}
      </div>
      {more && (
        <div className="flex items-center justify-between gap-2 rounded border border-ui-border p-2 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={wildcards} onChange={(e) => setWildcards(e.target.checked)} /> {tr("write.find.wildcards")}
          </label>
          <button type="button" className={BUTTON} disabled={!hasQuery} onClick={() => setResult(tr("write.find.foundAll", { count: total }))}>
            {tr("write.find.findAll")}
          </button>
        </div>
      )}
      {showReplace ? (
        <>
          <div className="flex items-center gap-1">
            <input aria-label={tr("write.find.replaceWith")} className={INPUT} placeholder={tr("write.find.replaceWith")} value={replace} onChange={(e) => setReplace(e.target.value)} />
            {more && formatButton("replace")}
            {more && (
              <button type="button" className={BUTTON} aria-label={tr("write.find.noReplaceFormatting")} title={tr("write.find.noReplaceFormatting")} disabled={!withReplaceFormat} onClick={() => setReplaceFormat(null)}>
                ⊘
              </button>
            )}
          </div>
          {summary("replace")}
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON} disabled={!hasQuery || !total} onClick={() => void replaceOne()}>
              {tr("cmd.replace")}
            </button>
            <button type="button" className={BUTTON} disabled={!hasQuery} onClick={() => void replaceAll()}>
              {tr("write.find.replaceAll")}
            </button>
            <button type="button" className={BUTTON} onClick={close}>
              {tr("common.close")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={() => setShowReplace(true)}>
            {tr("cmd.replaceDots")}
          </button>
          <button type="button" className={BUTTON} onClick={close}>
            {tr("common.close")}
          </button>
        </div>
      )}
      <p role="status" className="min-h-4 text-xs text-ui-muted">
        {result}
      </p>
      <FontDialog
        open={sub?.kind === "font"}
        initial={(sub && formatOf(sub.target)?.run) || {}}
        allowUnset
        onClose={() => setSub(null)}
        onSubmit={(run) => {
          if (sub) patchFormat(sub.target, { run: Object.keys(run).length ? run : undefined });
          setSub(null);
        }}
      />
      <ParagraphDialog
        open={sub?.kind === "paragraph"}
        initial={NO_PARAGRAPH}
        onClose={() => setSub(null)}
        onSubmit={(v) => {
          const p = paragraphDiff(NO_PARAGRAPH, v);
          if (sub) patchFormat(sub.target, { paragraph: Object.keys(p).length ? p : undefined });
          setSub(null);
        }}
      />
      <StylePickDialog
        open={sub?.kind === "style"}
        sheet={sheet}
        initial={sub ? formatOf(sub.target)?.style : null}
        onClose={() => setSub(null)}
        onSubmit={(id) => {
          const s = getStyle(sheet, id);
          if (sub) patchFormat(sub.target, { style: s && (s.kind === "character" || isParagraphKind(s.kind)) ? s.id : undefined });
          setSub(null);
        }}
      />
    </div>
  );
}
