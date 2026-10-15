import { useSyncExternalStore } from "react";
import type { AnySession, SessionState } from "./session";

/** Subscribes a component to a slice of the session state. */
export function useSession<T>(session: AnySession, select: (s: SessionState) => T): T {
  const s = session;
  return useSyncExternalStore(s.subscribe, () => select(s.getState()));
}

/** "14:05" today, else a short date and time. */
export function formatTime(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}
