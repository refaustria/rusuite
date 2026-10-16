// Show's AI actions (P8-37): Outline to slides (title / bullets / notes → new slides with the deck's own theme and
// "Title and Content" layout, one undo step), Speaker notes for this slide, Rewrite slide text, Suggest a layout
// (one of the deck's layouts).
//
// Context: the current slide's title, body and notes (or the selected text box), the slide's number and layout, the
// deck's layouts; the outline of every slide only with "Include whole document".

import {
  PLAIN_TEXT_RULE, SLIDES_TOOL, layoutTool, paragraphsOf, parseLayout, parseSlides, plainText,
  type AiAction, type AiAppAdapter, type AiApply, type DocContext, type LayoutResult, type OutlineSlide,
} from "@rusuite/ui-shared";
import { t } from "../i18n";
import type { ShowStore } from "../state/store";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Presentation } from "../generated/Presentation";
import type { Slide } from "../generated/Slide";
import type { Shape } from "../generated/Shape";
import type { NodeId } from "../generated/NodeId";
import type { LayoutKind } from "../generated/LayoutKind";
import type { PlaceholderKind } from "../generated/PlaceholderKind";
import { bodyText, textOf } from "../model";
import { bodyWithLines, outlineOf, outlineSlide } from "../views/outline";

const HEADER_FOOTER = new Set<PlaceholderKind>(["dateTime", "footer", "slideNumber"]);
const isTitle = (k: PlaceholderKind | undefined) => k === "title" || k === "centeredTitle";
const isBody = (k: PlaceholderKind | undefined) => k === "body" || k === "subtitle";

/** The largest id used anywhere in the presentation (slides, shapes, animations, …). */
export function maxId(pres: Presentation): number {
  let max = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "id" && typeof x === "number" && x > max) max = x;
        else if (typeof x === "object") walk(x);
      }
    }
  };
  walk(pres);
  return max;
}

/** The placeholder kinds of the shapes `addSlide` creates for `layout` (in order), as the core builds them. */
export function newSlideShapes(pres: Presentation, layout: LayoutKind): PlaceholderKind[] | null {
  const l = pres.layouts.find((x) => x.kind === layout);
  if (!l) return null;
  const kinds = l.placeholders.filter((p) => !HEADER_FOOTER.has(p.kind)).map((p) => p.kind);
  const hf = pres.master?.headerFooter;
  if (!hf) return kinds;
  const off = (!hf.date || hf.date.kind === "off") && hf.footer == null && !hf.slideNumber;
  if (off || (hf.notOnTitle && layout === "title")) return kinds;
  if (hf.date && hf.date.kind !== "off") kinds.push("dateTime");
  if (hf.footer != null) kinds.push("footer");
  if (hf.slideNumber) kinds.push("slideNumber");
  return kinds;
}

/**
 * One compound command adding `slides` after `after` (layout "titleContent"): `addSlide` with explicit new ids,
 * then the title and body text and the notes of each – one undo step.
 */
export function outlineCommands(pres: Presentation, after: NodeId | null, slides: OutlineSlide[]): ShowCommand | null {
  const kinds = newSlideShapes(pres, "titleContent");
  if (!kinds) return null;
  let next = maxId(pres) + 1;
  const commands: ShowCommand[] = [];
  let prev = after;
  for (const s of slides) {
    const slide = next++;
    const ids = kinds.map(() => next++);
    commands.push({ type: "addSlide", ...(prev === null ? {} : { after: prev }), layout: "titleContent", newIds: [slide, ...ids] });
    const title = ids[kinds.findIndex(isTitle)];
    const body = ids[kinds.findIndex(isBody)];
    if (title !== undefined && s.title) commands.push({ type: "setTextBody", shape: title, body: bodyWithLines(null, [{ level: 0, text: s.title }]) });
    if (body !== undefined && s.bullets.length) commands.push({ type: "setTextBody", shape: body, body: bodyWithLines(null, s.bullets.map((b) => ({ level: 0, text: b }))) });
    if (s.notes) commands.push({ type: "setNotes", slide, notes: s.notes });
    prev = slide;
  }
  return commands.length ? { type: "compound", commands } : null;
}

export interface ShowAnchor {
  slide: NodeId;
  /** The text shape the text actions work on (`null`: none). */
  shape: NodeId | null;
}

function currentSlide(store: ShowStore): Slide | null {
  const st = store.getState();
  return st.pres?.slides.find((s) => s.id === st.current) ?? null;
}

