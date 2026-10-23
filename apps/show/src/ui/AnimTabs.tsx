// The Transitions and Animations tabs of Show's ribbon (P8-8, P9-S4),
// like PowerPoint's: the transition gallery (the ECMA kinds inline, every
// kind by section in More Transitions) with Effect Options (the kind's
// directions and variants), Sound (Stop Previous Sound, Other Sound…, Loop
// Until Next Sound), Duration, Advance Slide (On Mouse Click, After
// mm:ss), Apply To All and Preview; the animation gallery grouped
// Entrance / Emphasis / Exit / Motion Paths, Effect Options (directions,
// shapes, spokes, amounts, colours, Sequence for text, Edit Points and
// Reverse Path Direction for motion paths), Add Animation (with Custom
// Path drawn on the stage), the Animation Pane, Trigger, Animation
// Painter, Start / Duration / Delay spinners with PowerPoint's limits,
// the Timing dialog, Move Earlier / Later and Preview.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RIBBON_SELECT, RibbonButton, type TFunction, RibbonGallery, RibbonMenuButton, RibbonRow, RibbonStack, bytesToBase64, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab } from "@rusuite/ui-shared";
import type { Animation } from "../generated/Animation";
import type { AnimationKind } from "../generated/AnimationKind";
import type { Effect } from "../generated/Effect";
import type { TransitionKind } from "../generated/TransitionKind";
import type { Trigger } from "../generated/Trigger";
import {
  ANIMATION_KINDS, MAX_TIME_MS, MIN_DURATION_MS, SHAPE_EFFECTS, TRANSITION_GROUPS, TRIGGERS, animationDirectionKey, clampDelay, clampDuration, effectDirections,
  effectHasColor, effectKey, effectiveAmount, effectiveAnimationDirection, effectiveColor, effectivePath, effectiveTransitionDirection, effectiveTransitionOption,
  effectsOf, galleryKey, isPathEffect, msToMmss, msToSeconds, parseMmss, secondsToMs, spinMs, transitionDirectionKey, transitionDirections, transitionKey,
  transitionOptionKey, transitionOptions, triggerKey,
} from "../anim/effects";
import { formatPath, parsePath, reversePath } from "../anim/motion";
import { findShape } from "../model";
import type { ShowState, ShowStore } from "../state/store";
import { SheetButton, SheetCheck, SheetRow, TimingSheetButton, TouchSpin } from "./TimingSheet";

type T = TFunction;

