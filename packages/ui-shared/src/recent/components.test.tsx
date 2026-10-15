import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileMenu } from "./FileMenu";
import { RecoveryBanner } from "./RecoveryBanner";
import { DocumentSession } from "./session";
import { MemoryDocStorage } from "./storage";
import { FakeCore, fakeBackend } from "./testing";

afterEach(cleanup);

async function sessionWith(storage: MemoryDocStorage) {
  const core = new FakeCore();
  const session = new DocumentSession(fakeBackend(core, storage), { docId: "me", target: null, locks: null });
  const restore = vi.fn(async (json: string, name: string | null) => "ok" in (await session.backend.dispatch({ type: "restoreRecovery", json, name })));
  session.attach({ restore, openFile: vi.fn(async () => true) });
  await act(() => session.start());
  return { session, core, restore };
}

describe("RecoveryBanner", () => {
  it("lists recovered documents; Restore loads one, Discard drops one", async () => {
    const storage = new MemoryDocStorage();
    await storage.putRecovery({ id: "a", name: "budget.xlsx", savedAt: Date.now(), revision: 4, json: '{"text":"A"}' });
    await storage.putRecovery({ id: "b", name: null, savedAt: Date.now() - 1, revision: 2, json: '{"text":"B"}' });
    const { session, core, restore } = await sessionWith(storage);
    render(<RecoveryBanner session={session} />);
    const banner = screen.getByRole("region", { name: "Recovered documents" });
    expect(banner.textContent).toContain("2 recovered documents");
    expect(screen.getAllByTestId("recovery-entry")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Discard Untitled" }));
    expect(storage.recovery.has("b")).toBe(false);
    expect(banner.textContent).toContain("Recovered document:");
    await userEvent.click(screen.getByRole("button", { name: "Restore budget.xlsx" }));
    await waitFor(() => expect(screen.queryByTestId("recovery-banner")).toBeNull());
    expect(restore).toHaveBeenCalledWith('{"text":"A"}', "budget.xlsx");
    expect(core).toMatchObject({ text: "A", dirty: true, name: "budget.xlsx" });
    await session.idle();
    expect([...storage.recovery.keys()]).toEqual(["me"]);
  });

  it("renders nothing without entries", async () => {
    const { session } = await sessionWith(new MemoryDocStorage());
    const { container } = render(<RecoveryBanner session={session} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FileMenu", () => {
  it("offers Open, Save and the recent files with the browser note", async () => {
    const storage = new MemoryDocStorage();
    await storage.rememberRecent("old.xlsx", '{"text":"old"}');
    const { session, restore } = await sessionWith(storage);
    const onOpen = vi.fn();
    const onSave = vi.fn();
    render(<FileMenu session={session} onOpen={onOpen} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByTestId("recent-web-note").textContent).toMatch(/stored in this browser/);
    await userEvent.click(screen.getByRole("menuitem", { name: /Open/ }));
    expect(onOpen).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Save/ }));
    expect(onSave).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    const entries = await screen.findAllByTestId("recent-entry");
    expect(entries.map((e) => e.textContent)).toEqual([expect.stringContaining("old.xlsx")]);
    await userEvent.click(entries[0]!);
    await waitFor(() => expect(restore).toHaveBeenCalledWith('{"text":"old"}', "old.xlsx"));
  });

  it("says when there are no recent files", async () => {
    const { session } = await sessionWith(new MemoryDocStorage());
    render(<FileMenu session={session} onOpen={() => {}} onSave={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    expect(await screen.findByTestId("recent-empty")).toBeTruthy();
  });
});