/** The text shape of the selection, else the slide's body placeholder. */
function targetShape(store: ShowStore, slide: Slide | null): Shape | null {
  if (!slide) return null;
  const sel = store.getState().selection;
  const picked = slide.shapes.find((s) => sel.includes(s.id) && textOf(s));
  if (picked) return picked;
  return slide.shapes.find((s) => isBody(s.placeholder ?? undefined) && textOf(s)) ?? null;
}

function slideText(slide: Slide): string {
  const o = outlineSlide(slide);
  const others = slide.shapes
    .filter((s) => s.id !== o.titleShape && s.id !== o.bodyShape && textOf(s) && bodyText(textOf(s)!).trim())
    .map((s) => bodyText(textOf(s)!));
  return [o.title && `Title: ${o.title}`, ...o.body.map((p) => `${"  ".repeat(p.level)}- ${p.text}`), ...others].filter(Boolean).join("\n");
}

export function showAiAdapter(store: ShowStore): AiAppAdapter {
  const anchorOf = (turn: { anchor?: unknown }): ShowAnchor | null => (turn.anchor as ShowAnchor | undefined) ?? null;
  const slideOf = (a: ShowAnchor | null) => store.getState().pres?.slides.find((s) => s.id === (a?.slide ?? store.getState().current)) ?? null;

  const setNotes: AiApply<string> = {
    label: t("ai.show.setNotes"),
    run: async (text, turn) => {
      const slide = slideOf(anchorOf(turn));
      if (!slide) throw new Error(t("ai.show.noSlide"));
      await store.setNotes(slide.id, paragraphsOf(plainText(text)).join("\n"));
      return t("ai.show.notesSet");
    },
  };
  const replaceText: AiApply<string> = {
    label: t("ai.show.replaceText"),
    run: async (text, turn) => {
      const a = anchorOf(turn);
      const slide = slideOf(a);
      const shape = slide?.shapes.find((s) => s.id === a?.shape) ?? targetShape(store, slide);
      const old = shape ? textOf(shape) : null;
      if (!shape || !old) throw new Error(t("ai.show.noText"));
      const lines = paragraphsOf(plainText(text)).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
      const levels = old.paragraphs.map((p) => p.props?.level ?? 0);
      if (store.getState().editing) await store.commitEdit();
      const res = await store.run({ type: "setTextBody", shape: shape.id, body: bodyWithLines(old, lines.map((l, i) => ({ level: lines.length === levels.length ? levels[i]! : 0, text: l }))) });
      if (!res) throw new Error(t("ai.show.notApplied"));
      return t("ai.show.textReplaced");
    },
  };

  const layouts = () => (store.getState().pres?.layouts ?? []).map((l) => ({ id: l.kind, name: l.name ?? l.kind }));

  const outline: AiAction<OutlineSlide[]> = {
    id: "outline",
    label: t("ai.show.outline"),
    input: { placeholder: t("ai.show.outlinePlaceholder"), required: true },
    task: (what) =>
      `Create presentation slides for this topic or outline: ${what}. Each slide gets a short title, 3 to 6 concise bullet points and brief speaker notes. Use the language of the request.`,
    tool: SLIDES_TOOL,
    parse: parseSlides,
    preview: (slides) => (
      <ol className="flex list-decimal flex-col gap-0.5 rounded bg-ui-bg p-2 pl-6" data-testid="ai-slides">
        {slides.map((s, i) => (
          <li key={i}>
            <span className="font-medium">{s.title}</span>
            <span className="text-xs text-ui-muted"> · {t("ai.show.bullets", { count: s.bullets.length })}</span>
          </li>
        ))}
      </ol>
    ),
    apply: [
      {
        label: t("ai.show.insertSlides"),
        run: async (slides) => {
          if (store.getState().editing) await store.commitEdit();
          const pres = store.getState().pres;
          if (!pres) throw new Error(t("ai.show.noSlide"));
          const after = store.getState().current;
          const before = new Set(pres.slides.map((s) => s.id));
          const cmd = outlineCommands(pres, after, slides);
          const res = cmd ? await store.run(cmd) : null;
          if (!res) throw new Error(t("ai.show.notApplied"));
          const added = store.getState().pres?.slides.filter((s) => !before.has(s.id)) ?? [];
          if (added.length) store.selectSlide(added[0]!.id);
          return t("ai.show.inserted", { count: added.length });
        },
      },
    ],
  };

  const notes: AiAction<string> = {
    id: "notes",
    label: t("ai.show.notes"),
    unavailable: () => (currentSlide(store) ? null : t("ai.show.noSlide")),
    task: () => "Write speaker notes for the current slide: what the presenter should say, in a few short paragraphs of plain text.",
    system: PLAIN_TEXT_RULE,
    apply: [setNotes],
  };

  const rewrite: AiAction<string> = {
    id: "rewrite",
    label: t("ai.show.rewrite"),
    unavailable: () => (targetShape(store, currentSlide(store)) ? null : t("ai.show.noText")),
    task: () => "Rewrite the text of the selected text box (or the slide's body) for a slide: clear, concise, parallel phrasing; one line per bullet; keep the meaning and the language.",
    system: `${PLAIN_TEXT_RULE} Write one bullet per line, without list markers.`,
    apply: [replaceText],
  };

  const layout: AiAction<LayoutResult> = {
    id: "layout",
    label: t("ai.show.layout"),
    unavailable: () => (currentSlide(store) ? null : t("ai.show.noSlide")),
    task: () => "Choose the layout of this presentation that fits the current slide's content best.",
    get tool() {
      return layoutTool(layouts());
    },
    parse: (raw) => parseLayout(raw, layouts()),
    preview: (v) => (
      <div className="flex flex-col gap-1">
        <p className="font-medium" data-testid="ai-layout">
          {layouts().find((l) => l.id === v.layout)?.name ?? v.layout}
        </p>
        {v.reason && <p className="text-xs text-ui-muted">{v.reason}</p>}
      </div>
    ),
    apply: [
      {
        label: t("ai.show.applyLayout"),
        run: async (v, turn) => {
          const slide = slideOf(anchorOf(turn));
          if (!slide) throw new Error(t("ai.show.noSlide"));
          await store.setSlideLayout(v.layout as LayoutKind, [slide.id]);
          return t("ai.show.layoutApplied");
        },
      },
    ],
  };

  return {
    app: "show",
    textApply: [replaceText, setNotes],
    anchor: () => {
      const slide = currentSlide(store);
      return slide ? ({ slide: slide.id, shape: targetShape(store, slide)?.id ?? null } satisfies ShowAnchor) : null;
    },
    subscribe: (fn) => store.subscribe(fn),
    hasSelection: () => !!currentSlide(store),
    selectionLabel: () => {
      const st = store.getState();
      const slides = st.pres?.slides ?? [];
      const i = slides.findIndex((s) => s.id === st.current);
      if (i < 0) return t("ai.show.ctxNone");
      const picked = slides[i]!.shapes.some((s) => st.selection.includes(s.id) && textOf(s));
      return t(picked ? "ai.show.ctxShape" : "ai.show.ctxSlide", { n: i + 1, count: slides.length });
    },
    documentSize: () => {
      const pres = store.getState().pres;
      return pres ? pres.slides.reduce((n, s) => n + slideText(s).length + (s.notes?.length ?? 0), 0) : 0;
    },
    context: async (includeDocument): Promise<DocContext> => {
      const st = store.getState();
      const pres = st.pres;
      const slides = pres?.slides ?? [];
      const i = slides.findIndex((s) => s.id === st.current);
      const slide = i >= 0 ? slides[i]! : null;
      const shape = targetShape(store, slide);
      const picked = !!shape && st.selection.includes(shape.id);
      const selection = slide
        ? picked && shape
          ? bodyText(textOf(shape)!)
          : `${slideText(slide)}${slide.notes ? `\nSpeaker notes: ${slide.notes}` : ""}`
        : "";
      const facts = [
        slide ? `Current slide: ${i + 1} of ${slides.length}, layout ${slide.layout}` : "No slide selected", // i18n-ignore: model-facing
        `Layouts of this presentation: ${layouts().map((l) => `${l.id} (${l.name})`).join(", ")}`,
        picked ? "The selection is one text box of the current slide." : "", // i18n-ignore: model-facing
      ].filter(Boolean);
      const document = includeDocument && pres
        ? outlineOf(pres)
            .map((o, n) => `Slide ${n + 1}: ${o.title}\n${o.body.map((p) => `${"  ".repeat(p.level)}- ${p.text}`).join("\n")}${slides[n]?.notes ? `\nNotes: ${slides[n]!.notes}` : ""}`)
            .join("\n\n")
        : undefined;
      return {
        app: "show",
        title: st.name ?? t("doc.untitled"),
        description: `Presentation with ${slides.length} slide(s).`,
        selectionLabel: slide ? t(picked ? "ai.show.ctxShape" : "ai.show.ctxSlide", { n: i + 1, count: slides.length }) : t("ai.show.ctxNone"),
        selection,
        facts,
        ...(document !== undefined ? { document } : {}),
      };
    },
    actions: () => [outline, notes, rewrite, layout] as AiAction<unknown>[],
  };
}

