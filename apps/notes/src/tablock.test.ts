import { describe, expect, it } from "vitest";
import { TabLock, type LockChannel, type LockMessage } from "./tablock";

/** BroadcastChannel semantics: a message reaches every other channel of the hub, asynchronously. */
function hub() {
  const chans: LockChannel[] = [];
  return () => {
    const c: LockChannel = {
      onmessage: null,
      postMessage(m: LockMessage) {
        for (const o of chans) if (o !== c) setTimeout(() => o.onmessage?.({ data: structuredClone(m) }), 1);
      },
    };
    chans.push(c);
    return c;
  };
}

describe("single-tab lock", () => {
  it("the first tab is active, a second one is blocked until it takes over; the first then goes read-only", async () => {
    const channel = hub();
    const a = new TabLock(channel(), "a", 30, 500);
    expect(await a.acquire()).toBe(true);
    expect(a.state).toBe("active");
    let flushed = false;
    a.onLost = async () => {
      await new Promise((r) => setTimeout(r, 20));
      flushed = true;
    };
    const b = new TabLock(channel(), "b", 30, 500);
    expect(await b.acquire()).toBe(false);
    expect(b.state).toBe("blocked");
    await b.takeOver();
    expect(flushed).toBe(true);
    expect(a.state).toBe("lost");
    expect(b.state).toBe("active");
    // A third tab sees b as the active one; a no longer answers.
    const c = new TabLock(channel(), "c", 30, 500);
    expect(await c.acquire()).toBe(false);
  });

  it("without BroadcastChannel a tab is always active", async () => {
    const l = new TabLock(null);
    expect(await l.acquire()).toBe(true);
  });
});
