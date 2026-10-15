// The Transitions and Animations tabs of Show's ribbon (P8-8), like
// PowerPoint's: the transition gallery with Effect Options (the kind's
// directions), Duration, Advance Slide (On Mouse Click, After mm:ss),
// Apply To All and Preview; the animation gallery grouped Entrance /
// Emphasis / Exit, Effect Options, Add Animation, the Animation Pane
// toggle, Start / Duration / Delay, Move Earlier / Later and Preview.

import { useEffect, useState, type ReactNode } from "react";
import { RIBBON_SELECT, RibbonButton, type TFunction, RibbonGallery, RibbonMenuButton, RibbonRow, RibbonStack, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab } from "@rusuite/ui-shared";
import type { Animation } from "../generated/Animation";
import type { AnimationKind } from "../generated/AnimationKind";
import type { Effect } from "../generated/Effect";
import type { TransitionKind } from "../generated/TransitionKind";
import type { Trigger } from "../generated/Trigger";
import {
  ANIMATION_KINDS, TRANSITION_KINDS, TRIGGERS, animationDirectionKey, effectDirections, effectKey, effectiveAnimationDirection,
  effectiveTransitionDirection, effectsOf, msToMmss, msToSeconds, parseMmss, secondsToMs, transitionDirectionKey, transitionDirections,
  transitionKey, triggerKey,
} from "../anim/effects";
import type { ShowState, ShowStore } from "../state/store";

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

/** Small picture of a transition kind (gallery). */
export function TransitionIcon({ kind }: { kind: TransitionKind }) {
  const box = <rect x="1" y="1" width="30" height="20" rx="1" fill="none" stroke="currentColor" strokeOpacity="0.5" />;
  const art: Record<TransitionKind, ReactNode> = {
    none: <path d="M10 6l12 10M22 6L10 16" stroke="currentColor" strokeOpacity="0.5" />,
    fade: <rect x="1" y="1" width="30" height="20" fill="url(#fade-grad)" />,
    push: (
      <>
        <rect x="1" y="1" width="14" height="20" fill="#c2410c" fillOpacity="0.25" />
        <rect x="15" y="1" width="16" height="20" fill="#c2410c" fillOpacity="0.7" />
        <path d="M24 11h-7m2.5-2.5L17 11l2.5 2.5" stroke="#fff" />
      </>
    ),
    wipe: (
      <>
        <rect x="12" y="1" width="19" height="20" fill="#c2410c" fillOpacity="0.7" />
        <path d="M12 1v20" stroke="#fff" strokeWidth="2" />
      </>
    ),
    cover: (
      <>
        <rect x="9" y="1" width="22" height="20" fill="#c2410c" fillOpacity="0.7" />
        <path d="M9 1v20" stroke="currentColor" strokeOpacity="0.6" />
      </>
    ),
    split: <rect x="1" y="6" width="30" height="10" fill="#c2410c" fillOpacity="0.7" />,
    cut: <path d="M16 1v20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />,
    zoom: <rect x="9" y="6" width="14" height="10" fill="#c2410c" fillOpacity="0.7" />,
  };
  return (
    <svg aria-hidden="true" width="32" height="22" viewBox="0 0 32 22">
      <defs>
        <linearGradient id="fade-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#c2410c" stopOpacity="0" />
          <stop offset="1" stopColor="#c2410c" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      {art[kind]}
      {box}
    </svg>
  );
}

/** PowerPoint's colours of the animation kinds (green entrance, gold emphasis, red exit). */
export const KIND_COLORS: Record<AnimationKind, string> = { entrance: "#2f9e44", emphasis: "#d4a017", exit: "#e03131" };

/** The star of an animation kind, with a hint of the effect. */
export function EffectIcon({ kind, effect, size = 22 }: { kind: AnimationKind; effect?: Effect; size?: number }) {
  const c = KIND_COLORS[kind];
  const star = "M10 1.8l2.4 5 5.5.7-4 3.8 1 5.4L10 14l-4.9 2.7 1-5.4-4-3.8 5.5-.7z";
  const hint: Partial<Record<Effect, ReactNode>> = {
    fade: <path d={star} fill={c} fillOpacity="0.35" stroke="none" />,
    flyIn: <path d="M1 18h5M1 15.5h3" stroke={c} strokeWidth="1.3" />,
    wipe: <path d="M3 18.5h14" stroke={c} strokeWidth="1.6" />,
    zoom: <circle cx="10" cy="9.5" r="2" fill="#fff" />,
    spin: <path d="M15.5 16.5a7 7 0 01-11 0" stroke={c} strokeWidth="1.3" fill="none" />,
    growShrink: <path d="M15 3l3-1.5M15 3l1.5-3" stroke={c} strokeWidth="1.3" />,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20">
      {effect === "fade" ? <path d={star} fill="none" stroke={c} strokeWidth="1.2" /> : <path d={star} fill={c} />}
      {effect ? hint[effect] : null}
    </svg>
  );
}

const kindHeading = (k: AnimationKind) => `show.anim.${k}`;

