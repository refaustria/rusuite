// Audio / video in Show (P8-24): Insert › Video / Audio (file pickers) and
// the contextual Playback tab of selected clips – Start ▾ (When Clicked
// On, Automatically, In Click Sequence), Loop until Stopped, Hide While
// Not Playing, Volume ▾ (Low, Medium, High, Mute) and Poster Frame ▾
// (Image from File…, Reset). Trimming is not offered.

import { useRef, type ReactNode } from "react";
import { RIBBON_SELECT, RibbonButton, RibbonMenuButton, RibbonStack, bytesToBase64, type RibbonTab, type TFunction } from "@rusuite/ui-shared";
import type { MediaClip } from "../generated/MediaClip";
import type { MediaStart } from "../generated/MediaStart";
import type { ShowState, ShowStore } from "../state/store";
import { AUDIO_ACCEPT, VIDEO_ACCEPT, mediaType } from "../state/rich";

/** Playback › Volume levels (1/1000 %). */
export const VOLUMES = [
  { id: "low", volume: 25000 },
  { id: "medium", volume: 50000 },
  { id: "high", volume: 100000 },
] as const;

/** The Volume menu entry of a clip. */
export function volumeLevel(c: MediaClip): "low" | "medium" | "high" | "mute" {
  if (c.muted) return "mute";
  const v = c.volume ?? 100000;
  return v <= 25000 ? "low" : v <= 50000 ? "medium" : "high";
}

const STARTS: MediaStart[] = ["onClick", "automatically", "inClickSequence"];

/** Reads a picked file as base64 and hands it on. */
async function readFile(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Insert › Media: Video and Audio buttons with their (hidden) file inputs. */
export function MediaInsertButtons({ store, t, disabled }: { store: ShowStore; t: TFunction; disabled: boolean }): ReactNode {
  const video = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const type = mediaType(file);
    if (!type) {
      store.pushError(new Error(t("show.media.unsupported", { name: file.name })));
      return;
    }
    void readFile(file)
      .then((b) => store.insertMedia(type, b))
      .catch((e) => store.pushError(e));
  };
  return (
    <>
      <RibbonButton label={t("show.media.video")} icon="present" size="large" tooltip={t("show.media.videoTip")} disabled={disabled} onClick={() => video.current?.click()} />
      <RibbonButton label={t("show.media.audio")} icon={<SpeakerIcon />} size="large" tooltip={t("show.media.audioTip")} disabled={disabled} onClick={() => audio.current?.click()} />
      <input
        ref={video}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        data-testid="video-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          pick(f);
        }}
      />
      <input
        ref={audio}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        data-testid="audio-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          pick(f);
        }}
      />
    </>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" fillOpacity="0.15" />
      <path d="M13 7.5c1.2 1.4 1.2 3.6 0 5M15 5.5c2.4 2.6 2.4 6.4 0 9" />
    </svg>
  );
}

/** The poster file input of the Playback tab (rendered once next to the ribbon). */
export function PosterInput({ store }: { store: ShowStore }) {
  return (
    <input
      type="file"
      accept="image/png,image/jpeg,image/gif"
      className="hidden"
      data-testid="poster-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        void readFile(f)
          .then((b) => store.setMediaPoster({ contentType: f.type || "image/png", bytesBase64: b }))
          .catch((err) => store.pushError(err));
      }}
    />
  );
}

/** Playback (contextual, audio / video selected). */
export function playbackTab(store: ShowStore, state: ShowState, t: TFunction): RibbonTab | null {
  void state;
  const clips = store.selectedMedia();
  const first = clips[0];
  if (!first || first.kind.kind !== "media") return null;
  const c = first.kind.value;
  const one = clips.length === 1;
  const level = volumeLevel(c);
  return {
    id: "playback",
    label: t("show.media.playback"),
    groups: [
      {
        label: t("show.media.options"),
        items: (
          <>
            <RibbonStack>
              <span className="text-xs">{t("show.media.start")}</span>
              <select aria-label={t("show.media.start")} className={`${RIBBON_SELECT} w-36`} value={c.start} onChange={(e) => void store.setMediaProps({ start: e.target.value as MediaStart })}>
                {STARTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`show.media.start.${s}`)}
                  </option>
                ))}
              </select>
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.media.loop")} icon="redo" showLabel pressed={!!c.loop} onClick={() => void store.setMediaProps({ loop: !c.loop })} />
              <RibbonButton label={t("show.media.hide")} icon="close" showLabel pressed={!!c.hideWhenNotPlaying} onClick={() => void store.setMediaProps({ hideWhenNotPlaying: !c.hideWhenNotPlaying })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.media.volume"),
        items: (
          <RibbonMenuButton
            label={t("show.media.volume")}
            icon={<SpeakerIcon />}
            size="large"
            menu={[
              ...VOLUMES.map((v) => ({ id: v.id, label: t(`show.media.volume.${v.id}`), checked: level === v.id, onSelect: () => void store.setMediaProps({ volume: v.volume, muted: false }) })),
              { id: "mute", label: t("show.media.volume.mute"), checked: level === "mute", onSelect: () => void store.setMediaProps({ muted: true }) },
            ]}
          />
        ),
      },
      {
        label: t("show.media.poster"),
        items: (
          <RibbonMenuButton
            label={t("show.media.poster")}
            icon="image"
            size="large"
            disabled={!one}
            menu={[
              { id: "file", label: t("show.media.posterFile"), onSelect: () => document.querySelector<HTMLInputElement>('[data-testid="poster-input"]')?.click() },
              { id: "reset", label: t("show.media.posterReset"), disabled: c.poster === undefined, onSelect: () => void store.setMediaPoster(null) },
            ]}
          />
        ),
      },
    ],
  };
}
