// Single-tab safety: two tabs writing the same IndexedDB notebooks would each keep their own core state and
// overwrite each other's log records. On start a tab asks over a `BroadcastChannel` whether another tab is active;
// if one answers, this tab waits ("Notes is open in another tab" › "Use here"). "Use here" asks the active tab to
// let go: it writes what is pending, becomes read-only and confirms; then this tab starts.

export type LockMessage = { type: "hello" | "here" | "takeover" | "released"; id: string; to?: string };

export type LockState = "probing" | "active" | "blocked" | "lost";

/** The part of `BroadcastChannel` the lock uses. */
export interface LockChannel {
  postMessage(m: LockMessage): void;
  onmessage: ((e: { data: LockMessage }) => void) | null;
  close?(): void;
}

export const LOCK_CHANNEL = "rusuite-notes-tabs";

export class TabLock {
  state: LockState = "probing";
  private listeners = new Set<() => void>();
  private waiters = new Map<string, () => void>();
  /** Another tab took over: write what is pending (the promise resolves before "released" is sent). */
  onLost: () => Promise<void> = async () => undefined;

  constructor(
    private readonly channel: LockChannel | null,
    readonly id: string = Math.random().toString(36).slice(2, 10),
    private readonly probeMs = 250,
    private readonly releaseMs = 3000,
  ) {
    if (channel) channel.onmessage = (e) => void this.receive(e.data);
  }

  /** A lock over the browser's `BroadcastChannel` (none in old browsers: always active). */
  static browser(): TabLock {
    const C = (globalThis as { BroadcastChannel?: new (name: string) => LockChannel }).BroadcastChannel;
    return new TabLock(C ? new C(LOCK_CHANNEL) : null);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): LockState => this.state;

  private setState(s: LockState): void {
    this.state = s;
    for (const l of this.listeners) l();
  }

  private async receive(m: LockMessage): Promise<void> {
    if (!m || m.id === this.id || (m.to && m.to !== this.id)) return;
    if (m.type === "hello" && this.state === "active") this.channel?.postMessage({ type: "here", id: this.id, to: m.id });
    else if (m.type === "here" || m.type === "released") this.waiters.get(m.type)?.();
    else if (m.type === "takeover" && this.state === "active") {
      this.setState("lost");
      try {
        await this.onLost();
      } finally {
        this.channel?.postMessage({ type: "released", id: this.id, to: m.id });
      }
    }
  }

  private wait(type: "here" | "released", ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(type);
        resolve(false);
      }, ms);
      this.waiters.set(type, () => {
        clearTimeout(timer);
        this.waiters.delete(type);
        resolve(true);
      });
    });
  }

  /** Asks whether another tab is active; this tab becomes active when none answers, else `blocked`. */
  async acquire(): Promise<boolean> {
    if (!this.channel) {
      this.setState("active");
      return true;
    }
    const answered = this.wait("here", this.probeMs);
    this.channel.postMessage({ type: "hello", id: this.id });
    if (await answered) {
      this.setState("blocked");
      return false;
    }
    this.setState("active");
    return true;
  }

  /** "Use here": the active tab writes what it has and goes read-only; then this one is active. */
  async takeOver(): Promise<void> {
    const released = this.wait("released", this.releaseMs);
    this.channel?.postMessage({ type: "takeover", id: this.id });
    await released;
    this.setState("active");
  }

  close(): void {
    this.channel?.close?.();
  }
}