/** A text field that commits on Enter or blur (and shows the model's value otherwise). */
export function CommitField({ label, value, parse, onCommit, disabled, width = "w-16" }: {
  label: string;
  value: string;
  parse: (text: string) => number | null;
  onCommit: (v: number) => void;
  disabled?: boolean;
  width?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = parse(text);
    if (v === null) setText(value);
    else if (text !== value) onCommit(v);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${RIBBON_SELECT} ${width} text-right`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") setText(value);
      }}
    />
  );
}

/**
 * PowerPoint's seconds spinner: a field (seconds, decimal comma accepted)
 * with up / down arrows (0.25 s steps; ↑ / ↓ keys too), kept within
 * `[min, max]` ms.
 */
export function SpinField({ label, ms, min, max = MAX_TIME_MS, onCommit, disabled }: { label: string; ms: number; min: number; max?: number; onCommit: (ms: number) => void; disabled?: boolean }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const b = "flex h-3 w-4 items-center justify-center text-[8px] leading-none hover:bg-ui-hover disabled:opacity-40";
  return (
    <span
      className="flex items-center"
      data-testid={`spin-${label}`}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        onCommit(spinMs(ms, e.key === "ArrowUp", min, max));
      }}
    >
      <CommitField label={label} value={msToSeconds(ms)} parse={(s) => {
        const v = secondsToMs(s);
        return v === null ? null : clamp(v);
      }} onCommit={onCommit} disabled={disabled} />
      <span className="flex flex-col">
        <button type="button" tabIndex={-1} className={b} aria-label={`${label} +`} disabled={disabled || ms >= max} onClick={() => onCommit(spinMs(ms, true, min, max))}>
          ▲
        </button>
        <button type="button" tabIndex={-1} className={b} aria-label={`${label} −`} disabled={disabled || ms <= min} onClick={() => onCommit(spinMs(ms, false, min, max))}>
          ▼
        </button>
      </span>
    </span>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <span className="flex items-center gap-1 text-xs">
    <span aria-hidden="true" className="text-ui-muted">
      {label}
    </span>
    {children}
  </span>
);

/** Play triangle (Preview). */
const PlayIcon = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="2.5" y="4" width="15" height="12" rx="1" />
    <path d="M8 7.5v5l4.5-2.5z" fill="currentColor" />
  </svg>
);

const BRUSH_ICON = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M13 2.5l4.5 4.5-6 6-4.5-4.5z" fill="currentColor" fillOpacity="0.15" />
    <path d="M7 8.5L3.5 12c-1 1-1 3 0 4s3 1 4 0L11 12.5" />
    <path d="M14.5 5.5l2-2" />
  </svg>
);

const BOLT_ICON = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M11 2L4 11h5l-1 7 7-9h-5z" fill="#d4a017" fillOpacity="0.6" />
  </svg>
);

/** Small picture of a transition kind (gallery). */
export function TransitionIcon({ kind }: { kind: TransitionKind }) {
  const box = <rect x="1" y="1" width="30" height="20" rx="1" fill="none" stroke="currentColor" strokeOpacity="0.5" />;
  const c = "#c2410c";
  const art: Partial<Record<TransitionKind, ReactNode>> = {
    none: <path d="M10 6l12 10M22 6L10 16" stroke="currentColor" strokeOpacity="0.5" />,
    fade: <rect x="1" y="1" width="30" height="20" fill="url(#fade-grad)" />,
    morph: <rect x="1" y="1" width="30" height="20" fill="url(#fade-grad)" />,
    push: (
      <>
        <rect x="1" y="1" width="14" height="20" fill={c} fillOpacity="0.25" />
        <rect x="15" y="1" width="16" height="20" fill={c} fillOpacity="0.7" />
        <path d="M24 11h-7m2.5-2.5L17 11l2.5 2.5" stroke="#fff" />
      </>
    ),
    wipe: (
      <>
        <rect x="12" y="1" width="19" height="20" fill={c} fillOpacity="0.7" />
        <path d="M12 1v20" stroke="#fff" strokeWidth="2" />
      </>
    ),
    cover: (
      <>
        <rect x="9" y="1" width="22" height="20" fill={c} fillOpacity="0.7" />
        <path d="M9 1v20" stroke="currentColor" strokeOpacity="0.6" />
      </>
    ),
    split: <rect x="1" y="6" width="30" height="10" fill={c} fillOpacity="0.7" />,
    cut: <path d="M16 1v20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />,
    zoom: <rect x="9" y="6" width="14" height="10" fill={c} fillOpacity="0.7" />,
    cube: <path d="M6 4l10-2 10 2v14l-10 2-10-2z M16 2v18" fill={c} fillOpacity="0.5" stroke={c} />,
    box: <path d="M6 4h20v14H6z M6 4l4 3h12l4-3" fill={c} fillOpacity="0.5" stroke={c} />,
    doors: <path d="M3 3l10 2v12l-10 2z M29 3l-10 2v12l10 2z" fill={c} fillOpacity="0.6" />,
    flip: <path d="M8 3h16l-3 16H11z" fill={c} fillOpacity="0.6" />,
    vortex: <path d="M16 11m-8 0a8 8 0 1 0 16 0a6 6 0 1 0-12 0a4 4 0 1 0 8 0" stroke={c} fill="none" />,
    ripple: <path d="M16 11m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0" stroke={c} fill="none" />,
    honeycomb: <path d="M8 6l4-2 4 2v4l-4 2-4-2z M16 10l4-2 4 2v4l-4 2-4-2z" fill={c} fillOpacity="0.6" />,
    curtains: <path d="M1 1h8c-2 6-2 14 0 20H1z M31 1h-8c2 6 2 14 0 20h8z" fill={c} fillOpacity="0.7" />,
    pageCurl: <path d="M1 1h22l8 8v12H1z M23 1v8h8" fill={c} fillOpacity="0.5" stroke={c} />,
    peelOff: <path d="M1 1h30v20H12z" fill={c} fillOpacity="0.5" />,
    airplane: <path d="M6 16l20-10-6 12-3-4z" fill={c} fillOpacity="0.7" />,
    origami: <path d="M6 18l10-14 10 14z M16 4v14" fill={c} fillOpacity="0.5" stroke={c} />,
    fallOver: <path d="M4 20l6-17h18l-6 17z" fill={c} fillOpacity="0.6" />,
  };
  const generic = <path d="M5 16l6-9 5 6 4-4 7 7" fill="none" stroke={c} strokeWidth="1.5" />;
  return (
    <svg aria-hidden="true" width="32" height="22" viewBox="0 0 32 22">
      <defs>
        <linearGradient id="fade-grad" x1="0" x2="1">
          <stop offset="0" stopColor={c} stopOpacity="0" />
          <stop offset="1" stopColor={c} stopOpacity="0.8" />
        </linearGradient>
      </defs>
      {art[kind] ?? generic}
      {box}
    </svg>
  );
}

/** PowerPoint's colours of the animation kinds (green entrance, gold emphasis, red exit; motion paths and media grey-blue). */
export const KIND_COLORS: Record<AnimationKind, string> = { entrance: "#2f9e44", emphasis: "#d4a017", exit: "#e03131", path: "#4c6ef5", media: "#868e96" };

/** The star of an animation kind (a path line for motion paths), with a hint of the effect. */
export function EffectIcon({ kind, effect, size = 22 }: { kind: AnimationKind; effect?: Effect; size?: number }) {
  const c = KIND_COLORS[kind];
  if (kind === "path" || kind === "media") {
    const d =
      effect === "pathArcs" ? "M3 15c2-10 12-10 14 0"
      : effect === "pathTurns" ? "M4 4v7c0 3 2 5 5 5h7"
      : effect === "pathShapes" ? "M10 4a6 6 0 1 0 0.01 0"
      : effect === "pathLoops" ? "M3 14c3-8 9-8 6-2s3 6 8-6"
      : effect === "pathCustom" ? "M3 15c3-8 5 2 8-5s4 2 6 3"
      : kind === "media" ? "M7 5v10l8-5z"
      : "M10 3v14";
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20">
        <path d={d} fill={kind === "media" ? c : "none"} stroke={c} strokeWidth="1.6" strokeDasharray={kind === "path" ? "2.5 1.5" : undefined} />
        {kind === "path" && <circle cx="10" cy="17" r="1.5" fill="#e03131" />}
      </svg>
    );
  }
  const star = "M10 1.8l2.4 5 5.5.7-4 3.8 1 5.4L10 14l-4.9 2.7 1-5.4-4-3.8 5.5-.7z";
  const hint: Partial<Record<Effect, ReactNode>> = {
    fade: <path d={star} fill={c} fillOpacity="0.35" stroke="none" />,
    flyIn: <path d="M1 18h5M1 15.5h3" stroke={c} strokeWidth="1.3" />,
    float: <path d="M3 19v-4M6 19v-3" stroke={c} strokeWidth="1.3" />,
    wipe: <path d="M3 18.5h14" stroke={c} strokeWidth="1.6" />,
    split: <path d="M10 0v20" stroke="#fff" strokeWidth="1.3" />,
    zoom: <circle cx="10" cy="9.5" r="2" fill="#fff" />,
    circle: <circle cx="10" cy="10" r="3" fill="none" stroke="#fff" />,
    wheel: <path d="M10 10L10 3M10 10l6 4" stroke="#fff" />,
    spin: <path d="M15.5 16.5a7 7 0 01-11 0" stroke={c} strokeWidth="1.3" fill="none" />,
    growShrink: <path d="M15 3l3-1.5M15 3l1.5-3" stroke={c} strokeWidth="1.3" />,
    pulse: <circle cx="10" cy="10" r="9" fill="none" stroke={c} strokeOpacity="0.6" />,
    teeter: <path d="M2 18l16-3" stroke={c} strokeWidth="1.3" />,
    fillColor: <rect x="13" y="13" width="6" height="6" fill="#4dabf7" />,
    fontColor: <path d="M13 19l3-7 3 7" stroke="#4dabf7" fill="none" />,
    underline: <path d="M4 19h12" stroke={c} strokeWidth="1.6" />,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20">
      {effect === "fade" ? <path d={star} fill="none" stroke={c} strokeWidth="1.2" /> : <path d={star} fill={c} />}
      {effect ? hint[effect] : null}
    </svg>
  );
}

const kindHeading = (k: AnimationKind) => `show.anim.${k}`;

/** The animation gallery: Entrance / Emphasis / Exit / Motion Paths sections (and None for the main gallery). */
export function AnimationGallery({ t, onPick, current, withNone, media }: {
  t: T;
  onPick: (choice: { kind: AnimationKind; effect: Effect } | null) => void;
  current?: Animation;
  withNone?: boolean;
  /** An audio / video clip is selected: the Media section (Play, Pause, Stop) too. */
  media?: boolean;
}) {
  return (
    <div className="flex max-h-[70vh] w-max flex-col gap-1 overflow-y-auto p-1" data-testid="animation-gallery">
      {withNone && (
        <RibbonGallery
          label={t("show.anim.none")}
          items={[{ id: "none", label: t("show.anim.none"), preview: <TransitionIcon kind="none" /> }]}
          selected={current ? undefined : "none"}
          itemClassName="h-8 w-20 text-xs"
          onSelect={() => onPick(null)}
        />
      )}
      {(media ? [...ANIMATION_KINDS, "media" as const] : ANIMATION_KINDS).map((kind, i) => {
        const items: RibbonGalleryItem[] = effectsOf(kind).map((effect) => ({
          id: `${kind}:${effect}`,
          label: t(galleryKey(effect, kind)),
          preview: <EffectIcon kind={kind} effect={effect} />,
        }));
        const cur = current && SHAPE_EFFECTS.includes(current.effect) ? "circle" : current?.effect;
        return (
          <div key={kind}>
            <div className="px-1 text-[11px] font-semibold text-ui-muted">{t(kindHeading(kind))}</div>
            <RibbonGallery
              label={t(kindHeading(kind))}
              items={items}
              columns={7}
              autoFocus={i === 0 && !withNone}
              selected={current?.kind === kind ? `${kind}:${cur}` : undefined}
              itemClassName="h-12 w-16"
              onSelect={(id) => onPick({ kind, effect: id.split(":")[1] as Effect })}
            />
          </div>
        );
      })}
    </div>
  );
}

/** The full transition gallery by section (More Transitions). */
function TransitionGallery({ t, current, onPick }: { t: T; current: TransitionKind; onPick: (k: TransitionKind) => void }) {
  return (
    <div className="flex max-h-[70vh] w-max flex-col gap-1 overflow-y-auto p-1" data-testid="transition-gallery">
      {TRANSITION_GROUPS.map((g, i) => (
        <div key={g.id}>
          <div className="px-1 text-[11px] font-semibold text-ui-muted">{t(`show.transGroup.${g.id}`)}</div>
          <RibbonGallery
            label={t(`show.transGroup.${g.id}`)}
            items={g.kinds.map((k) => ({ id: k, label: t(transitionKey(k)), preview: <TransitionIcon kind={k} /> }))}
            columns={8}
            autoFocus={i === 0}
            selected={current}
            itemClassName="h-12 w-16"
            onSelect={(k) => onPick(k as TransitionKind)}
          />
        </div>
      ))}
    </div>
  );
}

/** The sound file input of the Transitions tab (rendered once next to the ribbon). */
export function SoundInput({ store }: { store: ShowStore }) {
  return (
    <input
      type="file"
      accept="audio/wav,audio/x-wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg"
      className="hidden"
      data-testid="sound-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        void f
          .arrayBuffer()
          .then((b) => store.setTransitionSound({ file: { contentType: f.type || "audio/wav", bytesBase64: bytesToBase64(new Uint8Array(b)) } }))
          .catch((err) => store.pushError(err));
      }}
    />
  );
}

/** The ECMA kinds shown inline in the ribbon (the others under More Transitions). */
const INLINE_KINDS: TransitionKind[] = ["none", "fade", "push", "wipe", "cover", "split", "cut", "zoom"];

/** `compact`: the Timing group is one "Timing…" button with a sheet (P10-M5). */
export function transitionsTab(store: ShowStore, state: ShowState, t: T, compact = false): RibbonTab {
  const slide = state.pres?.slides.find((s) => s.id === state.current) ?? null;
  const tr = slide?.transition;
  const kind = tr?.kind ?? "none";
  const dirs = transitionDirections(kind);
  const opts = transitionOptions(kind);
  const dir = tr ? effectiveTransitionDirection(tr) : undefined;
  const opt = tr ? effectiveTransitionOption(tr) : undefined;
  const inline = INLINE_KINDS.includes(kind) ? INLINE_KINDS : [...INLINE_KINDS, kind];
  const items: RibbonGalleryItem[] = inline.map((k) => ({ id: k, label: t(transitionKey(k)), preview: <TransitionIcon kind={k} /> }));
  const options: RibbonMenuItem[] = [
    ...dirs.map((d) => ({ id: d, label: t(transitionDirectionKey(d, kind)), checked: d === dir, onSelect: () => void store.setTransition({ direction: d }) })),
    ...(opts.length && dirs.length ? [{ separator: true as const }] : []),
    ...opts.map((o) => ({ id: o, label: t(transitionOptionKey(o)), checked: o === opt, onSelect: () => void store.setTransition({ option: o }) })),
  ];
  const sound = tr?.sound;
  const soundMenu: RibbonMenuItem[] = [
    { id: "none", label: t("show.sound.none"), checked: !sound, onSelect: () => void store.setTransitionSound(null) },
    { id: "stop", label: t("show.sound.stop"), checked: sound?.kind === "stopPrevious", onSelect: () => void store.setTransitionSound({ stop: true }) },
    { id: "file", label: t("show.sound.file"), checked: sound?.kind === "play", onSelect: () => document.querySelector<HTMLInputElement>('[data-testid="sound-input"]')?.click() },
    { separator: true },
    { id: "loop", label: t("show.sound.loop"), disabled: sound?.kind !== "play", checked: sound?.kind === "play" && !!sound.value.loop, onSelect: () => void store.setTransitionSoundLoop(!(sound?.kind === "play" && sound.value.loop)) },
  ];
  const after = tr?.advanceAfterMs;
  return {
    id: "transitions",
    label: t("show.tab.transitions"),
    groups: [
      {
        label: t("show.preview"),
        items: <RibbonButton label={t("show.preview")} icon={PlayIcon} size="large" showLabel disabled={!tr || tr.durationMs <= 0} onClick={() => store.startPreview("transition")} />,
      },
      {
        label: t("show.transToSlide"),
        items: (
          <>
            <RibbonGallery label={t("show.transitions")} items={items} selected={kind} itemClassName="h-12 w-14" disabled={!slide} onSelect={(k) => void store.setTransition({ kind: k as TransitionKind })} />
            <RibbonMenuButton
              label={t("show.moreTransitions")}
              icon="chevronDown"
              disabled={!slide}
              menu={(close) => (
                <TransitionGallery
                  t={t}
                  current={kind}
                  onPick={(k) => {
                    close();
                    void store.setTransition({ kind: k });
                  }}
                />
              )}
            />
            <RibbonMenuButton label={t("show.effectOptions")} icon="format" size="large" showLabel disabled={!options.length} menu={options} />
          </>
        ),
      },
      {
        label: t("show.timing"),
        items: compact ? (
          <TimingSheetButton
            label={t("show.touch.timing")}
            body={() => (
              <>
                <SheetRow label={t("show.sound")}>
                  <select
                    aria-label={t("show.sound")}
                    className="min-h-11 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg"
                    disabled={!slide}
                    value={sound?.kind === "play" ? "file" : sound?.kind === "stopPrevious" ? "stop" : "none"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "none") void store.setTransitionSound(null);
                      else if (v === "stop") void store.setTransitionSound({ stop: true });
                      else document.querySelector<HTMLInputElement>('[data-testid="sound-input"]')?.click();
                    }}
                  >
                    <option value="none">{t("show.sound.none")}</option>
                    <option value="stop">{t("show.sound.stop")}</option>
                    <option value="file">{t("show.sound.file")}</option>
                  </select>
                </SheetRow>
                <SheetCheck
                  label={t("show.sound.loop")}
                  disabled={sound?.kind !== "play"}
                  checked={sound?.kind === "play" && !!sound.value.loop}
                  onChange={(on) => void store.setTransitionSoundLoop(on)}
                />
                <SheetRow label={t("show.durationS")}>
                  <TouchSpin label={t("show.durationS")} ms={tr?.durationMs ?? 0} min={0} disabled={!tr || kind === "none" || kind === "cut"} onCommit={(ms) => void store.setTransition({ durationMs: ms })} />
                </SheetRow>
                <SheetCheck label={t("show.onMouseClick")} disabled={!slide} checked={tr?.advanceOnClick ?? true} onChange={(on) => void store.setTransition({ advanceOnClick: on })} />
                <SheetRow label={t("show.after")}>
                  <input
                    type="checkbox"
                    aria-label={t("show.after")}
                    className="h-11 w-11"
                    disabled={!slide}
                    checked={after !== undefined}
                    onChange={(e) => void store.setTransition({ advanceAfterMs: e.target.checked ? (after ?? 0) : null })}
                  />
                  <CommitField label={t("show.afterTime")} value={msToMmss(after ?? 0)} parse={parseMmss} width="w-24 min-h-11" disabled={!slide} onCommit={(ms) => void store.setTransition({ advanceAfterMs: ms })} />
                </SheetRow>
                <SheetButton label={t("show.applyToAll")} disabled={!slide} onClick={() => void store.applyTransitionToAll()} />
              </>
            )}
          />
        ) : (
          <>
            <RibbonStack>
              <Field label={t("show.sound")}>
                <RibbonMenuButton label={t("show.sound")} tooltip={t("show.sound")} icon="chevronDown" disabled={!slide} menu={soundMenu} />
                <span className="w-24 truncate text-ui-muted" data-testid="transition-sound">
                  {sound?.kind === "play" ? t("show.sound.file") : sound?.kind === "stopPrevious" ? t("show.sound.stop") : t("show.sound.none")}
                </span>
              </Field>
              <Field label={t("show.durationS")}>
                <SpinField
                  label={t("show.durationS")}
                  ms={tr?.durationMs ?? 0}
                  min={0}
                  disabled={!tr || kind === "none" || kind === "cut"}
                  onCommit={(ms) => void store.setTransition({ durationMs: ms })}
                />
              </Field>
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.applyToAll")} icon="duplicate" showLabel disabled={!slide} onClick={() => void store.applyTransitionToAll()} />
            </RibbonStack>
            <RibbonStack>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" disabled={!slide} checked={tr?.advanceOnClick ?? true} onChange={(e) => void store.setTransition({ advanceOnClick: e.target.checked })} />
                {t("show.onMouseClick")}
              </label>
              <RibbonRow>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    disabled={!slide}
                    checked={after !== undefined}
                    onChange={(e) => void store.setTransition({ advanceAfterMs: e.target.checked ? (after ?? 0) : null })}
                  />
                  {t("show.after")}
                </label>
                <CommitField label={t("show.afterTime")} value={msToMmss(after ?? 0)} parse={parseMmss} width="w-20" disabled={!slide} onCommit={(ms) => void store.setTransition({ advanceAfterMs: ms })} />
              </RibbonRow>
            </RibbonStack>
          </>
        ),
      },
    ],
  };
}

/** PowerPoint's Effect Options colours (the standard colours row). */
export const EFFECT_COLORS = ["C00000", "FF0000", "FFC000", "FFFF00", "92D050", "00B050", "00B0F0", "0070C0", "002060", "7030A0"] as const;

/** Whether shape `id` of the current slide has text (Sequence options). */
function hasText(state: ShowState, id: number): boolean {
  const slide = state.pres?.slides.find((s) => s.id === state.current);
  const s = slide ? findShape(slide.shapes, id)?.shape : undefined;
  return s?.kind.kind === "auto" && !!s.kind.value.text?.paragraphs.some((p) => p.runs.some((r) => r.text));
}

/** The Effect Options menu of the target animation `a`. */
export function animationOptions(store: ShowStore, state: ShowState, t: T, a: Animation | undefined): RibbonMenuItem[] {
  if (!a) return [];
  const out: RibbonMenuItem[] = [];
  const sep = (label: string) => out.push({ separator: true, label });
  const set = (patch: Parameters<ShowStore["updateAnimations"]>[0]) => void store.updateAnimations(patch);
  if (SHAPE_EFFECTS.includes(a.effect)) {
    sep(t("show.opt.shapes"));
    for (const e of SHAPE_EFFECTS) out.push({ id: `shape-${e}`, label: t(`show.fx.${e}`), checked: e === a.effect, onSelect: () => set({ effect: e }) });
  }
  const dirs = effectDirections(a.effect);
  if (dirs.length) {
    sep(t("show.opt.direction"));
    const cur = effectiveAnimationDirection(a);
    for (const d of dirs) out.push({ id: `dir-${d}`, label: t(animationDirectionKey(d, a.kind, a.effect)), checked: d === cur, onSelect: () => set({ direction: d }) });
  }
  const amount = effectiveAmount(a);
  if (a.effect === "wheel") {
    sep(t("show.opt.spokes"));
    for (const n of [1, 2, 3, 4, 8]) out.push({ id: `spokes-${n}`, label: t("show.opt.spokesN", { n }), checked: n === amount, onSelect: () => set({ amount: n }) });
  }
  if (a.effect === "spin") {
    const deg = amount ?? 360;
    sep(t("show.opt.direction"));
    out.push({ id: "cw", label: t("show.opt.clockwise"), checked: deg > 0, onSelect: () => set({ amount: Math.abs(deg) }) });
    out.push({ id: "ccw", label: t("show.opt.counterclockwise"), checked: deg < 0, onSelect: () => set({ amount: -Math.abs(deg) }) });
    sep(t("show.opt.amount"));
    for (const [k, v] of [["quarter", 90], ["half", 180], ["full", 360], ["two", 720]] as const)
      out.push({ id: `spin-${v}`, label: t(`show.opt.spin.${k}`), checked: Math.abs(deg) === v, onSelect: () => set({ amount: Math.sign(deg || 1) * v }) });
  }
  if (a.effect === "growShrink") {
    sep(t("show.opt.amount"));
    for (const [k, v] of [["tiny", 25], ["smaller", 50], ["larger", 150], ["huge", 400]] as const)
      out.push({ id: `grow-${v}`, label: t(`show.opt.size.${k}`), checked: amount === v, onSelect: () => set({ amount: v }) });
  }
  if (a.effect === "transparency") {
    sep(t("show.opt.amount"));
    for (const v of [25, 50, 75, 100]) out.push({ id: `tr-${v}`, label: `${v} %`, checked: amount === v, onSelect: () => set({ amount: v }) });
  }
  if (effectHasColor(a.effect)) {
    sep(t("show.opt.color"));
    const cur = effectiveColor(a);
    for (const c of EFFECT_COLORS)
      out.push({ id: `color-${c}`, label: t(`show.color.${c}`), icon: <span className="block h-3 w-3 border border-ui-border" style={{ background: `#${c}` }} />, checked: c === cur, onSelect: () => set({ color: c }) });
  }
  if (isPathEffect(a.effect)) {
    sep(t("show.opt.path"));
    out.push({ id: "edit-points", label: t("show.opt.editPoints"), onSelect: () => store.selectAnimation(a.id) });
    out.push({
      id: "reverse",
      label: t("show.opt.reversePath"),
      onSelect: () => {
        const cmds = parsePath(effectivePath(a) ?? "");
        if (cmds) void store.setAnimationPath(a.id, formatPath(reversePath(cmds)));
      },
    });
  }
  if (a.kind !== "media" && a.kind !== "path" && hasText(state, a.shape)) {
    sep(t("show.opt.sequence"));
    out.push({ id: "seq-one", label: t("show.opt.asOneObject"), checked: !a.build, onSelect: () => set({ build: null }) });
    out.push({ id: "seq-all", label: t("show.opt.allAtOnce"), checked: a.build?.level === 0, onSelect: () => set({ build: { level: 0 } }) });
    out.push({ id: "seq-para", label: t("show.opt.byParagraph"), checked: (a.build?.level ?? 0) >= 1, onSelect: () => set({ build: { level: 1 } }) });
  }
  if (out.length) out.push({ separator: true });
  out.push({ id: "more", label: t("show.opt.more"), onSelect: () => store.openDialog({ kind: "animTiming", tab: "effect" }) });
  return out;
}

