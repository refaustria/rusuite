// Presenter view ↔ audience window (P7-8). The presenter (main window) owns
// the show; the audience window renders it. Messages go over a
// `BroadcastChannel` on the web and Tauri events on the desktop; both are
// behind `SyncChannel`, so the show logic is tested with `fakeSyncPair`.

import { isTauri } from "@rusuite/ui-shared";
import type { DeckContext } from "../canvas/SlideView";
import type { Slide } from "../generated/Slide";
import type { Blank, ShowAction } from "./showState";
import { t } from "../i18n";

export type SyncRole = "presenter" | "audience";

/** What the audience screen shows. */
export interface ShowView {
  slideIndex: number;
  blackout: Blank;
  ended: boolean;
}

export type SyncMessage =
  /** presenter → audience: the slide shown, blank screen, end slide. */
  | ({ kind: "state" } & ShowView)
  /** presenter → audience: the slides of the show (JSON-safe: media as entries). */
  | { kind: "deck"; deck: DeckContext; slides: Slide[]; media: [number, string][] }
  /** audience → presenter: the window is ready, send the deck. */
  | { kind: "hello" }
  /** audience → presenter: a key or click in the audience window. */
  | { kind: "action"; action: ShowAction }
  /** presenter → audience: the show ended, close. */
  | { kind: "end" }
  /** audience → presenter: the window was closed. */
  | { kind: "bye" };

export interface SyncChannel {
  post(msg: SyncMessage): void;
  /** Messages from the other side; returns the unsubscribe. */
  listen(fn: (msg: SyncMessage) => void): () => void;
  close(): void;
}

interface Envelope {
  from: SyncRole;
  msg: SyncMessage;
}

const channelName = (id: string) => `rusuite-show-presenter-${id}`;

/** Web: a `BroadcastChannel` between same-origin windows. */
export function broadcastSync(id: string, role: SyncRole): SyncChannel {
  const ch = new BroadcastChannel(channelName(id));
  const fns = new Set<(m: SyncMessage) => void>();
  ch.onmessage = (e: MessageEvent<Envelope>) => {
    if (e.data?.from !== role) for (const fn of fns) fn(e.data.msg);
  };
  return {
    post: (msg) => ch.postMessage({ from: role, msg } satisfies Envelope),
    listen: (fn) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    close: () => {
      fns.clear();
      ch.close();
    },
  };
}

/** Desktop: Tauri events (an emitter also hears its own events, so they carry the sender). */
export async function tauriSync(id: string, role: SyncRole): Promise<SyncChannel> {
  const { emit, listen } = await import("@tauri-apps/api/event");
  const fns = new Set<(m: SyncMessage) => void>();
  const unlisten = await listen<Envelope>(channelName(id), (e) => {
    if (e.payload?.from !== role) for (const fn of fns) fn(e.payload.msg);
  });
  return {
    post: (msg) => void emit(channelName(id), { from: role, msg } satisfies Envelope).catch(() => undefined),
    listen: (fn) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    close: () => {
      fns.clear();
      unlisten();
    },
  };
}

export function openSync(id: string, role: SyncRole): Promise<SyncChannel> {
  return isTauri() ? tauriSync(id, role) : Promise.resolve(broadcastSync(id, role));
}

/** Two connected in-memory channels (tests): `[presenter, audience]`. */
export function fakeSyncPair(): [SyncChannel, SyncChannel] {
  const sides = [new Set<(m: SyncMessage) => void>(), new Set<(m: SyncMessage) => void>()];
  const side = (mine: number): SyncChannel => ({
    // Copies like structured clone / JSON would, so nothing is shared by reference.
    post: (msg) => {
      const copy = JSON.parse(JSON.stringify(msg)) as SyncMessage;
      for (const fn of sides[1 - mine]!) fn(copy);
    },
    listen: (fn) => {
      sides[mine]!.add(fn);
      return () => sides[mine]!.delete(fn);
    },
    close: () => sides[mine]!.clear(),
  });
  return [side(0), side(1)];
}

// ----- the audience window -----------------------------------------------------------------

export interface AudienceWindow {
  /** False once the window is gone (`null` = unknown, e.g. desktop). */
  isOpen(): boolean | null;
  close(): void;
}

/** A presenter view's link to its audience window: `window` resolves to `null` when it could not be opened. */
export interface AudienceLink {
  id: string;
  sync: Promise<SyncChannel>;
  window: Promise<AudienceWindow | null>;
}

/** The `?audience=<id>` of an audience window's URL, else `null`. */
export function audienceIdOf(search: string): string | null {
  const id = new URLSearchParams(search).get("audience");
  return id && /^[a-z0-9]+$/i.test(id) ? id : null;
}

export const AUDIENCE_LABEL = "audience";

function audienceUrl(id: string): string {
  const url = new URL(window.location.href);
  url.search = `?audience=${id}`;
  url.hash = "";
  return url.href;
}

async function openTauriAudience(url: string): Promise<AudienceWindow | null> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { availableMonitors, currentMonitor } = await import("@tauri-apps/api/window");
  await (await WebviewWindow.getByLabel(AUDIENCE_LABEL))?.close().catch(() => undefined);
  // A second monitor gets the audience full screen (like PowerPoint); with one, a normal window.
  let place: { x: number; y: number; fullscreen: boolean } | null = null;
  try {
    const [all, here] = await Promise.all([availableMonitors(), currentMonitor()]);
    const other = all.find((m) => !here || m.position.x !== here.position.x || m.position.y !== here.position.y);
    if (other && all.length > 1) place = { x: other.position.x / other.scaleFactor, y: other.position.y / other.scaleFactor, fullscreen: true };
  } catch {
    // Monitor information unavailable: a normal window.
  }
  const win = new WebviewWindow(AUDIENCE_LABEL, {
    url,
    title: `Rusuite Show – ${t("show.slideShow")}`,
    width: 960,
    height: 540,
    ...(place ?? {}),
  });
  return new Promise((resolve) => {
    void win.once("tauri://created", () =>
      resolve({ isOpen: () => null, close: () => void win.close().catch(() => undefined) }),
    );
    void win.once("tauri://error", () => resolve(null));
  });
}

/**
 * Opens the audience window. On the web `window.open` runs synchronously, so call this straight from the key or
 * click handler (popup blockers allow windows opened by a user gesture).
 */
export function launchAudience(): AudienceLink {
  const id = Math.random().toString(36).slice(2, 10) || "show";
  const sync = openSync(id, "presenter");
  const url = audienceUrl(id);
  if (isTauri()) return { id, sync, window: openTauriAudience(url).catch(() => null) };
  let w: Window | null = null;
  try {
    const width = Math.max(640, Math.round(window.screen.availWidth / 2));
    w = window.open(url, `rusuite-show-audience-${id}`, `popup,width=${width},height=${Math.round((width * 9) / 16)}`);
  } catch {
    w = null;
  }
  const handle: AudienceWindow | null = w && {
    isOpen: () => !w!.closed,
    close: () => w!.close(),
  };
  return { id, sync, window: Promise.resolve(handle) };
}
