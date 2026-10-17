// DOM layer over the slide in the slide show (P8-24, P9-S4): the slide's
// links (an anchor per web address – opened in a new tab by the browser, no
// `window.open` – and a button per jump), the trigger shapes of triggered
// animations (a click plays the trigger's next step instead of advancing
// the show) and its audio / video as HTML5 media elements with controls at
// the shape's place (Automatically clips start when the slide appears, "In
// Click Sequence" clips when the click of their step comes, Play / Pause /
// Stop animations as they run; trim, fade in / out, bookmarks that fire
// their triggers, rewind after playing, play across slides, looping,
// volume, mute and "hide while not playing" as set on the Playback tab).

import { useEffect, useMemo, useRef, useState } from "react";
import { deckFor, type DeckContext } from "../design/deck";
import type { Hyperlink } from "../generated/Hyperlink";
import type { MediaClip } from "../generated/MediaClip";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import { emuToPx, fitScale, slidePx } from "../geometry";
import { themePalette } from "../model";
import { linkRegions, safeUrl } from "../links/regions";
import { mediaCommands, triggerSequences } from "../anim/playback";
import { carryOver } from "./sounds";

export interface ShowOverlayProps {
  deck: DeckContext;
  slide: Slide;
  /** Click steps done on the slide (clips "In Click Sequence" start when their step comes). */
  step?: number;
  media: ReadonlyMap<number, string>;
  /** The screen the slide is letterboxed into. */
  width: number;
  height: number;
  onLink: (link: Hyperlink) => void;
  /** Triggers fired on this slide (their media commands run too). */
  fired?: readonly string[];
  /** A trigger fired: a click on its shape, or a clip passed its bookmark (`startOnKey`). */
  onTrigger?: (key: string) => void;
  /** Slide Show › Show Media Controls (P9-S5; default shown). */
  controls?: boolean;
}

const blobUrls = new Map<string, string>();

/**
 * A `blob:` URL for a media data URL (media elements play blob URLs; the
 * page's policy allows `blob:` but not `data:` for media). Cached per data
 * URL for the page's lifetime.
 */
export function mediaUrl(dataUrl: string | undefined): string | undefined {
  if (!dataUrl) return undefined;
  const hit = blobUrls.get(dataUrl);
  if (hit) return hit;
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m || typeof URL.createObjectURL !== "function") return dataUrl;
  const raw = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: m[1] || "application/octet-stream" }));
  blobUrls.set(dataUrl, url);
  return url;
}

/** The volume of a clip at `t` s of its trimmed play (Fade In / Fade Out ramps). */
export function fadeVolume(clip: Pick<MediaClip, "volume" | "fadeInMs" | "fadeOutMs" | "trimStartMs" | "trimEndMs">, t: number, duration: number): number {
  const v = Math.max(0, Math.min(1, (clip.volume ?? 100000) / 100000));
  const start = (clip.trimStartMs ?? 0) / 1000;
  const end = Number.isFinite(duration) && duration > 0 ? duration - (clip.trimEndMs ?? 0) / 1000 : Infinity;
  const fi = (clip.fadeInMs ?? 0) / 1000;
  const fo = (clip.fadeOutMs ?? 0) / 1000;
  let k = 1;
  if (fi > 0) k = Math.min(k, Math.max(0, (t - start) / fi));
  if (fo > 0 && Number.isFinite(end)) k = Math.min(k, Math.max(0, (end - t) / fo));
  return v * Math.max(0, Math.min(1, k));
}

/** The bookmarks a clip passed between `from` and `to` s (playback moved on). */
export function passedBookmarks(clip: Pick<MediaClip, "bookmarks">, from: number, to: number): string[] {
  if (to <= from) return [];
  return (clip.bookmarks ?? []).filter((b) => b.timeMs / 1000 > from && b.timeMs / 1000 <= to).map((b) => b.name);
}

