import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutosaveStatus } from "./AutosaveStatus";
import type { CloseHooks } from "./closeGuard";
import { ConfirmDiscard } from "./ConfirmDiscard";
import { RecoveryBanner } from "./RecoveryBanner";
import { DocumentSession, RECOVERY_MAX_AGE_MS } from "./session";
import { MemoryDocStorage } from "./storage";
import { FakeCore, fakeBackend } from "./testing";
import { ensureSaved, UnsavedGuard, type DocState, type SaveChoice, type SavePrompts } from "./unsaved";

afterEach(cleanup);

/** A document whose save flow succeeds (`ok`) and then is clean. */
function doc(opts: { dirty?: boolean; name?: string | null; ok?: boolean | "throw" } = {}) {
  const state = { dirty: opts.dirty ?? true, name: opts.name === undefined ? "a.xlsx" : opts.name };
  const save = vi.fn(async (asName?: string) => {
    if (opts.ok === "throw") throw new Error("disk full");
    if (opts.ok === false) return false;
    state.dirty = false;
    if (asName) state.name = asName;
    return true;
  });
  const d: DocState = { dirty: () => state.dirty, name: () => state.name, defaultName: "Workbook.xlsx", save };
  return { d, save, state };
}

function prompts(choice: SaveChoice, name: string | null = "named.xlsx") {
  return {
    askSave: vi.fn(async () => choice),
    askName: vi.fn(async () => name),
  } satisfies SavePrompts;
}

