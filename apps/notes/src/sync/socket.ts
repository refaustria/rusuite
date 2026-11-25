// The one network connection of Rusuite Notes (ADR 0010, scripts/privacy-check.sh allow-list): a WebSocket to the
// relay `/api/notes/ws`, opened only for notebooks the user shared or joined. Web: the same-origin relay; desktop
// (P11-N7): the relay of File › Options › Sharing (default `wss://rusuit.es/api/notes/ws`, the window's CSP allows
// exactly that origin).

import type { SocketFactory, SocketLike } from "./engine";
import { relayUrl } from "./manager";

export const relaySocket: SocketFactory = () => new WebSocket(relayUrl()) as unknown as SocketLike;

/** Desktop: the configured relay's WebSocket address (`relay_get().wsUrl`). */
export const relaySocketTo =
  (wsUrl: string): SocketFactory =>
  () =>
    new WebSocket(wsUrl) as unknown as SocketLike;
