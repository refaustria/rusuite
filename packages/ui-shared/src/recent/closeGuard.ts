// The desktop half of the window-close guard (P7-6): while the document is
// dirty the Tauri shell holds a close request (`set_close_guard`) and
// emits `CLOSE_REQUESTED_EVENT`; the UI asks Save / Don't save / Cancel,
// lifts the guard and closes the window again.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Emitted by the shells when they held a close request (`apps/*\/src-tauri`). */
export const CLOSE_REQUESTED_EVENT = "rusuite://close-requested";

export interface CloseHooks {
  /** Whether the shell holds close requests (the document is dirty). */
  setGuard(on: boolean): Promise<void>;
  /** Called when the shell held a close request; resolves the unlisten function. */
  listen(onRequest: () => void): Promise<() => void>;
  /** Closes the window (with the guard lifted, the shell lets it close). */
  close(): Promise<void>;
}

/** The Tauri shell's close hooks (`set_close_guard`, the event, `core:window:allow-close`). */
export function tauriCloseHooks(): CloseHooks {
  return {
    setGuard: (on) => invoke<void>("set_close_guard", { on }),
    listen: (onRequest) => listen(CLOSE_REQUESTED_EVENT, () => onRequest()),
    close: () => getCurrentWindow().close(),
  };
}
