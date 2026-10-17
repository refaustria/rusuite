// The animation Effect Options / Timing / Text Animation dialog and the
// Trim Video / Audio dialog (P9-S4), like PowerPoint's: Effect (animate
// text all at once / by word / by letter with the delay between, Smooth
// end: auto-reverse), Timing (Start, Delay, Duration, Repeat, Rewind when
// done playing, Triggers: part of the click sequence / on click of a shape
// / on a bookmark of a clip), Text Animation (group text as one object,
// all paragraphs at once or by 1st…5th level paragraphs, in reverse order,
// animate attached shape). Trim: start and end time of the clip with a
// preview that plays the trimmed part.

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { Animation } from "../generated/Animation";
import type { AnimationPatch } from "../generated/AnimationPatch";
import type { Iterate } from "../generated/Iterate";
import type { MediaClip } from "../generated/MediaClip";
import type { Repeat } from "../generated/Repeat";
import type { StartOn } from "../generated/StartOn";
import type { TextBuild } from "../generated/TextBuild";
import type { Trigger } from "../generated/Trigger";
import { MAX_TIME_MS, MIN_DURATION_MS, TRIGGERS, clampDelay, clampDuration, effectKey, triggerKey } from "../anim/effects";
import { useShow, type ShowStore } from "../state/store";
import { SpinField } from "./AnimTabs";
import { mediaUrl } from "../present/ShowOverlay";
import { useT } from "../i18n";

const CHECK = "flex min-h-8 items-center gap-2";
const BUTTON = "h-8 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover disabled:opacity-40";
const SELECT = "h-8 rounded border border-ui-border bg-ui-bg px-1";

/** The Repeat choices: none, 2, 3, 4, 5, 10, Until Next Click, Until End of Slide. */
const REPEATS: { id: string; repeat: Repeat | null }[] = [
  { id: "none", repeat: null },
  ...[2, 3, 4, 5, 10].map((n) => ({ id: String(n), repeat: { kind: "times", value: n * 1000 } as Repeat })),
  { id: "untilNextClick", repeat: { kind: "untilNextClick" } },
  { id: "untilEndOfSlide", repeat: { kind: "untilEndOfSlide" } },
];

const repeatId = (r: Repeat | undefined): string =>
  !r ? "none" : r.kind === "times" ? (REPEATS.find((x) => x.repeat?.kind === "times" && x.repeat.value === r.value)?.id ?? `t${r.value}`) : r.kind;

/** What the dialog changes: the patch of its fields against animation `a` (only what differs). */
export function timingPatch(a: Animation, v: {
  trigger: Trigger;
  delayMs: number;
  durationMs: number;
  repeat: Repeat | null;
  rewind: boolean;
  autoReverse: boolean;
  startOn: StartOn | null;
  build: TextBuild | null;
  iterate: Iterate | null;
}): AnimationPatch {
  const p: AnimationPatch = {};
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  if (v.trigger !== a.trigger) p.trigger = v.trigger;
  if (v.delayMs !== a.delayMs) p.delayMs = clampDelay(v.delayMs);
  if (v.durationMs !== a.durationMs) p.durationMs = clampDuration(v.durationMs);
  if (!same(v.repeat, a.repeat)) p.repeat = v.repeat;
  if (v.rewind !== !!a.rewind) p.rewind = v.rewind;
  if (v.autoReverse !== !!a.autoReverse) p.autoReverse = v.autoReverse;
  if (!same(v.startOn, a.startOn)) p.startOn = v.startOn;
  if (!same(v.build, a.build)) p.build = v.build;
  if (!same(v.iterate, a.iterate)) p.iterate = v.iterate;
  return p;
}

