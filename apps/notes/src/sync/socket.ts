// The one network connection of Rusuite Notes (ADR 0010, scripts/privacy-check.sh allow-list): a WebSocket to the
// same-origin relay `/api/notes/ws`, opened only for notebooks the user shared or joined.

import type { SocketFactory, SocketLike } from "./engine";
import { relayUrl } from "./manager";

export const relaySocket: SocketFactory = () => new WebSocket(relayUrl()) as unknown as SocketLike;