describe("ensureSaved", () => {
  it("proceeds at once when the document is clean", async () => {
    const { d, save } = doc({ dirty: false });
    const p = prompts("cancel");
    expect(await ensureSaved(p, d)).toBe("proceed");
    expect(p.askSave).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("Cancel keeps the document; Don't save proceeds without saving", async () => {
    const { d, save } = doc();
    const cancel = prompts("cancel");
    expect(await ensureSaved(cancel, d)).toBe("cancel");
    expect(cancel.askSave).toHaveBeenCalledWith("a.xlsx");
    expect(await ensureSaved(prompts("discard"), d)).toBe("proceed");
    expect(save).not.toHaveBeenCalled();
  });

  it("Save on a named document saves under its name and proceeds", async () => {
    const { d, save } = doc();
    const p = prompts("save");
    expect(await ensureSaved(p, d)).toBe("proceed");
    expect(save).toHaveBeenCalledWith(undefined);
    expect(p.askName).not.toHaveBeenCalled();
  });

  it("Save on an untitled document runs Save As first", async () => {
    const { d, save, state } = doc({ name: null });
    const p = prompts("save", "q3.xlsx");
    expect(await ensureSaved(p, d)).toBe("proceed");
    expect(p.askSave).toHaveBeenCalledWith("Untitled");
    expect(p.askName).toHaveBeenCalledWith("Workbook.xlsx");
    expect(save).toHaveBeenCalledWith("q3.xlsx");
    expect(state.name).toBe("q3.xlsx");
  });

  it("a cancelled Save As cancels without saving", async () => {
    const { d, save } = doc({ name: null });
    expect(await ensureSaved(prompts("save", null), d)).toBe("cancel");
    expect(save).not.toHaveBeenCalled();
  });

  it("a save that is cancelled or fails cancels", async () => {
    expect(await ensureSaved(prompts("save"), doc({ ok: false }).d)).toBe("cancel");
    expect(await ensureSaved(prompts("save"), doc({ ok: "throw" }).d)).toBe("cancel");
  });

  it("without a name prompt (desktop) an untitled document goes to the shell's save dialog", async () => {
    const { d, save } = doc({ name: null });
    expect(await ensureSaved({ askSave: async () => "save" }, d)).toBe("proceed");
    expect(save).toHaveBeenCalledWith(undefined);
  });
});

describe("ConfirmDiscard + UnsavedGuard", () => {
  it("asks 'Save changes to <name>?' with Save / Don't save / Cancel; Esc cancels", async () => {
    const { d } = doc();
    const guard = new UnsavedGuard({ kind: "wasm" }, d);
    render(<ConfirmDiscard guard={guard} />);
    let result = guard.ensureSaved();
    const dlg = await screen.findByRole("dialog", { name: "Save changes to a.xlsx?" });
    expect([...dlg.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Save", "Don't save", "Cancel"]);
    expect(document.activeElement?.textContent).toBe("Save");
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(await result).toBe("cancel");
    expect(screen.queryByRole("dialog")).toBeNull();
    result = guard.ensureSaved();
    await userEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    expect(await result).toBe("proceed");
  });

  it("web: Save on an untitled document asks for the file name; cancelling it keeps the document", async () => {
    const { d, save } = doc({ name: null });
    const guard = new UnsavedGuard({ kind: "wasm" }, d);
    render(<ConfirmDiscard guard={guard} />);
    let result = guard.ensureSaved();
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    const input = (await screen.findByLabelText("File name")) as HTMLInputElement;
    expect(input.value).toBe("Workbook.xlsx");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await result).toBe("cancel");
    expect(save).not.toHaveBeenCalled();

    result = guard.ensureSaved();
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    const again = (await screen.findByLabelText("File name")) as HTMLInputElement;
    fireEvent.change(again, { target: { value: "budget.xlsx" } });
    fireEvent.submit(again.form!);
    expect(await result).toBe("proceed");
    expect(save).toHaveBeenCalledWith("budget.xlsx");
  });

  it("desktop: no name prompt; a second request while asking cancels; run() only acts on proceed", async () => {
    const { d, save } = doc({ name: null });
    const guard = new UnsavedGuard({ kind: "tauri" }, d);
    render(<ConfirmDiscard guard={guard} />);
    const action = vi.fn();
    const first = guard.run(action);
    expect(await guard.ensureSaved()).toBe("cancel");
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await first).toBe(false);
    expect(action).not.toHaveBeenCalled();
    const second = guard.run(action);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await second).toBe(true);
    expect(save).toHaveBeenCalledWith(undefined);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("window close", () => {
  it("web: beforeunload is prevented only while dirty", () => {
    const { state, d } = doc();
    const target = new EventTarget();
    const guard = new UnsavedGuard({ kind: "wasm" }, d);
    const stop = guard.watchWindow({ target: target as unknown as Window });
    const fire = () => {
      const e = new Event("beforeunload", { cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(true);
    state.dirty = false;
    expect(fire()).toBe(false);
    state.dirty = true;
    stop();
    expect(fire()).toBe(false);
  });

  it("desktop: the shell guard follows the dirty flag; a held close asks and closes after the choice", async () => {
    const { state, d } = doc();
    let request: (() => void) | null = null;
    const hooks = {
      setGuard: vi.fn(async (_on: boolean) => {}),
      listen: vi.fn(async (fn: () => void) => {
        request = fn;
        return () => (request = null);
      }),
      close: vi.fn(async () => {}),
    } satisfies CloseHooks;
    const guard = new UnsavedGuard({ kind: "tauri" }, d);
    render(<ConfirmDiscard guard={guard} />);
    const stop = guard.watchWindow({ hooks });
    expect(hooks.setGuard).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(request).not.toBeNull());
    // Cancel: the window stays.
    let closing = guard.closeRequested();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await closing).toBe(false);
    expect(hooks.close).not.toHaveBeenCalled();
    // Don't save: guard lifted, then closed.
    act(() => request!());
    await userEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(hooks.close).toHaveBeenCalledTimes(1));
    expect(hooks.setGuard).toHaveBeenLastCalledWith(false);
    // syncDirty only reports changes.
    state.dirty = false;
    hooks.setGuard.mockClear();
    guard.syncDirty();
    expect(hooks.setGuard).not.toHaveBeenCalled();
    state.dirty = true;
    guard.syncDirty();
    expect(hooks.setGuard).toHaveBeenCalledWith(true);
    // A clean document closes without a question.
    state.dirty = false;
    closing = guard.closeRequested();
    expect(await closing).toBe(true);
    stop();
    expect(request).toBeNull();
  });
});

async function sessionWith(storage: MemoryDocStorage, confirm: () => Promise<boolean>, now = Date.now) {
  const core = new FakeCore();
  const session = new DocumentSession(fakeBackend(core, storage), { docId: "me", target: null, locks: null, now });
  const restore = vi.fn(async (json: string, name: string | null) => "ok" in (await session.backend.dispatch({ type: "restoreRecovery", json, name })));
  const openFile = vi.fn(async () => true);
  session.attach({ restore, openFile, confirmReplace: confirm });
  await act(() => session.start());
  return { session, core, restore };
}

describe("session entry points", () => {
  it("a recent file and Restore ask first; a cancelled question keeps the document", async () => {
    const storage = new MemoryDocStorage();
    await storage.rememberRecent("old.xlsx", '{"text":"old"}');
    await storage.putRecovery({ id: "r", name: "lost.xlsx", savedAt: Date.now(), revision: 1, json: '{"text":"lost"}' });
    const confirm = vi.fn(async () => false);
    const { session, restore } = await sessionWith(storage, confirm);
    expect(await session.openRecent(session.getState().recent[0]!)).toBe(false);
    expect(await session.restore("r")).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(storage.recovery.has("r")).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockResolvedValue(true);
    expect(await session.restore("r")).toBe(true);
    expect(restore).toHaveBeenCalledWith('{"text":"lost"}', "lost.xlsx");
    expect(await session.openRecent(session.getState().recent[0]!)).toBe(true);
  });

  it("drops recovery entries older than 7 days", async () => {
    const storage = new MemoryDocStorage();
    const now = 100 * RECOVERY_MAX_AGE_MS;
    await storage.putRecovery({ id: "old", name: "old", savedAt: now - RECOVERY_MAX_AGE_MS - 1, revision: 1, json: "{}" });
    await storage.putRecovery({ id: "new", name: "new", savedAt: now - 1000, revision: 1, json: "{}" });
    const { session } = await sessionWith(storage, async () => true, () => now);
    expect(session.getState().recoveries.map((r) => r.id)).toEqual(["new"]);
    expect([...storage.recovery.keys()]).toEqual(["new"]);
  });

  it("the banner offers Discard all when several entries exist", async () => {
    const storage = new MemoryDocStorage();
    await storage.putRecovery({ id: "a", name: "a", savedAt: Date.now(), revision: 1, json: "{}" });
    const { session } = await sessionWith(storage, async () => true);
    render(<RecoveryBanner session={session} />);
    expect(screen.queryByRole("button", { name: "Discard all" })).toBeNull();
    await storage.putRecovery({ id: "b", name: "b", savedAt: Date.now(), revision: 1, json: "{}" });
    await act(() => session.refresh());
    await userEvent.click(screen.getByRole("button", { name: "Discard all" }));
    await waitFor(() => expect(screen.queryByTestId("recovery-banner")).toBeNull());
    expect(storage.recovery.size).toBe(0);
  });

  it("the status shows 'Autosaved HH:MM' after an autosave and clears on save", async () => {
    const storage = new MemoryDocStorage();
    const at = new Date(2026, 9, 15, 14, 5).getTime();
    const { session } = await sessionWith(storage, async () => true, () => at);
    render(<AutosaveStatus session={session} />);
    expect(screen.queryByTestId("autosave-status")).toBeNull();
    await act(async () => {
      await session.backend.dispatch({ type: "apply", text: "x" });
      await session.autosave();
    });
    expect(screen.getByTestId("autosave-status").textContent).toMatch(/^Autosaved .*\b05\b/);
    expect(screen.getByTestId("autosave-status").textContent).toBe(`Autosaved ${new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`);
    await act(async () => {
      await session.backend.dispatch({ type: "markSaved" });
    });
    expect(screen.queryByTestId("autosave-status")).toBeNull();
  });
});
