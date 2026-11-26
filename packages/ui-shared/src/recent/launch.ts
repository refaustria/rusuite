// Documents from the OS in the desktop shells (P11-D1): a Finder / Explorer double-click or "Open with", a file
// dropped onto the window or the Dock icon, a second start with a document. The shell queues the paths the OS
// delivered (`apps/*\/src-tauri/src/launch.rs`) and emits `OPEN_DOCUMENT_EVENT`; the session asks the
// unsaved-changes question and takes them (`DocumentSession.openLaunchDocument`). The page never names a path.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { OpenedFile } from "../backend";
import { thisWindow } from "./windows";

/** Emitted by the desktop shells when OS documents wait (`launch::OPEN_DOCUMENT_EVENT`). */
export const OPEN_DOCUMENT_EVENT = "rusuite://open-document";

/** What the shell hands out (`take_launch_documents`). */
export interface TakenDocuments {
  /** The document to open (the first openable one). */
  file: OpenedFile | null;
  /** Names of further documents (one per window); the shell put them on the recent list. */
  notOpened: string[];
  /** Names of files of types this app does not open. */
  unsupported: string[];
}

export interface LaunchDocuments {
  /** Whether a document this app opens waits (then the unsaved-changes question comes first). */
  pending(): Promise<boolean>;
  /** Takes everything waiting: `open` = the user agreed to replace the open document (else documents are dropped). */
  take(open: boolean): Promise<TakenDocuments>;
  /** Calls `fn` whenever new documents arrive while the app runs; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

interface ShellDocuments {
  file: { path: string; name: string; bytesBase64: string } | null;
  notOpened: string[];
  unsupported: string[];
}

/** The desktop shells' `launch_pending` / `take_launch_documents` and their event. */
export function tauriLaunchDocuments(): LaunchDocuments {
  return {
    pending: () => invoke<boolean>("launch_pending"),
    async take(open) {
      const r = await invoke<ShellDocuments>("take_launch_documents", { open });
      return {
        file: r.file ? { name: r.file.name, bytesBase64: r.file.bytesBase64 } : null,
        notOpened: r.notOpened,
        unsupported: r.unsupported,
      };
    },
    subscribe(fn) {
      let stopped = false;
      let unlisten: (() => void) | null = null;
      // The shell sends the event to the window the documents wait for (P11-D2).
      void listen(OPEN_DOCUMENT_EVENT, () => fn(), thisWindow())
        .then((u) => {
          if (stopped) u();
          else unlisten = u;
        })
        .catch(() => undefined);
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
  };
}
