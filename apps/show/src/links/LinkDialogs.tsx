// Insert › Link (Ctrl+K) and Insert › Action (P8-24): PowerPoint's Insert
// Hyperlink dialog (a web address, or a place in this document: first /
// last / next / previous slide or a slide picked from its thumbnail, a
// ScreenTip, Remove Link) and Action Settings (mouse click: none or
// hyperlink to a slide, the end of the show or a URL; running programs
// and sounds are not offered). Both offer the custom shows (P9-S3) with
// "Show and return".

import { useMemo, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CustomShow } from "../generated/CustomShow";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { Slide } from "../generated/Slide";
import type { SlideRef } from "../generated/SlideRef";
import { deckOf } from "../design/deck";
import { bodyText } from "../model";
import { useShow, type ShowStore } from "../state/store";
import { DeckThumb } from "../ui/Thumbs";
import { useT } from "../i18n";

const INPUT = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-ui-fg";
const URL_HINT = "https://"; // i18n-ignore: a URL scheme
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover disabled:opacity-40";

/** The relative jumps in PowerPoint's order. */
export const RELATIVE: Exclude<SlideRef["kind"], "id">[] = ["first", "last", "next", "previous", "lastViewed"];

/** A slide's title (its title placeholder's text), for lists. */
export function slideTitle(slide: Slide): string {
  const title = slide.shapes.find((s) => s.placeholder === "title" || s.placeholder === "centeredTitle");
  const body = title && title.kind.kind === "auto" ? title.kind.value.text : undefined;
  return body ? bodyText(body).replace(/\s+/g, " ").trim() : "";
}

/** A web address as typed: `www.…` gets `https://`, `name@host` gets `mailto:`. */
export function normalizeUrl(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(t)) return `mailto:${t}`;
  return `https://${t}`;
}

/** The label of a link target in menus and the ScreenTip default. */
export function targetLabel(target: LinkTarget, slides: Slide[], t: (k: string, v?: Record<string, string | number>) => string, shows: readonly CustomShow[] = []): string {
  if (target.kind === "url") return target.value;
  if (target.kind === "endShow") return t("show.link.endShow");
  if (target.kind === "customShow") {
    const id = target.value.id;
    return t("show.custom.linkTo", { name: shows.find((c) => c.id === id)?.name ?? String(id) });
  }
  if (target.value.kind === "id") {
    const id = target.value.value;
    const i = slides.findIndex((s) => s.id === id);
    return i < 0 ? t("show.link.missingSlide") : t("show.link.slideN", { n: i + 1, title: slideTitle(slides[i]!) });
  }
  return t(`show.link.${target.value.kind}`);
}

/** The custom shows to link to, with "Show and return". */
function CustomShowPicker({ store, value, onPick }: { store: ShowStore; value: { id: number; returnAfter: boolean } | null; onPick: (v: { id: number; returnAfter: boolean }) => void }) {
  const t = useT();
  const shows = useShow(store, (s) => s.pres?.customShows) ?? [];
  if (!shows.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="link-custom-shows">
      <span className="font-medium">{t("show.custom.shows")}</span>
      <ul role="listbox" aria-label={t("show.custom.shows")} className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
        {shows.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              aria-selected={value?.id === c.id}
              className={`w-full rounded px-2 py-1 text-left ${value?.id === c.id ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`}
              onClick={() => onPick({ id: c.id, returnAfter: value?.returnAfter ?? false })}
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!value} checked={!!value?.returnAfter} onChange={(e) => value && onPick({ ...value, returnAfter: e.currentTarget.checked })} />
        {t("show.custom.showAndReturn")}
      </label>
    </div>
  );
}

