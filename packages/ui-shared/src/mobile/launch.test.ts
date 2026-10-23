// "Open with" on mobile (P10-M1): the session opens the shell's launch document through the app's Open.

import { describe, expect, it, vi } from "vitest";
import { DocumentSession } from "../recent/session";
import { MemoryDocStorage } from "../recent/storage";
import { FakeCore, fakeBackend } from "../recent/testing";
import type { OpenedFile } from "../backend";

function setup(launch: OpenedFile[], confirm = true) {
  const backend = Object.assign(fakeBackend(new FakeCore(), new MemoryDocStorage(() => 1)), {
    takeLaunchDocument: vi.fn(async () => launch.shift() ?? null),
  });
  const target = new EventTarget();
  const session = new DocumentSession(backend, { docId: "doc-m", target: target as unknown as Window, locks: null });
  const openFile = vi.fn(async () => true);
  const confirmReplace = vi.fn(async () => confirm);
  session.attach({ restore: async () => true, openFile, confirmReplace });
  return { backend, session, openFile, confirmReplace, target };
}

describe("launch documents", () => {
  it("opens the document the app was started with, once", async () => {
    const file = { name: "attachment.xlsx", bytesBase64: "UEs=" };
    const { session, openFile, backend } = setup([file]);
    await session.start();
    expect(openFile).toHaveBeenCalledWith(file);
    expect(await session.openLaunchDocument()).toBe(false);
    expect(backend.takeLaunchDocument).toHaveBeenCalledTimes(2);
    session.stop();
  });

  it("asks before replacing the open document and checks again when the page becomes visible", async () => {
    const launch: OpenedFile[] = [];
    const { session, openFile, confirmReplace, target } = setup(launch, false);
    await session.start();
    expect(confirmReplace).not.toHaveBeenCalled(); // nothing pending
    launch.push({ name: "b.xlsx", bytesBase64: "UEs=" }); // "Open with" while running
    vi.stubGlobal("document", { visibilityState: "visible" });
    target.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(confirmReplace).toHaveBeenCalled());
    expect(openFile).not.toHaveBeenCalled(); // the user kept the open document
    vi.unstubAllGlobals();
    session.stop();
  });

  it("does nothing for backends without launch documents (web, desktop fakes)", async () => {
    const backend = fakeBackend(new FakeCore(), new MemoryDocStorage(() => 1));
    const session = new DocumentSession(backend, { docId: "doc-w", target: null, locks: null });
    session.attach({ restore: async () => true, openFile: vi.fn() });
    expect(await session.openLaunchDocument()).toBe(false);
  });
});
