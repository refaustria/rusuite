// What the UI asks of the desktop shell (P11-N7): `null` on the web, so the desktop-only menu entries (notebook
// folders, Join with link…, Options › Sharing, the AI assistant) stay hidden there.

import type { Assistant } from "@rusuite/ui-shared";
import type { RelayInfo, TauriDesktop } from "./backend";

export interface DesktopShell {
  api: TauriDesktop;
  /** The relay the window was created with. */
  relay: RelayInfo;
  /** The AI assistant (desktop only; off until the user enables it in Settings › AI). */
  ai: Assistant | null;
}

let current: DesktopShell | null = null;

export function setDesktopShell(shell: DesktopShell | null): void {
  current = shell;
}

/** The desktop shell (`null`: the web app). */
export function desktopShell(): DesktopShell | null {
  return current;
}
