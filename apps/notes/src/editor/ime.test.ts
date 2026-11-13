import { describe, expect, it, vi } from "vitest";
import { ImeGuard } from "./ime";

describe("ImeGuard", () => {
  it("runs imports at once when not composing", () => {
    const g = new ImeGuard();
    const fn = vi.fn();
    g.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("holds imports during a composition and applies them in order after compositionend", async () => {
    const dom = document.createElement("div");
    let composing = true;
    const g = new ImeGuard();
    const detach = g.attach(dom, () => composing);
    const order: number[] = [];
    g.run(() => order.push(1));
    g.run(() => order.push(2));
    expect(order).toEqual([]);
    expect(g.pending).toBe(2);
    composing = false;
    // A new import while the queue still waits keeps the order.
    g.run(() => order.push(3));
    dom.dispatchEvent(new Event("compositionend"));
    await vi.waitFor(() => expect(order).toEqual([1, 2, 3]));
    expect(g.pending).toBe(0);
    detach();
  });

  it("keeps holding when the next composition starts before the drain", async () => {
    const dom = document.createElement("div");
    let composing = true;
    const g = new ImeGuard();
    g.attach(dom, () => composing);
    const fn = vi.fn();
    g.run(fn);
    dom.dispatchEvent(new Event("compositionend")); // still composing (a new composition began)
    await new Promise((r) => setTimeout(r, 5));
    expect(fn).not.toHaveBeenCalled();
    composing = false;
    g.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flushes on detach", () => {
    const dom = document.createElement("div");
    const g = new ImeGuard();
    const detach = g.attach(dom, () => true);
    const fn = vi.fn();
    g.run(fn);
    detach();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
