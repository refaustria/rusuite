// Review › Comments in the document view: balloons in the right margin
// aligned to their text (connector line to the selected one), margin
// indicators when comments are hidden, the Comments pane (narrow windows
// or Review › Comments Pane) with its filter, thread cards (avatar,
// author, relative date, text, inline reply box, resolve / reopen, edit
// one's own text, delete), the draft card of New Comment and the user
// name dialog.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog } from "@rusuite/ui-shared";
import type { Comment } from "../generated/Comment";
import type { SyncController } from "../sync/SyncPlugin";
import type { CommentsUiState, WriteFeatures } from "../features/WriteFeatures";
import { useT } from "../i18n";
import { addComment, deleteComment, editComment, pointAt, replyComment, resolveComment, revealComment } from "./commands";
import {
  authorColor,
  commentText,
  filterThreads,
  fullDate,
  initialsOf,
  layoutBalloons,
  relativeDate,
  saveUser,
  threads,
  type CommentFilter,
  type PmRange,
  type Thread,
} from "./model";
import { commentRangesOf } from "./plugin";

/** Below this window width the Comments pane replaces the balloons (Word's narrow layout). */
export const NARROW_WIDTH = 1200;
const BALLOON_WIDTH = 264;
const INDICATOR_WIDTH = 40;

export type CommentsMode = "balloons" | "pane" | "indicators" | "none";

const BUTTON =
  "inline-flex min-h-8 min-w-8 items-center justify-center rounded px-2 text-xs hover:bg-ui-hover disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus";
const PRIMARY =
  "inline-flex min-h-8 items-center justify-center rounded bg-[#2b579a] px-3 text-xs font-medium text-white hover:bg-[#244a84] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus";
const TEXTAREA = "w-full resize-none rounded border border-ui-border bg-ui-bg p-1.5 text-sm text-ui-fg focus:outline-none focus:ring-2 focus:ring-ui-focus";

function useCommentsUi(features: WriteFeatures): CommentsUiState {
  return useSyncExternalStore(features.ui.subscribe, () => features.ui.getState().comments);
}

function useComments(ctl: SyncController): Comment[] {
  return useSyncExternalStore(ctl.subscribe, () => ctl.comments);
}

function useUser(ctl: SyncController) {
  return useSyncExternalStore(ctl.subscribe, () => ctl.user);
}

function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1600 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Balloons when shown on a wide window, the pane when narrow (or asked for), indicators when hidden. */
export function commentsMode(ui: CommentsUiState, count: number, width: number): CommentsMode {
  if (count === 0 && !ui.draft) return ui.pane && ui.show ? "pane" : "none";
  if (!ui.show) return "indicators";
  return ui.pane || width < NARROW_WIDTH ? "pane" : "balloons";
}

export function useCommentsMode(features: WriteFeatures, ctl: SyncController): CommentsMode {
  const ui = useCommentsUi(features);
  const comments = useComments(ctl);
  return commentsMode(ui, comments.length, useWindowWidth());
}

const rangesKey = (rs: PmRange[]) => rs.map((r) => `${r.id}:${r.start}:${r.end}`).join(",");

/** The comment ranges of the editor document (the plugin's), updated when they change. */
function useRanges(editor: Editor): PmRange[] {
  const [ranges, setRanges] = useState(() => commentRangesOf(editor.state));
  useEffect(() => {
    const update = () => {
      const next = commentRangesOf(editor.state);
      setRanges((prev) => (rangesKey(prev) === rangesKey(next) ? prev : next));
    };
    const on = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) update();
    };
    update();
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);
  return ranges;
}

/** Keeps a draft's range on its text while the document changes. */
function useDraftMapping(editor: Editor, features: WriteFeatures): void {
  useEffect(() => {
    const on = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number, a?: number) => number } } }) => {
      const d = features.ui.getState().comments.draft;
      if (!d || !transaction.docChanged) return;
      const from = transaction.mapping.map(d.from, -1);
      const to = Math.max(from, transaction.mapping.map(d.to, 1));
      const start = pointAt(editor.state, from);
      const end = pointAt(editor.state, to);
      features.ui.setComments({ draft: start && end ? { from, to, start, end } : null });
    };
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor, features]);
}