/** A list of the presentation's slides (thumbnail, number, title) to pick a target from. */
function SlidePicker({ store, value, onPick, relative = true }: { store: ShowStore; value: SlideRef | null; onPick: (r: SlideRef) => void; relative?: boolean }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const deck = useMemo(() => (pres ? deckOf(pres) : null), [pres]);
  if (!pres || !deck) return null;
  const same = (r: SlideRef) => JSON.stringify(r) === JSON.stringify(value);
  const item = (r: SlideRef, label: string, thumb?: Slide) => (
    <li key={JSON.stringify(r)}>
      <button
        type="button"
        role="option"
        aria-selected={same(r)}
        data-target={r.kind === "id" ? `slide-${pres.slides.findIndex((s) => s.id === r.value) + 1}` : r.kind}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${same(r) ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`}
        onClick={() => onPick(r)}
      >
        {thumb && <DeckThumb deck={deck} slide={thumb} media={store.media} mediaVersion={mediaVersion} width={64} />}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
  return (
    <ul role="listbox" aria-label={t("show.link.placeInDoc")} className="flex max-h-72 flex-col gap-0.5 overflow-y-auto" data-testid="link-slide-list">
      {relative && RELATIVE.map((k) => item({ kind: k }, t(`show.link.${k}`)))}
      {pres.slides.map((s, i) => item({ kind: "id", value: s.id }, t("show.link.slideN", { n: i + 1, title: slideTitle(s) }), s))}
    </ul>
  );
}

/** Insert › Link. */
export function LinkDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const [initial] = useState(() => store.currentLink());
  const [tab, setTab] = useState<"web" | "place">(initial?.target.kind === "url" || !initial ? "web" : "place");
  const [url, setUrl] = useState(initial?.target.kind === "url" ? initial.target.value : "");
  const [place, setPlace] = useState<SlideRef | null>(initial?.target.kind === "slide" ? initial.target.value : null);
  const [custom, setCustom] = useState<{ id: number; returnAfter: boolean } | null>(initial?.target.kind === "customShow" ? { id: initial.target.value.id, returnAfter: !!initial.target.value.returnAfter } : null);
  const [tip, setTip] = useState(initial?.tooltip ?? "");
  const close = () => store.closeDialog();
  const target: LinkTarget | null =
    tab === "web" ? (normalizeUrl(url) ? { kind: "url", value: normalizeUrl(url) } : null) : custom ? { kind: "customShow", value: custom } : place ? { kind: "slide", value: place } : null;
  const apply = (link: Hyperlink | null) => {
    close();
    void store.setLink(link);
  };
  return (
    <Dialog open title={t("show.link.title")} onClose={close}>
      <form
        className="flex w-[30rem] flex-col gap-3 text-sm"
        data-testid="link-dialog"
        data-keep-edit
        onSubmit={(e) => {
          e.preventDefault();
          if (target) apply(tip.trim() ? { target, tooltip: tip.trim() } : { target });
        }}
      >
        <div role="tablist" className="flex gap-1">
          {(["web", "place"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rounded px-3 py-1 ${tab === k ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`} onClick={() => setTab(k)}>
              {t(k === "web" ? "show.link.webPage" : "show.link.placeInDoc")}
            </button>
          ))}
        </div>
        {tab === "web" ? (
          <label className="flex flex-col gap-1">
            <span>{t("show.link.address")}</span>
            <input className={INPUT} autoFocus aria-label={t("show.link.address")} placeholder={URL_HINT} value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
          </label>
        ) : (
          <>
            <SlidePicker store={store} value={custom ? null : place} onPick={(r) => { setPlace(r); setCustom(null); }} />
            <CustomShowPicker store={store} value={custom} onPick={setCustom} />
          </>
        )}
        <label className="flex flex-col gap-1">
          <span>{t("show.link.screenTip")}</span>
          <input className={INPUT} aria-label={t("show.link.screenTip")} value={tip} onChange={(e) => setTip(e.currentTarget.value)} />
        </label>
        <div className="flex gap-2">
          {initial && (
            <button type="button" className={BUTTON} onClick={() => apply(null)}>
              {t("show.link.remove")}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={!target}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type ActionChoice = "none" | "first" | "last" | "next" | "previous" | "lastViewed" | "endShow" | "customShow" | "slide" | "url";

/** The Action Settings choice of a click action. */
export function actionChoice(a: Hyperlink | null | undefined): ActionChoice {
  if (!a) return "none";
  if (a.target.kind === "url") return "url";
  if (a.target.kind === "endShow") return "endShow";
  if (a.target.kind === "customShow") return "customShow";
  return a.target.value.kind === "id" ? "slide" : a.target.value.kind;
}

/** Insert › Action (Action Settings, Mouse Click). */
export function ActionDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const [initial] = useState(() => store.selectedShapes()[0]?.clickAction ?? null);
  const [choice, setChoice] = useState<ActionChoice>(actionChoice(initial));
  const [slide, setSlide] = useState<SlideRef | null>(initial?.target.kind === "slide" && initial.target.value.kind === "id" ? initial.target.value : null);
  const [url, setUrl] = useState(initial?.target.kind === "url" ? initial.target.value : "");
  const [custom, setCustom] = useState<{ id: number; returnAfter: boolean } | null>(initial?.target.kind === "customShow" ? { id: initial.target.value.id, returnAfter: !!initial.target.value.returnAfter } : null);
  const hasCustom = useShow(store, (s) => !!s.pres?.customShows?.length);
  const close = () => store.closeDialog();
  const action = (): Hyperlink | null | undefined => {
    switch (choice) {
      case "none":
        return null;
      case "customShow":
        return custom ? { target: { kind: "customShow", value: custom } } : undefined;
      case "endShow":
        return { target: { kind: "endShow" } };
      case "url":
        return normalizeUrl(url) ? { target: { kind: "url", value: normalizeUrl(url) } } : undefined;
      case "slide":
        return slide ? { target: { kind: "slide", value: slide } } : undefined;
      default:
        return { target: { kind: "slide", value: { kind: choice } } };
    }
  };
  const a = action();
  return (
    <Dialog open title={t("show.action.title")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        data-testid="action-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (a === undefined) return;
          close();
          void store.setAction(a);
        }}
      >
        <h3 className="font-medium">{t("show.action.mouseClick")}</h3>
        <label className="flex items-center gap-2">
          <input type="radio" name="action" checked={choice === "none"} onChange={() => setChoice("none")} />
          {t("show.action.none")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="action" checked={choice !== "none"} onChange={() => setChoice("next")} />
          {t("show.action.hyperlinkTo")}
        </label>
        <select className={INPUT} aria-label={t("show.action.hyperlinkTo")} disabled={choice === "none"} value={choice === "none" ? "next" : choice} onChange={(e) => setChoice(e.target.value as ActionChoice)}>
          {(["next", "previous", "first", "last", "lastViewed", "endShow", ...(hasCustom || choice === "customShow" ? (["customShow"] as const) : []), "slide", "url"] as const).map((k) => (
            <option key={k} value={k}>
              {t(k === "slide" ? "show.action.slide" : k === "url" ? "show.action.url" : k === "endShow" ? "show.link.endShow" : k === "customShow" ? "show.custom.customShowDots" : `show.link.${k}`)}
            </option>
          ))}
        </select>
        {choice === "slide" && <SlidePicker store={store} value={slide} onPick={setSlide} relative={false} />}
        {choice === "customShow" && <CustomShowPicker store={store} value={custom} onPick={setCustom} />}
        {choice === "url" && <input className={INPUT} aria-label={t("show.link.address")} placeholder={URL_HINT} value={url} onChange={(e) => setUrl(e.currentTarget.value)} />}
        <label className="flex items-center gap-2 text-ui-muted">
          <input type="radio" name="action" disabled />
          {t("show.action.runProgram")}
        </label>
        <label className="flex items-center gap-2 text-ui-muted">
          <input type="checkbox" disabled />
          {t("show.action.playSound")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={a === undefined}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
