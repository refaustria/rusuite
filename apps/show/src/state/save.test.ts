// The save flow against a desktop-like backend (P7-7): the shell reports the
// file it wrote, which names the presentation; Save As always asks.
import { describe, expect, it, vi } from "vitest";
import type { Backend } from "@rusuite/ui-shared";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { ShowStore } from "./store";

describe("ShowStore.save with a desktop shell", () => {
  it("names the presentation after the written file; Save As asks; a cancelled dialog changes nothing", async () => {
    const backend = new FakeBackend();
    const save = vi.spyOn(backend as Backend, "saveFile").mockResolvedValue({ name: "deck.pptx", path: "/docs/deck.pptx" });
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    await store.save();
    expect(save).toHaveBeenLastCalledWith("Presentation.pptx", expect.any(String), { saveAs: false });
    expect(backend.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "deck.pptx" });
    expect(store.getState()).toMatchObject({ name: "deck.pptx", dirty: false });

    save.mockResolvedValue({ name: "copy.pptx", path: "/docs/copy.pptx" });
    await store.save("other.pptx");
    expect(save).toHaveBeenLastCalledWith("other.pptx", expect.any(String), { saveAs: true });
    expect(store.getState().name).toBe("copy.pptx");

    save.mockResolvedValue(false);
    await store.save();
    // (The real core suggests the presentation's name; the fake always "Presentation.pptx".)
    expect(save).toHaveBeenLastCalledWith("Presentation.pptx", expect.any(String), { saveAs: false });
    expect(store.getState().name).toBe("copy.pptx");
  });
});