export function AnimTimingDialog({ store, tab: initial }: { store: ShowStore; tab: "timing" | "effect" | "text" }) {
  const t = useT();
  const state = store.getState();
  const a = store.targetAnimations()[0];
  const slide = state.pres?.slides.find((s) => s.id === state.current);
  const [tab, setTab] = useState(initial);
  const [trigger, setTrigger] = useState<Trigger>(a?.trigger ?? "onClick");
  const [delayMs, setDelay] = useState(a?.delayMs ?? 0);
  const [durationMs, setDuration] = useState(a?.durationMs ?? 500);
  const [repeat, setRepeat] = useState<Repeat | null>(a?.repeat ?? null);
  const [rewind, setRewind] = useState(!!a?.rewind);
  const [autoReverse, setAutoReverse] = useState(!!a?.autoReverse);
  const [startOn, setStartOn] = useState<StartOn | null>(a?.startOn ?? null);
  const [build, setBuild] = useState<TextBuild | null>(a?.build ?? null);
  const [iterate, setIterate] = useState<Iterate | null>(a?.iterate ?? null);
  const close = () => store.closeDialog();
  if (!a || !slide) return null;
  const shapes = slide.shapes;
  const bookmarks = shapes.flatMap((s) => (s.kind.kind === "media" ? (s.kind.value.bookmarks ?? []).map((b) => ({ shape: s.id, name: b.name })) : []));
  const firstShape = shapes.find((s) => s.id !== a.shape) ?? shapes[0];
  const tabs = [
    ["effect", t("show.timingDlg.effect")],
    ["timing", t("show.timingDlg.timing")],
    ["text", t("show.timingDlg.text")],
  ] as const;
  const triggerKind = !startOn ? "sequence" : startOn.kind;
  return (
    <Dialog open title={t(effectKey(a.effect, a.kind))} onClose={close}>
      <form
        className="flex w-[30rem] flex-col gap-2 text-sm"
        data-testid="anim-timing-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const patch = timingPatch(a, { trigger, delayMs, durationMs, repeat, rewind, autoReverse, startOn, build, iterate });
          if (Object.keys(patch).length) void store.updateAnimations(patch);
        }}
      >
        <div role="tablist" className="flex gap-1 border-b border-ui-border">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`h-8 px-3 ${tab === id ? "border-b-2 border-orange-600 font-semibold" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "effect" && (
          <div className="flex flex-col gap-2" role="tabpanel">
            <label className={CHECK}>
              {t("show.timingDlg.animateText")}
              <select
                className={SELECT}
                aria-label={t("show.timingDlg.animateText")}
                value={iterate?.unit ?? "all"}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setIterate(v === "all" ? null : { unit: v as Iterate["unit"], delayPct: iterate?.delayPct ?? 10000 });
                }}
              >
                <option value="all">{t("show.timingDlg.allAtOnce")}</option>
                <option value="word">{t("show.timingDlg.byWord")}</option>
                <option value="letter">{t("show.timingDlg.byLetter")}</option>
              </select>
            </label>
            <label className={CHECK}>
              <input
                type="number"
                min={0}
                max={100}
                className={`${SELECT} w-20`}
                aria-label={t("show.timingDlg.delayBetween")}
                disabled={!iterate}
                value={(iterate?.delayPct ?? 10000) / 1000}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0));
                  if (iterate) setIterate({ ...iterate, delayPct: Math.round(v * 1000) });
                }}
              />
              {t("show.timingDlg.delayBetween")}
            </label>
            <label className={CHECK}>
              <input type="checkbox" disabled={a.kind !== "emphasis" && a.kind !== "path"} checked={autoReverse} onChange={(e) => setAutoReverse(e.currentTarget.checked)} />
              {t("show.timingDlg.autoReverse")}
            </label>
          </div>
        )}
        {tab === "timing" && (
          <div className="grid grid-cols-[8rem_1fr] items-center gap-2" role="tabpanel">
            <span>{t("show.start")}</span>
            <select className={SELECT} aria-label={t("show.start")} value={trigger} onChange={(e) => setTrigger(e.currentTarget.value as Trigger)}>
              {TRIGGERS.map((x) => (
                <option key={x} value={x}>
                  {t(triggerKey(x))}
                </option>
              ))}
            </select>
            <span>{t("show.delayS")}</span>
            <SpinField label={t("show.delayS")} ms={delayMs} min={0} onCommit={setDelay} />
            <span>{t("show.durationS")}</span>
            <SpinField label={t("show.animDuration")} ms={durationMs} min={MIN_DURATION_MS} max={MAX_TIME_MS} disabled={a.effect === "appear" || a.kind === "media"} onCommit={setDuration} />
            <span>{t("show.timingDlg.repeat")}</span>
            <select
              className={SELECT}
              aria-label={t("show.timingDlg.repeat")}
              value={repeatId(repeat ?? undefined)}
              onChange={(e) => setRepeat(REPEATS.find((r) => r.id === e.currentTarget.value)?.repeat ?? null)}
            >
              {REPEATS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.repeat?.kind === "times" ? String(r.repeat.value / 1000) : t(`show.timingDlg.repeat.${r.id}`)}
                </option>
              ))}
              {repeat?.kind === "times" && !REPEATS.some((r) => r.repeat?.kind === "times" && r.repeat.value === repeat.value) && (
                <option value={repeatId(repeat)}>{String(repeat.value / 1000)}</option>
              )}
            </select>
            <label className={`${CHECK} col-span-2`}>
              <input type="checkbox" checked={rewind} onChange={(e) => setRewind(e.currentTarget.checked)} />
              {t("show.timingDlg.rewind")}
            </label>
            <fieldset className="col-span-2 flex flex-col gap-1 rounded border border-ui-border p-2">
              <legend className="px-1 font-semibold">{t("show.timingDlg.triggers")}</legend>
              <label className={CHECK}>
                <input type="radio" name="trigger" checked={triggerKind === "sequence"} onChange={() => setStartOn(null)} />
                {t("show.timingDlg.inSequence")}
              </label>
              <label className={CHECK}>
                <input type="radio" name="trigger" checked={triggerKind === "click"} disabled={!firstShape} onChange={() => firstShape && setStartOn({ kind: "click", value: firstShape.id })} />
                {t("show.timingDlg.onClickOf")}
                <select
                  className={SELECT}
                  aria-label={t("show.timingDlg.onClickOf")}
                  disabled={triggerKind !== "click"}
                  value={startOn?.kind === "click" ? startOn.value : ""}
                  onChange={(e) => setStartOn({ kind: "click", value: Number(e.currentTarget.value) })}
                >
                  {shapes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || t("show.shapeN", { n: s.id })}
                    </option>
                  ))}
                </select>
              </label>
              <label className={CHECK}>
                <input type="radio" name="trigger" checked={triggerKind === "bookmark"} disabled={!bookmarks.length} onChange={() => bookmarks[0] && setStartOn({ kind: "bookmark", value: bookmarks[0] })} />
                {t("show.timingDlg.onBookmark")}
                <select
                  className={SELECT}
                  aria-label={t("show.timingDlg.onBookmark")}
                  disabled={triggerKind !== "bookmark"}
                  value={startOn?.kind === "bookmark" ? `${startOn.value.shape}:${startOn.value.name}` : ""}
                  onChange={(e) => {
                    const m = bookmarks.find((b) => `${b.shape}:${b.name}` === e.currentTarget.value);
                    if (m) setStartOn({ kind: "bookmark", value: m });
                  }}
                >
                  {bookmarks.map((b) => (
                    <option key={`${b.shape}:${b.name}`} value={`${b.shape}:${b.name}`}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
        )}
        {tab === "text" && (
          <div className="flex flex-col gap-2" role="tabpanel">
            <label className={CHECK}>
              {t("show.timingDlg.groupText")}
              <select
                className={SELECT}
                aria-label={t("show.timingDlg.groupText")}
                value={build ? String(build.level) : "one"}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setBuild(v === "one" ? null : { ...(build ?? {}), level: Number(v) });
                }}
              >
                <option value="one">{t("show.opt.asOneObject")}</option>
                <option value="0">{t("show.timingDlg.allParagraphs")}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t("show.timingDlg.byLevel", { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className={CHECK}>
              <input type="checkbox" disabled={!build} checked={!!build?.animateBackground} onChange={(e) => build && setBuild({ ...build, animateBackground: e.currentTarget.checked })} />
              {t("show.timingDlg.attachedShape")}
            </label>
            <label className={CHECK}>
              <input type="checkbox" disabled={!build} checked={!!build?.reverse} onChange={(e) => build && setBuild({ ...build, reverse: e.currentTarget.checked })} />
              {t("show.timingDlg.reverse")}
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** `mm:ss.fff` of a media time (Trim's fields). */
export function msToClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = (total - m * 60000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Parses `mm:ss.fff`, `ss.fff` (decimal comma accepted) into ms; `null` = invalid. */
export function clockToMs(text: string): number | null {
  const m = /^(?:(\d+):)?(\d+(?:[.,]\d*)?)$/.exec(text.trim());
  if (!m) return null;
  return Math.round((Number(m[1] ?? 0) * 60 + Number(m[2]!.replace(",", "."))) * 1000);
}

/** The trim of a clip from the dialog's start / end times and the media's duration (ms cut from the start and the end). */
export function trimOf(startMs: number, endMs: number, durationMs: number): { trimStartMs: number; trimEndMs: number } | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return startMs >= 0 && endMs > startMs ? { trimStartMs: startMs, trimEndMs: 0 } : null;
  const s = Math.max(0, Math.min(startMs, durationMs));
  const e = Math.max(0, Math.min(endMs, durationMs));
  if (e - s < 10) return null;
  return { trimStartMs: Math.round(s), trimEndMs: Math.round(durationMs - e) };
}

export function TrimMediaDialog({ store }: { store: ShowStore }) {
  const t = useT();
  useShow(store, (s) => s.mediaVersion);
  const shape = store.selectedMedia()[0];
  const clip = shape?.kind.kind === "media" ? (shape.kind.value as MediaClip) : undefined;
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number>(NaN);
  const [start, setStart] = useState(clip?.trimStartMs ?? 0);
  const [end, setEnd] = useState<number | null>(null);
  const close = () => store.closeDialog();
  useEffect(() => {
    if (end === null && Number.isFinite(duration)) setEnd(duration - (clip?.trimEndMs ?? 0));
  }, [duration, end, clip?.trimEndMs]);
  if (!shape || !clip) return null;
  const url = mediaUrl(store.media.get(clip.media));
  const endMs = end ?? Math.max(start + 1000, 0);
  const valid = trimOf(start, endMs, duration) !== null;
  const common = {
    ref,
    src: url,
    controls: true,
    preload: "metadata" as const,
    "data-testid": "trim-preview",
    onLoadedMetadata: () => setDuration((ref.current?.duration ?? NaN) * 1000),
    onTimeUpdate: () => {
      const el = ref.current;
      if (el && el.currentTime * 1000 >= endMs) el.pause();
    },
    onPlay: () => {
      const el = ref.current;
      if (el && (el.currentTime * 1000 < start || el.currentTime * 1000 >= endMs)) el.currentTime = start / 1000;
    },
  };
  return (
    <Dialog open title={t(clip.kind === "audio" ? "show.trim.audio" : "show.trim.video")} onClose={close}>
      <form
        className="flex w-[28rem] flex-col gap-2 text-sm"
        data-testid="trim-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const trim = trimOf(start, endMs, duration);
          close();
          if (trim) void store.setMediaProps(trim);
        }}
      >
        {clip.kind === "audio" ? <audio {...common} className="w-full" /> : <video {...common} className="max-h-56 w-full bg-black object-contain" />}
        <div className="flex items-center gap-2">
          <span className="text-ui-muted" data-testid="trim-duration">
            {t("show.trim.duration", { time: msToClock(Number.isFinite(duration) ? endMs - start : 0) })}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ClockField label={t("show.trim.start")} ms={start} onCommit={(v) => setStart(Math.max(0, v))} />
          <ClockField label={t("show.trim.end")} ms={endMs} onCommit={(v) => setEnd(v)} />
        </div>
        {!valid && Number.isFinite(duration) && <p className="text-xs text-red-700">{t("show.trim.invalid")}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={!valid}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ClockField({ label, ms, onCommit }: { label: string; ms: number; onCommit: (ms: number) => void }) {
  const [text, setText] = useState(msToClock(ms));
  useEffect(() => setText(msToClock(ms)), [ms]);
  const commit = () => {
    const v = clockToMs(text);
    if (v === null) setText(msToClock(ms));
    else onCommit(v);
  };
  return (
    <label className="flex items-center gap-2">
      {label}
      <input className={`${SELECT} w-28 text-right`} aria-label={label} value={text} onChange={(e) => setText(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />
    </label>
  );
}
