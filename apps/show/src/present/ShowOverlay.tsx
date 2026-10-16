// DOM layer over the slide in the slide show (P8-24): the slide's links
// (an anchor per web address – opened in a new tab by the browser, no
// `window.open` – and a button per jump) and its audio / video as HTML5
// media elements with controls at the shape's place (Automatically clips
// start when the slide appears, "In Click Sequence" clips when the click of
// their step comes; looping, volume, mute and "hide while not playing" as
// set on the Playback tab).

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckContext } from "../design/deck";
import type { Hyperlink } from "../generated/Hyperlink";
import type { MediaClip } from "../generated/MediaClip";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import { emuToPx, fitScale, slidePx } from "../geometry";
import { themePalette } from "../model";
import { linkRegions, safeUrl } from "../links/regions";
import { startedMedia } from "../anim/playback";

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

/** One clip of the slide. */
function Clip({ shape, clip, url, poster, scale, started }: { shape: Shape; clip: MediaClip; url: string | undefined; poster: string | undefined; scale: number; started: boolean }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, (clip.volume ?? 100000) / 100000));
    el.muted = !!clip.muted;
    if (clip.start === "automatically") void el.play?.()?.catch(() => undefined);
  }, [clip.volume, clip.muted, clip.start, url]);
  // "In Click Sequence": the click of its step starts it (going back stops it)
  useEffect(() => {
    const el = ref.current;
    if (!el || clip.start !== "inClickSequence") return;
    if (started) void el.play?.()?.catch(() => undefined);
    else {
      el.pause?.();
      if (el.currentTime) el.currentTime = 0;
    }
  }, [started, clip.start, url]);
  const t = shape.transform;
  const box = { left: emuToPx(t.x) * scale, top: emuToPx(t.y) * scale, width: emuToPx(t.w) * scale, height: emuToPx(t.h) * scale };
  const hidden = !!clip.hideWhenNotPlaying && !playing;
  const common = {
    ref,
    src: url,
    controls: true,
    loop: !!clip.loop,
    preload: "auto" as const,
    "data-testid": `show-media-${shape.id}`,
    "data-media": clip.kind,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
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

export function ShowOverlay({ deck, slide, step = 0, media, width, height, onLink }: ShowOverlayProps) {
  const scale = fitScale(width, height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  const palette = useMemo(() => themePalette(deck.theme), [deck.theme]);
  const regions = useMemo(() => linkRegions(deck, slide, palette), [deck, slide, palette]);
  const clips = slide.shapes.filter((s): s is Shape & { kind: { kind: "media"; value: MediaClip } } => s.kind.kind === "media");
  const started = new Set(startedMedia(slide, step));
  if (scale <= 0 || (!regions.length && !clips.length)) return null;
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
      {clips.map((s) => (
        <span key={s.id} className="pointer-events-auto">
          <Clip shape={s} clip={s.kind.value} url={mediaUrl(media.get(s.kind.value.media))} poster={s.kind.value.poster !== undefined ? media.get(s.kind.value.poster) : undefined} scale={scale} started={started.has(s.id)} />
        </span>
      ))}
    </div>
  );
}