/** One clip of the slide. */
function Clip({ shape, clip, url, poster, scale, command, onBookmark, controls }: {
  shape: Shape;
  controls: boolean;
  clip: MediaClip;
  url: string | undefined;
  poster: string | undefined;
  scale: number;
  /** The last Play / Pause / Stop of the click sequence for this clip. */
  command: "play" | "pause" | "stop" | undefined;
  onBookmark: (name: string) => void;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const lastTime = useRef(0);
  const trimStart = (clip.trimStartMs ?? 0) / 1000;
  const play = (el: HTMLMediaElement) => {
    if (el.currentTime < trimStart) el.currentTime = trimStart;
    void el.play?.()?.catch(() => undefined);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = fadeVolume(clip, el.currentTime || trimStart, el.duration);
    el.muted = !!clip.muted;
    if (trimStart && !el.currentTime) el.currentTime = trimStart;
    if (clip.start === "automatically") play(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.volume, clip.muted, clip.start, url]);
  // Play / Pause / Stop from the click sequence ("In Click Sequence" clips, media animations); going back stops it
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (command === "play") play(el);
    else if (command === "pause") el.pause?.();
    else if (command === "stop" || clip.start === "inClickSequence") {
      el.pause?.();
      if (el.currentTime !== trimStart) el.currentTime = trimStart;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, clip.start, url]);
  // Play Across Slides: a playing clip keeps sounding when the slide changes
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (clip.playAcrossSlides && el && !el.paused && url) carryOver(url, el.currentTime, !!clip.loop, el.volume);
    };
  }, [clip.playAcrossSlides, clip.loop, url]);
  const onTime = () => {
    const el = ref.current;
    if (!el) return;
    const now = el.currentTime;
    el.volume = fadeVolume(clip, now, el.duration);
    for (const name of passedBookmarks(clip, lastTime.current, now)) onBookmark(name);
    lastTime.current = now;
    // the trimmed end
    const end = Number.isFinite(el.duration) ? el.duration - (clip.trimEndMs ?? 0) / 1000 : Infinity;
    if (now >= end && (clip.trimEndMs ?? 0) > 0) {
      if (clip.loop) el.currentTime = trimStart;
      else {
        el.pause();
        if (clip.rewind) el.currentTime = trimStart;
        setPlaying(false);
      }
    }
  };
  const t = shape.transform;
  const box = { left: emuToPx(t.x) * scale, top: emuToPx(t.y) * scale, width: emuToPx(t.w) * scale, height: emuToPx(t.h) * scale };
  const hidden = !!clip.hideWhenNotPlaying && !playing;
  const common = {
    ref,
    src: url,
    controls,
    loop: !!clip.loop && !(clip.trimEndMs ?? 0),
    preload: "auto" as const,
    "data-testid": `show-media-${shape.id}`,
    "data-media": clip.kind,
    "data-trim-start": clip.trimStartMs ?? 0,
    "data-trim-end": clip.trimEndMs ?? 0,
    "data-command": command,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      const el = ref.current;
      if (el && clip.rewind) el.currentTime = trimStart;
    },
    onTimeUpdate: onTime,
    onSeeked: () => {
      lastTime.current = ref.current?.currentTime ?? 0;
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  if (clip.kind === "audio") {
    const w = Math.max(box.width, 220);
    return (
      <audio
        {...common}
        className="absolute"
        style={{ left: box.left + box.width / 2 - w / 2, top: box.top + box.height + 4, width: w, opacity: hidden ? 0 : 1 }}
      />
    );
  }
  return <video {...common} poster={poster} className="absolute bg-black object-contain" style={{ ...box, opacity: hidden ? 0 : 1 }} />;
}

export function ShowOverlay({ deck: given, slide, step = 0, media, width, height, onLink, fired = [], onTrigger, controls = true }: ShowOverlayProps) {
  const deck = deckFor(given, slide);
  const scale = fitScale(width, height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  const palette = useMemo(() => themePalette(deck.theme), [deck.theme]);
  const regions = useMemo(() => linkRegions(deck, slide, palette), [deck, slide, palette]);
  const clips = slide.shapes.filter((s): s is Shape & { kind: { kind: "media"; value: MediaClip } } => s.kind.kind === "media");
  const commands = mediaCommands(slide, step, fired);
  // the shapes clicked to fire triggers (the top-level shape's box)
  const triggers = triggerSequences(slide).flatMap((seq) => {
    if (seq.startOn.kind !== "click") return [];
    const id = seq.startOn.value;
    const top = slide.shapes.find((s) => s.id === id || (s.kind.kind === "group" && JSON.stringify(s.kind.value).includes(`"id":${id},`)));
    return top ? [{ key: seq.key, shape: top }] : [];
  });
  if (scale <= 0 || (!regions.length && !clips.length && !triggers.length)) return null;
  const left = (width - px.width * scale) / 2;
  const top = (height - px.height * scale) / 2;
  return (
    <div className="pointer-events-none absolute z-10" style={{ left, top, width: px.width * scale, height: px.height * scale }} data-testid="show-overlay">
      {regions.map((r, i) => {
        const style = { left: r.x * scale, top: r.y * scale, width: Math.max(4, r.w * scale), height: Math.max(4, r.h * scale) };
        const tip = r.link.tooltip ?? (r.link.target.kind === "url" ? r.link.target.value : undefined);
        const cls = "pointer-events-auto absolute block cursor-pointer";
        if (r.link.target.kind === "url") {
          const url = r.link.target.value;
          return (
            <a
              key={i}
              href={safeUrl(url) ? url : undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={tip}
              aria-label={tip ?? url}
              className={cls}
              style={style}
              data-testid="show-link"
              data-link={url}
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        return (
          <button
            key={i}
            type="button"
            title={tip}
            aria-label={tip ?? r.link.target.kind}
            className={`${cls} bg-transparent`}
            style={style}
            data-testid="show-link"
            data-link={r.link.target.kind === "slide" ? r.link.target.value.kind : r.link.target.kind}
            onClick={(e) => {
              e.stopPropagation();
              onLink(r.link);
            }}
          />
        );
      })}
      {triggers.map(({ key, shape: s }) => {
        const tr = s.transform;
        return (
          <button
            key={key}
            type="button"
            aria-label={s.name || key}
            className="pointer-events-auto absolute cursor-pointer bg-transparent"
            style={{ left: emuToPx(tr.x) * scale, top: emuToPx(tr.y) * scale, width: Math.max(4, emuToPx(tr.w) * scale), height: Math.max(4, emuToPx(tr.h) * scale) }}
            data-testid="show-trigger"
            data-trigger={key}
            onClick={(e) => {
              e.stopPropagation();
              onTrigger?.(key);
            }}
          />
        );
      })}
      {clips.map((s) => (
        <span key={s.id} className="pointer-events-auto">
          <Clip
            shape={s}
            clip={s.kind.value}
            url={mediaUrl(media.get(s.kind.value.media))}
            poster={s.kind.value.poster !== undefined ? media.get(s.kind.value.poster) : undefined}
            scale={scale}
            command={commands.get(s.id)}
            onBookmark={(name) => onTrigger?.(`bmk:${s.id}:${name}`)}
            controls={controls}
          />
        </span>
      ))}
    </div>
  );
}
