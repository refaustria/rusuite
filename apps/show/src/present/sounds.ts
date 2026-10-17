// Transition sounds in the slide show (P9-S4, `p:sndAc`): a sound plays
// when the show reaches its slide forward and stops the one before; "Loop
// Until Next Sound" repeats it until the next sound (or "[Stop Previous
// Sound]", or the end of the show).

import type { TransitionSound } from "../generated/TransitionSound";
import { mediaUrl } from "./ShowOverlay";

let current: HTMLAudioElement | null = null;

/** Stops the sound that is playing (the end of the show, Stop Previous Sound). */
export function stopTransitionSound(): void {
  if (!current) return;
  try {
    current.pause();
  } catch {
    // jsdom: no media playback
  }
  current = null;
}

/** The sound playing now (tests, e2e). */
export const playingTransitionSound = (): HTMLAudioElement | null => current;

/** Plays (or, for Stop Previous Sound, stops) a transition's sound; `media` maps media ids to data URLs. */
export function playTransitionSound(sound: TransitionSound, media: ReadonlyMap<number, string>): void {
  stopTransitionSound();
  if (sound.kind !== "play" || typeof Audio === "undefined") return;
  const url = mediaUrl(media.get(sound.value.media));
  if (!url) return;
  const el = new Audio(url);
  el.loop = !!sound.value.loop;
  el.dataset.transitionSound = String(sound.value.media);
  current = el;
  void el.play?.()?.catch(() => undefined);
}

const carried: HTMLAudioElement[] = [];

/** Play Across Slides: a clip that was playing when its slide was left keeps sounding (from `time` s) until the show ends. */
export function carryOver(url: string, time: number, loop: boolean, volume: number): void {
  if (typeof Audio === "undefined") return;
  const el = new Audio(url);
  el.loop = loop;
  el.volume = Math.max(0, Math.min(1, volume));
  try {
    el.currentTime = time;
  } catch {
    // not seekable before loading
  }
  el.dataset.acrossSlides = "1";
  carried.push(el);
  void el.play?.()?.catch(() => undefined);
}

/** The end of the show: every transition sound and carried-over clip stops. */
export function stopShowSounds(): void {
  stopTransitionSound();
  for (const el of carried.splice(0)) {
    try {
      el.pause();
    } catch {
      // jsdom
    }
  }
}