/** The animation gallery: Entrance / Emphasis / Exit sections (and None for the main gallery). */
export function AnimationGallery({ t, onPick, current, withNone }: {
  t: T;
  onPick: (choice: { kind: AnimationKind; effect: Effect } | null) => void;
  current?: Animation;
  withNone?: boolean;
}) {
  return (
    <div className="flex w-max flex-col gap-1 p-1" data-testid="animation-gallery">
      {withNone && (
        <RibbonGallery
          label={t("show.anim.none")}
          items={[{ id: "none", label: t("show.anim.none"), preview: <TransitionIcon kind="none" /> }]}
          selected={current ? undefined : "none"}
          itemClassName="h-8 w-20 text-xs"
          onSelect={() => onPick(null)}
        />
      )}
      {ANIMATION_KINDS.map((kind, i) => {
        const items: RibbonGalleryItem[] = effectsOf(kind).map((effect) => ({
          id: `${kind}:${effect}`,
          label: t(effectKey(effect, kind)),
          preview: <EffectIcon kind={kind} effect={effect} />,
        }));
        return (
          <div key={kind}>
            <div className="px-1 text-[11px] font-semibold text-ui-muted">{t(kindHeading(kind))}</div>
            <RibbonGallery
              label={t(kindHeading(kind))}
              items={items}
              columns={5}
              autoFocus={i === 0 && !withNone}
              selected={current?.kind === kind ? `${kind}:${current.effect}` : undefined}
              itemClassName="h-12 w-16"
              onSelect={(id) => onPick({ kind, effect: id.split(":")[1] as Effect })}
            />
          </div>
        );
      })}
    </div>
  );
}

export function transitionsTab(store: ShowStore, state: ShowState, t: T): RibbonTab {
  const slide = state.pres?.slides.find((s) => s.id === state.current) ?? null;
  const tr = slide?.transition;
  const kind = tr?.kind ?? "none";
  const dirs = transitionDirections(kind);
  const dir = tr ? effectiveTransitionDirection(tr) : undefined;
  const items: RibbonGalleryItem[] = TRANSITION_KINDS.map((k) => ({ id: k, label: t(transitionKey(k)), preview: <TransitionIcon kind={k} /> }));
  const options: RibbonMenuItem[] = dirs.map((d) => ({
    id: d,
    label: t(transitionDirectionKey(d)),
    checked: d === dir,
    onSelect: () => void store.setTransition({ direction: d }),
  }));
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
            <RibbonMenuButton label={t("show.effectOptions")} icon="format" size="large" showLabel disabled={!dirs.length} menu={options} />
          </>
        ),
      },
      {
        label: t("show.timing"),
        items: (
          <>
            <RibbonStack>
              <Field label={t("show.durationS")}>
                <CommitField
                  label={t("show.durationS")}
                  value={msToSeconds(tr?.durationMs ?? 0)}
                  parse={secondsToMs}
                  disabled={!tr || kind === "none" || kind === "cut"}
                  onCommit={(ms) => void store.setTransition({ durationMs: ms })}
                />
              </Field>
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

export function animationsTab(store: ShowStore, state: ShowState, t: T): RibbonTab {
  const slide = state.pres?.slides.find((s) => s.id === state.current) ?? null;
  const all = slide?.animations ?? [];
  const sel = state.animSelection === null ? undefined : all.find((a) => a.id === state.animSelection);
  const targets = store.targetAnimations();
  const first = targets[0];
  const hasShapes = state.selection.length > 0;
  const dirs = first ? effectDirections(first.effect) : [];
  const dir = first ? effectiveAnimationDirection(first) : undefined;
  const options: RibbonMenuItem[] = first
    ? dirs.map((d) => ({ id: d, label: t(animationDirectionKey(d, first.kind)), checked: d === dir, onSelect: () => void store.updateAnimations({ direction: d }) }))
    : [];
  const index = sel ? all.indexOf(sel) : -1;
  const styleLabel = first ? t(effectKey(first.effect, first.kind)) : t("show.animStyles");
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
                  current={first}
                  onPick={(c) => {
                    close();
                    void store.applyEffect(c);
                  }}
                />
              )}
            />
            <RibbonMenuButton label={t("show.effectOptions")} icon="format" size="large" showLabel disabled={!dirs.length} menu={options} />
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
                  onPick={(c) => {
                    close();
                    if (c) void store.addAnimation(c.kind, c.effect);
                  }}
                />
              )}
            />
            <RibbonButton label={t("show.animPane")} icon="format" size="large" showLabel pressed={state.animPane} onClick={() => store.toggleAnimPane()} />
          </>
        ),
      },
      {
        label: t("show.timing"),
        items: (
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
                <CommitField
                  label={t("show.animDuration")}
                  value={msToSeconds(first?.durationMs ?? 0)}
                  parse={secondsToMs}
                  disabled={!first || first.effect === "appear"}
                  onCommit={(ms) => void store.updateAnimations({ durationMs: ms })}
                />
              </Field>
            </RibbonStack>
            <RibbonStack>
              <Field label={t("show.delayS")}>
                <CommitField label={t("show.delayS")} value={msToSeconds(first?.delayMs ?? 0)} parse={secondsToMs} disabled={!first} onCommit={(ms) => void store.updateAnimations({ delayMs: ms })} />
              </Field>
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.moveEarlier")} icon="chevronUp" showLabel disabled={index <= 0} onClick={() => void store.moveAnimation(-1)} />
              <RibbonButton label={t("show.moveLater")} icon="chevronDown" showLabel disabled={index < 0 || index >= all.length - 1} onClick={() => void store.moveAnimation(1)} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };
}