// ----- small parts ------------------------------------------------------------------

export function Avatar({ name, initials, size = 28 }: { name: string; initials?: string; size?: number }) {
  const c = authorColor(name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: c.dark, fontSize: size * 0.4 }}
    >
      {(initials || initialsOf(name) || "?").slice(0, 3)}
    </span>
  );
}

function Header({ c, children }: { c: Comment; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar name={c.author} initials={c.initials} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-semibold" data-testid="comment-author">
          {c.author}
        </span>
        <time className="text-[11px] text-ui-muted" dateTime={c.date ?? undefined} title={fullDate(c.date)} data-testid="comment-date">
          {relativeDate(c.date)}
        </time>
      </div>
      {children}
    </div>
  );
}

/** A text box posting with Ctrl+Enter, cancelling with Esc. */
function Composer({
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  testId,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId: string;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSubmit(v);
    setText("");
  };
  return (
    <div className="mt-1.5 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        rows={text ? Math.min(6, text.split("\n").length + 1) : 2}
        className={TEXTAREA}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="flex justify-end gap-1">
        {onCancel && (
          <button type="button" className={BUTTON} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button type="button" className={PRIMARY} disabled={!text.trim()} title={t("write.comments.postTip")} data-testid={`${testId}-post`} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

// ----- thread card --------------------------------------------------------------------

interface CardProps {
  thread: Thread;
  editor: Editor;
  ctl: SyncController;
  features: WriteFeatures;
  active: boolean;
}

function CommentBody({ c, card, own }: { c: Comment; card: CardProps; own: boolean }) {
  const t = useT();
  const ui = useCommentsUi(card.features);
  const editing = ui.editing === c.id;
  if (editing) {
    return (
      <Composer
        initial={commentText(c)}
        placeholder={t("write.comments.edit")}
        submitLabel={t("write.comments.save")}
        autoFocus
        testId="comment-edit"
        onSubmit={(text) => {
          card.features.ui.setComments({ editing: null });
          void editComment(card.ctl, c.id, text);
        }}
        onCancel={() => card.features.ui.setComments({ editing: null })}
      />
    );
  }
  return (
    <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${own ? "" : ""}`} data-testid="comment-text">
      {commentText(c)}
    </p>
  );
}

function ThreadCard(props: CardProps) {
  const { thread, ctl, features, active, editor } = props;
  const t = useT();
  const user = useUser(ctl);
  const { root, replies } = thread;
  const resolved = !!root.resolved;
  const color = authorColor(root.author);
  const own = (c: Comment) => !!user && c.author === user.name;
  const activate = () => {
    if (!active) features.ui.setComments({ active: root.id });
  };
  return (
    <article
      aria-label={t("write.comments.thread", { author: root.author })}
      data-testid="comment-thread"
      data-comment-id={root.id}
      data-resolved={resolved ? "true" : undefined}
      data-active={active ? "true" : undefined}
      className={`rounded-md border bg-ui-panel p-2 text-ui-fg shadow-sm transition-shadow ${active ? "border-ui-focus shadow-md" : "border-ui-border"} ${resolved ? "opacity-70" : ""}`}
      style={{ borderLeft: `4px solid ${active ? color.dark : color.light}` }}
      onPointerDown={activate}
      onPointerEnter={() => features.ui.setComments({ hover: root.id })}
      onPointerLeave={() => features.ui.getState().comments.hover === root.id && features.ui.setComments({ hover: null })}
      onFocus={activate}
    >
      <Header c={root}>
        {resolved && (
          <span className="rounded bg-ui-hover px-1.5 py-0.5 text-[10px] font-medium text-ui-muted" data-testid="comment-resolved">
            {t("write.comments.resolved")}
          </span>
        )}
        <button
          type="button"
          className={BUTTON}
          aria-pressed={resolved}
          title={resolved ? t("write.comments.reopen") : t("write.comments.resolve")}
          aria-label={resolved ? t("write.comments.reopen") : t("write.comments.resolve")}
          data-testid="comment-resolve"
          onClick={() => void resolveComment(ctl, root.id, !resolved)}
        >
          {resolved ? REOPEN_ICON : RESOLVE_ICON}
        </button>
      </Header>
      <CommentBody c={root} card={props} own={own(root)} />
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-t border-ui-border pt-2" data-testid="comment-reply" data-comment-id={r.id}>
          <Header c={r} />
          <CommentBody c={r} card={props} own={own(r)} />
          {active && (
            <div className="mt-0.5 flex justify-end gap-1">
              {own(r) && (
                <button type="button" className={BUTTON} onClick={() => features.ui.setComments({ editing: r.id })}>
                  {t("write.comments.edit")}
                </button>
              )}
              <button type="button" className={BUTTON} data-testid="comment-delete-reply" onClick={() => void deleteComment(ctl, r.id)}>
                {t("write.comments.deleteReply")}
              </button>
            </div>
          )}
        </div>
      ))}
      {active && (
        <>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {own(root) && (
              <button type="button" className={BUTTON} data-testid="comment-edit-button" onClick={() => features.ui.setComments({ editing: root.id })}>
                {t("write.comments.edit")}
              </button>
            )}
            <button
              type="button"
              className={BUTTON}
              data-testid="comment-delete"
              onClick={() => {
                features.ui.setComments({ active: null });
                void deleteComment(ctl, root.id).then(() => editor.commands.focus());
              }}
            >
              {t("write.comments.deleteThread")}
            </button>
          </div>
          {!resolved && (
            <Composer
              placeholder={t("write.comments.replyPlaceholder")}
              submitLabel={t("write.comments.reply")}
              testId="comment-reply-box"
              onSubmit={(text) => void replyComment(ctl, root.id, text)}
            />
          )}
        </>
      )}
      {!active && replies.length > 0 && <span className="sr-only">{t("write.comments.replies", { count: replies.length })}</span>}
    </article>
  );
}

/** The card of a comment being written (New Comment). */
function DraftCard({ ctl, features, editor }: { ctl: SyncController; features: WriteFeatures; editor: Editor }) {
  const t = useT();
  const ui = useCommentsUi(features);
  const user = useUser(ctl);
  const draft = ui.draft;
  if (!draft) return null;
  // Without a user name the document's author writes the comment (the core does the same).
  const name = user?.name ?? ctl.properties.author ?? "";
  return (
    <article
      className="rounded-md border border-ui-focus bg-ui-panel p-2 text-ui-fg shadow-md"
      data-testid="comment-draft"
      style={{ borderLeft: `4px solid ${authorColor(name).dark}` }}
    >
      <div className="flex items-center gap-2">
        <Avatar name={name} initials={user?.initials} />
        <span className="text-xs font-semibold">{name}</span>
      </div>
      <Composer
        placeholder={t("write.comments.placeholder")}
        submitLabel={t("write.comments.post")}
        autoFocus
        testId="comment-draft-text"
        onCancel={() => {
          features.ui.setComments({ draft: null });
          editor.commands.focus();
        }}
        onSubmit={(text) => {
          features.ui.setComments({ draft: null });
          void addComment(ctl, draft, text).then((id) => {
            if (id != null) features.ui.setComments({ active: id });
          });
        }}
      />
    </article>
  );
}

// ----- margin (balloons / indicators) ------------------------------------------------------

interface Anchor {
  x: number;
  y: number;
}

function sameTops(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || Math.abs(w - v) > 0.5) return false;
  }
  return true;
}

const DRAFT_ID = -1;

/**
 * The page with the comments margin: balloons (or indicators) placed next
 * to their anchors right of the page (which stays centered under the
 * ruler), plus a connector from the selected comment's text to its
 * balloon.
 */
export function CommentsFrame({ editor, ...rest }: { editor: Editor | null; ctl: SyncController; features: WriteFeatures; zoom: number; children: ReactNode }) {
  // The same wrapper with and without an editor / margin: the page below never remounts.
  if (!editor) {
    return (
      <div className="comments-frame relative mx-auto w-max max-w-full" data-testid="comments-frame" data-mode="none">
        {rest.children}
      </div>
    );
  }
  return <CommentsFrameWith editor={editor} {...rest} />;
}

function CommentsFrameWith({ editor, ctl, features, zoom, children }: { editor: Editor; ctl: SyncController; features: WriteFeatures; zoom: number; children: ReactNode }) {
  const t = useT();
  const ui = useCommentsUi(features);
  const comments = useComments(ctl);
  const mode = useCommentsMode(features, ctl);
  const ranges = useRanges(editor);
  useDraftMapping(editor, features);
  const frame = useRef<HTMLDivElement>(null);
  const margin = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Map<number, number>>(new Map());
  const [anchors, setAnchors] = useState<Map<number, Anchor>>(new Map());
  const [tick, setTick] = useState(0);
  const list = threads(
    comments,
    ranges.map((r) => r.id),
  ).filter((th) => ranges.some((r) => r.id === th.root.id));
  const showMargin = mode === "balloons" || mode === "indicators";

  const measure = useCallback(() => {
    const view = editor.view;
    const m = margin.current;
    const f = frame.current;
    if (!m || !f || editor.isDestroyed) return;
    const mr = m.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const z = zoom || 1;
    const next = new Map<number, Anchor>();
    const at = (pos: number): Anchor | null => {
      try {
        const c = view.coordsAtPos(Math.min(pos, view.state.doc.content.size));
        return { x: (c.left - fr.left) / z, y: (c.top - mr.top) / z };
      } catch {
        return null;
      }
    };
    for (const r of ranges) {
      const a = at(r.start + 1);
      if (a) next.set(r.id, a);
    }
    const d = features.ui.getState().comments.draft;
    if (d) {
      const a = at(d.from);
      if (a) next.set(DRAFT_ID, a);
    }
    const heights = new Map<number, number>();
    m.querySelectorAll<HTMLElement>("[data-balloon-id]").forEach((el) => heights.set(Number(el.dataset.balloonId), el.offsetHeight / 1));
    const boxes = [...next.entries()]
      .filter(([id]) => id === DRAFT_ID || list.some((th) => th.root.id === id))
      .map(([id, a]) => ({ id, anchor: a.y, height: mode === "balloons" ? (heights.get(id) ?? 72) : 24 }));
    const active = d ? DRAFT_ID : features.ui.getState().comments.active;
    const laid = layoutBalloons(boxes, mode === "balloons" ? 8 : 2, active);
    setTops((prev) => (sameTops(prev, laid) ? prev : laid));
    setAnchors((prev) => {
      const same = prev.size === next.size && [...next].every(([k, v]) => prev.get(k)?.x === v.x && prev.get(k)?.y === v.y);
      return same ? prev : next;
    });
  }, [editor, ranges, features, zoom, list, mode]);

  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    if (!showMargin) return;
    measure();
    // Balloons changing height (reply box, editing) re-run the layout.
    const ro = observer.current;
    margin.current?.querySelectorAll("[data-balloon-id]").forEach((el) => {
      if (ro && !observed.current.has(el)) {
        observed.current.add(el);
        ro.observe(el);
      }
    });
  });
  useEffect(() => {
    if (!showMargin) return;
    let frameId = 0;
    const schedule = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => setTick((n) => n + 1));
    };
    editor.on("transaction", schedule);
    window.addEventListener("resize", schedule);
    observer.current = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observed.current = new WeakSet();
    if (observer.current && margin.current) observer.current.observe(margin.current);
    return () => {
      cancelAnimationFrame(frameId);
      editor.off("transaction", schedule);
      window.removeEventListener("resize", schedule);
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [editor, showMargin]);
  void tick;

  const lineFor = ui.draft ? DRAFT_ID : (ui.hover ?? ui.active);
  const lineAnchor = lineFor != null ? anchors.get(lineFor) : undefined;
  const lineTop = lineFor != null ? tops.get(lineFor) : undefined;
  const marginLeft = margin.current?.offsetLeft ?? 0;
  const marginTop = margin.current?.offsetTop ?? 0;
  return (
    <div ref={frame} className="comments-frame relative mx-auto w-max max-w-full" data-testid="comments-frame" data-mode={mode}>
      {children}
      {showMargin && (
        <div
          ref={margin}
          className="comments-margin absolute bottom-0 left-full top-0"
          style={{ width: mode === "balloons" ? BALLOON_WIDTH : INDICATOR_WIDTH }}
          data-testid="comments-margin"
          aria-label={t("write.comments.title")}
          role="complementary"
        >
          {mode === "balloons" && ui.draft && (
            <div data-balloon-id={DRAFT_ID} className="absolute left-3 right-2" style={{ top: tops.get(DRAFT_ID) ?? anchors.get(DRAFT_ID)?.y ?? 0 }}>
              <DraftCard ctl={ctl} features={features} editor={editor} />
            </div>
          )}
          {list.map((th) =>
            mode === "balloons" ? (
              <div
                key={th.root.id}
                data-balloon-id={th.root.id}
                className="absolute left-3 right-2"
                style={{ top: tops.get(th.root.id) ?? 0, visibility: tops.has(th.root.id) ? undefined : "hidden" }}
              >
                <ThreadCard thread={th} editor={editor} ctl={ctl} features={features} active={ui.active === th.root.id} />
              </div>
            ) : (
              <button
                key={th.root.id}
                type="button"
                className="absolute left-1 inline-flex h-8 w-8 items-center justify-center rounded hover:bg-ui-hover"
                style={{ top: tops.get(th.root.id) ?? 0, color: authorColor(th.root.author).dark }}
                title={t("write.comments.indicator", { author: th.root.author })}
                aria-label={t("write.comments.indicator", { author: th.root.author })}
                data-testid="comment-indicator"
                onClick={() => {
                  features.ui.setComments({ show: true, active: th.root.id });
                  revealComment(editor.view, th.root.id);
                }}
              >
                {COMMENT_ICON}
              </button>
            ),
          )}
        </div>
      )}
      {mode === "balloons" && lineAnchor && lineTop !== undefined && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true" data-testid="comment-connector">
          <polyline
            points={`${lineAnchor.x},${lineAnchor.y + marginTop + 16} ${marginLeft},${lineAnchor.y + marginTop + 16} ${marginLeft + 12},${lineTop + marginTop + 16}`}
            fill="none"
            stroke={lineFor === DRAFT_ID ? "#2b579a" : authorColor(comments.find((c) => c.id === lineFor)?.author ?? "").dark}
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        </svg>
      )}
    </div>
  );
}

// ----- pane --------------------------------------------------------------------------------

/** The Comments pane: every thread (filter all / open / resolved), the draft on top. */
export function CommentsPane({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = useCommentsUi(features);
  const comments = useComments(ctl);
  const mode = useCommentsMode(features, ctl);
  const ranges = useRanges(editor);
  useDraftMapping(editor, features);
  if (mode !== "pane") return null;
  const all = threads(
    comments,
    ranges.map((r) => r.id),
  );
  const shown = filterThreads(all, ui.filter);
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-ui-border bg-ui-bg text-ui-fg" aria-label={t("write.comments.title")} data-testid="comments-pane">
      <div className="flex items-center gap-2 border-b border-ui-border px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">{t("write.comments.title")}</h2>
        <label className="flex items-center gap-1 text-xs">
          {t("write.comments.filter")}
          <select
            className="rounded border border-ui-border bg-ui-bg px-1 py-0.5 text-xs"
            value={ui.filter}
            data-testid="comments-filter"
            onChange={(e) => features.ui.setComments({ filter: e.target.value as CommentFilter })}
          >
            {(["all", "open", "resolved"] as const).map((f) => (
              <option key={f} value={f}>
                {t(`write.comments.filter.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={BUTTON}
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={() => features.ui.setComments(ui.pane ? { pane: false } : { show: false })}
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        {ui.draft && <DraftCard ctl={ctl} features={features} editor={editor} />}
        {shown.length === 0 && !ui.draft && (
          <p className="p-2 text-sm text-ui-muted" data-testid="comments-empty">
            {t("write.comments.empty")}
          </p>
        )}
        {shown.map((th) => (
          <div
            key={th.root.id}
            onClick={() => {
              if (ui.active !== th.root.id) revealComment(editor.view, th.root.id);
            }}
          >
            <ThreadCard thread={th} editor={editor} ctl={ctl} features={features} active={ui.active === th.root.id} />
          </div>
        ))}
      </div>
    </aside>
  );
}

// ----- user name ---------------------------------------------------------------------------

/** File › Options › User name, also asked before the first comment; remembered in this browser only (ADR 0009). */
export function UserNameDialog({ ctl, features }: { ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const open = useSyncExternalStore(features.ui.subscribe, () => features.ui.getState().dialog === "userName");
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(ctl.user?.name ?? "");
    setInitials(ctl.user?.initials ?? "");
  }, [open, ctl]);
  const close = () => features.ui.set({ dialog: null, userThen: null });
  return (
    <Dialog open={open} title={t("write.user.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          const ini = initials.trim() || initialsOf(n);
          const then = features.ui.getState().userThen;
          features.ui.set({ dialog: null, userThen: null });
          saveUser({ name: n, initials: ini });
          void ctl.setUser(n, ini).then(() => {
            if (then === "newComment") features.newComment();
          });
        }}
      >
        <p className="text-xs text-ui-muted">{t("write.user.intro")}</p>
        <label className="flex flex-col gap-0.5">
          {t("write.user.name")}
          <input
            className="rounded border border-ui-border bg-ui-bg px-2 py-1 text-ui-fg"
            value={name}
            data-testid="user-name"
            onChange={(e) => {
              const v = e.target.value;
              if (!initials || initials === initialsOf(name)) setInitials(initialsOf(v));
              setName(v);
            }}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          {t("write.user.initials")}
          <input
            className="w-24 rounded border border-ui-border bg-ui-bg px-2 py-1 text-ui-fg"
            value={initials}
            maxLength={9}
            data-testid="user-initials"
            onChange={(e) => setInitials(e.target.value)}
          />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="submit" className={BUTTON} disabled={!name.trim()} data-testid="user-ok">
            {t("common.ok")}
          </button>
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- icons -------------------------------------------------------------------------------

const svg = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const COMMENT_ICON = svg(<path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />, 18);
export const NEW_COMMENT_ICON = svg(
  <>
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    <path d="M10 6.5v5M7.5 9h5" />
  </>,
  22,
);
export const DELETE_COMMENT_ICON = svg(
  <>
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    <path d="M8 7l4 4M12 7l-4 4" />
  </>,
  22,
);
export const RESOLVE_ICON = svg(<path d="M4.5 10.5l3.5 3.5 7.5-8" />);
export const REOPEN_ICON = svg(<path d="M5 9a5 5 0 119 3M5 9V5M5 9h4" />);
export const PREV_COMMENT_ICON = svg(
  <>
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    <path d="M11.5 6.5L9 9l2.5 2.5" />
  </>,
);
export const NEXT_COMMENT_ICON = svg(
  <>
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    <path d="M8.5 6.5L11 9l-2.5 2.5" />
  </>,
);
export const SHOW_COMMENTS_ICON = svg(
  <>
    <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    <path d="M6.5 7.5h7M6.5 10.5h4" />
  </>,
  22,
);
export const PANE_ICON = svg(
  <>
    <rect x="3" y="3.5" width="14" height="13" rx="1" />
    <path d="M12 3.5v13M13.5 7h2M13.5 10h2" />
  </>,
  22,
);