/** The Trigger menu: On Click of a shape of the slide, On Bookmark of a clip, or the click sequence. */
function triggerMenu(store: ShowStore, state: ShowState, t: T, a: Animation | undefined): RibbonMenuItem[] {
  const slide = state.pres?.slides.find((s) => s.id === state.current);
  if (!slide || !a) return [];
  const out: RibbonMenuItem[] = [{ id: "seq", label: t("show.triggerMenu.sequence"), checked: !a.startOn, onSelect: () => void store.setStartOn(null) }, { separator: true, label: t("show.triggerMenu.onClickOf") }];
  for (const s of slide.shapes) {
    const label = s.name || t("show.shapeN", { n: s.id });
    out.push({ id: `click-${s.id}`, label, checked: a.startOn?.kind === "click" && a.startOn.value === s.id, onSelect: () => void store.setStartOn({ kind: "click", value: s.id }) });
  }
  const marks = slide.shapes.flatMap((s) => (s.kind.kind === "media" ? (s.kind.value.bookmarks ?? []).map((b) => ({ shape: s.id, name: b.name })) : []));
  if (marks.length) {
    out.push({ separator: true, label: t("show.triggerMenu.onBookmark") });
    for (const m of marks)
      out.push({
        id: `bmk-${m.shape}-${m.name}`,
        label: m.name,
        checked: a.startOn?.kind === "bookmark" && a.startOn.value.shape === m.shape && a.startOn.value.name === m.name,
        onSelect: () => void store.setStartOn({ kind: "bookmark", value: m }),
      });
  }
  return out;
}

