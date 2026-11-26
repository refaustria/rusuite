// Import, export and rich paste through the controller with the real core and the real converter module
// (src-wasm/pkg + src-wasm-convert/pkg; skipped when they are not built, covered by the e2e suite then).

import { beforeAll, describe, expect, it, vi } from "vitest";
import { WebNotesBackend, type NotesWasmModule } from "../backend";
import { NotesController } from "../controller";
import { MemoryNotesStore } from "../store";
import { allPages, allSections } from "../tree";
import { convertAvailable, loadConvert, loadCore } from "../test/core";
import type { ConvertWasmModule } from "./loader";

let core: NotesWasmModule;
let convert: ConvertWasmModule;
let clock = 1_700_000_000_000;
const now = () => (clock += 1000);
const enc = (s: string) => new TextEncoder().encode(s);

describe.runIf(convertAvailable)("import / export / paste (real modules)", () => {
  beforeAll(async () => {
    core = await loadCore();
    convert = await loadConvert();
  });

  it("imports the files the desktop shell got from the OS after start and when more arrive (P11-D1)", async () => {
    const backend = new WebNotesBackend(core, async () => convert);
    const waiting: { name: string; bytes: Uint8Array }[][] = [[{ name: "Plan.md", bytes: enc("# From Finder\n") }]];
    let more: (() => void) | null = null;
    Object.assign(backend, {
      launchFiles: {
        take: async () => ({ files: waiting.shift() ?? [], unsupported: waiting.length ? [] : ["photo.bmp"], failed: [] }),
        subscribe: (fn: () => void) => ((more = fn), () => (more = null)),
      },
    });
    const ctl = new NotesController(backend, new MemoryNotesStore(), now);
    await ctl.start();
    await vi.waitFor(() => expect(allPages(ctl.tree()).map((p) => p.title)).toContain("From Finder"));
    expect(ctl.getState().error).toContain("photo.bmp");
    waiting.push([{ name: "Second.md", bytes: enc("# Dropped\n") }]);
    more!();
    await vi.waitFor(() => expect(allPages(ctl.tree()).map((p) => p.title)).toContain("Dropped"));
  });

  it("imports Markdown and HTML as pages, exports and re-imports the same text; the module loads once", async () => {
    const load = vi.fn(async () => convert);
    const backend = new WebNotesBackend(core, load);
    const saved: { name: string; bytes: Uint8Array }[] = [];
    backend.saveFile = async (name, bytes) => {
      saved.push({ name, bytes });
      return true;
    };
    const ctl = new NotesController(backend, new MemoryNotesStore(), now);
    await ctl.start();
    expect(load).not.toHaveBeenCalled();
    await ctl.importFiles([
      { name: "Plan.md", bytes: enc("# Weekly plan\n\n- ship **it**\n- [ ] review\n") },
      { name: "web.html", bytes: enc("<html><head><title>From the web</title></head><body><h2>Hi</h2><p>Hello <b>world</b></p><script>x()</script></body></html>") },
      { name: "sheet.xlsx", bytes: enc("PK") },
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    const r = ctl.getState().importResult!;
    expect(r.pages).toBe(2);
    expect(r.files.map((f) => [f.name, !!f.error])).toEqual([["Plan.md", false], ["web.html", false], ["sheet.xlsx", true]]);
    expect(r.files[1]!.warnings.some((w) => w.code === "notes.html.removed")).toBe(true);
    expect(allPages(ctl.tree()).map((p) => p.title)).toContain("Weekly plan");
    expect(allPages(ctl.tree()).map((p) => p.title)).toContain("From the web");
    await ctl.openImported();
    expect(ctl.getState().opened?.title).toBe("Weekly plan");

    await ctl.exportTo("md", { page: ctl.getState().page! });
    expect(saved[0]!.name).toBe("Weekly plan.md");
    const md = new TextDecoder().decode(saved[0]!.bytes);
    expect(md).toContain("# Weekly plan");
    expect(md).toContain("**it**");
    await ctl.exportTo("html", { section: ctl.getState().section! });
    expect(saved[1]!.name).toMatch(/\.html$/);
    expect(new TextDecoder().decode(saved[1]!.bytes)).toContain("<strong>world</strong>");
    await ctl.exportTo("docx", { page: ctl.getState().page! });
    expect(saved[2]!.bytes[0]).toBe(0x50);

    // Re-import the exports: the same text.
    await ctl.importFiles([
      { name: "again.md", bytes: saved[0]!.bytes },
      { name: "again.docx", bytes: saved[2]!.bytes },
    ]);
    const titles = allPages(ctl.tree()).map((p) => p.title);
    expect(titles.filter((t) => t === "Weekly plan").length).toBe(3);
    expect(load).toHaveBeenCalledTimes(1);

    // Rich paste: sanitised, remote images are not fetched (links), data: images become blobs.
    const pasted = await ctl.pasteHtml('<h1>T</h1><img src="https://example.com/x.png" alt="remote"><img src="data:image/png;base64,iVBORw0KGgo=">');
    const json = JSON.stringify(pasted!.content);
    expect(json).toContain('"heading"');
    expect(json).toContain("https://example.com/x.png");
    expect(pasted!.warnings.some((w) => w.code === "notes.image.remote")).toBe(true);
    await ctl.clearLocalData();
  });

  it("a failed converter load is a message, and the next try loads again", async () => {
    let fail = true;
    const backend = new WebNotesBackend(core, async () => {
      if (fail) throw new TypeError("Failed to fetch dynamically imported module");
      return convert;
    });
    const ctl = new NotesController(backend, new MemoryNotesStore(), now);
    await ctl.start();
    await ctl.importFiles([{ name: "a.md", bytes: enc("# A\n") }]);
    const r = ctl.getState().importResult!;
    expect(r.files[0]!.error).toMatch(/converters could not be loaded/);
    expect(ctl.getState().busy).toBeNull();
    fail = false;
    await ctl.importFiles([{ name: "a.md", bytes: enc("# A\n") }]);
    expect(ctl.getState().importResult!.files[0]!.error).toBeUndefined();
    expect(allSections(ctl.tree()).length).toBeGreaterThan(0);
    await ctl.clearLocalData();
  });
});