/** `compact`: the Timing group is one "Timing…" button with a sheet (P10-M5). */
export function animationsTab(store: ShowStore, state: ShowState, t: T, compact = false): RibbonTab {
  const slide = state.pres?.slides.find((s) => s.id === state.current) ?? null;
  const all = slide?.animations ?? [];
  const targets = store.targetAnimations();
  const first = targets[0];
  const hasShapes = state.selection.length > 0;
  const mediaSel = hasShapes && store.selectedShapes().every((s) => s.kind.kind === "media");
  const options = animationOptions(store, state, t, first);
  const sel = state.animSelection === null ? undefined : all.find((a) => a.id === state.animSelection);
  const styleLabel = first ? t(effectKey(first.effect, first.kind)) : t("show.animStyles");
  const pick = (c: { kind: AnimationKind; effect: Effect } | null, add: boolean) => {
    if (c?.effect === "pathCustom") {
      store.armCustomPath(true);
      return;
    }
    if (add) {
      if (c) void store.addAnimation(c.kind, c.effect);
    } else void store.applyEffect(c);
  };
  return {
    id: "animations",
    label: t("show.tab.animations"),
    groups: [
      {
        label: t("show.preview"),
        items: <RibbonButton label={t("show.preview")} icon={PlayIcon} size="large" showLabel disabled={!all.length} onClick={() => store.startPreview("animations")} />,
      },
      {
        label: t("show.animation"),
        items: (
          <>
            <RibbonMenuButton
              label={t("show.animStyles")}
              icon={first ? <EffectIcon kind={first.kind} effect={first.effect} /> : <EffectIcon kind="entrance" />}
              size="large"
              disabled={!hasShapes}
              tooltip={styleLabel}
              menu={(close) => (
                <AnimationGallery
                  t={t}
                  withNone
                  media={mediaSel}
                  current={first}
                  onPick={(c) => {
                    close();
                    pick(c, false);
                  }}
                />
              )}
            />
            <RibbonMenuButton label={t("show.effectOptions")} icon="format" size="large" showLabel disabled={!first} menu={options} />
          </>
        ),
      },
      {
        label: t("show.advancedAnim"),
        items: (
          <>
            <RibbonMenuButton
              label={t("show.addAnimation")}
              icon={<EffectIcon kind="entrance" />}
              size="large"
              showLabel
              disabled={!hasShapes}
              menu={(close) => (
                <AnimationGallery
                  t={t}
                  media={mediaSel}
                  onPick={(c) => {
                    close();
                    pick(c, true);
                  }}
                />
              )}
            />
            <RibbonStack>
              <RibbonButton label={t("show.animPane")} icon="format" showLabel pressed={state.animPane} onClick={() => store.toggleAnimPane()} />
              <RibbonMenuButton label={t("show.trigger")} icon={BOLT_ICON} showLabel disabled={!first} menu={triggerMenu(store, state, t, first)} />
            </RibbonStack>
            <RibbonStack>
              <AnimationPainterButton store={store} state={state} t={t} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.timing"),
        items: compact ? (
          <TimingSheetButton
            label={t("show.touch.timing")}
            body={() => (
              <>
                <SheetRow label={t("show.start")}>
                  <select
                    aria-label={t("show.start")}
                    className="min-h-11 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg"
                    disabled={!first}
                    value={first?.trigger ?? "onClick"}
                    onChange={(e) => void store.updateAnimations({ trigger: e.target.value as Trigger })}
                  >
                    {TRIGGERS.map((tr) => (
                      <option key={tr} value={tr}>
                        {t(triggerKey(tr))}
                      </option>
                    ))}
                  </select>
                </SheetRow>
                <SheetRow label={t("show.durationS")}>
                  <TouchSpin
                    label={t("show.animDuration")}
                    ms={first?.durationMs ?? 0}
                    min={MIN_DURATION_MS}
                    disabled={!first || first.effect === "appear" || first.kind === "media"}
                    onCommit={(ms) => void store.updateAnimations({ durationMs: clampDuration(ms) })}
                  />
                </SheetRow>
                <SheetRow label={t("show.delayS")}>
                  <TouchSpin label={t("show.delayS")} ms={first?.delayMs ?? 0} min={0} disabled={!first} onCommit={(ms) => void store.updateAnimations({ delayMs: clampDelay(ms) })} />
                </SheetRow>
                <SheetButton label={t("show.timingDialog")} disabled={!first} onClick={() => store.openDialog({ kind: "animTiming", tab: "timing" })} />
                <SheetButton label={t("show.moveEarlier")} disabled={!sel || !store.canMoveAnimation(-1)} onClick={() => void store.moveAnimation(-1)} />
                <SheetButton label={t("show.moveLater")} disabled={!sel || !store.canMoveAnimation(1)} onClick={() => void store.moveAnimation(1)} />
              </>
            )}
          />
        ) : (
          <>
            <RibbonStack>
              <Field label={t("show.start")}>
                <select
                  aria-label={t("show.start")}
                  className={`${RIBBON_SELECT} w-32`}
                  disabled={!first}
                  value={first?.trigger ?? "onClick"}
                  onChange={(e) => void store.updateAnimations({ trigger: e.target.value as Trigger })}
                >
                  {TRIGGERS.map((tr) => (
                    <option key={tr} value={tr}>
                      {t(triggerKey(tr))}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("show.durationS")}>
                <SpinField
                  label={t("show.animDuration")}
                  ms={first?.durationMs ?? 0}
                  min={MIN_DURATION_MS}
                  disabled={!first || first.effect === "appear" || first.kind === "media"}
                  onCommit={(ms) => void store.updateAnimations({ durationMs: clampDuration(ms) })}
                />
              </Field>
            </RibbonStack>
            <RibbonStack>
              <Field label={t("show.delayS")}>
                <SpinField label={t("show.delayS")} ms={first?.delayMs ?? 0} min={0} disabled={!first} onCommit={(ms) => void store.updateAnimations({ delayMs: clampDelay(ms) })} />
              </Field>
              <RibbonButton label={t("show.timingDialog")} icon="options" showLabel disabled={!first} onClick={() => store.openDialog({ kind: "animTiming", tab: "timing" })} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.moveEarlier")} icon="chevronUp" showLabel disabled={!sel || !store.canMoveAnimation(-1)} onClick={() => void store.moveAnimation(-1)} />
              <RibbonButton label={t("show.moveLater")} icon="chevronDown" showLabel disabled={!sel || !store.canMoveAnimation(1)} onClick={() => void store.moveAnimation(1)} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };
}

/** Animation Painter: a click arms it for one shape, a double-click until it is clicked again (or Esc). */
function AnimationPainterButton({ store, state, t }: { store: ShowStore; state: ShowState; t: T }) {
  const clicks = useRef(0);
  const can = state.selection.length === 1 && store.targetAnimations().length > 0;
  return (
    <RibbonButton
      label={t("show.animPainter")}
      icon={BRUSH_ICON}
      showLabel
      pressed={!!state.animPainter}
      disabled={!can && !state.animPainter}
      tooltip={t("show.animPainterTip")}
      onClick={() => {
        clicks.current++;
        const n = clicks.current;
        window.setTimeout(() => {
          if (clicks.current !== n) return;
          const sticky = n >= 2;
          clicks.current = 0;
          store.toggleAnimationPainter(sticky);
        }, 250);
      }}
    />
  );
}
