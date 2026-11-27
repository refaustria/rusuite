// P11-N3 / plan review focus 5: a large notebook – 500 pages (10 sections × 50), 200 of them with a small picture,
// 50 changes of history on every page – generated through the core in the browser, stored in IndexedDB, then the
// app is reloaded (the real start path). Measured in the page: opening a page (until its text is in the editor)
// < 300 ms, a search < 100 ms. Numbers are printed (`notes perf:`). With a relay (`NOTES_RELAY_DIR`, see
// notes-sharing.spec.ts) also the first share of the whole notebook (P11-X1).

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const relayDir = process.env.NOTES_RELAY_DIR;

test.describe("Notes performance (P11-N3)", () => {
  test("500 pages, 200 pictures, 50 changes per page: open page < 300 ms, search < 100 ms", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("notes/");
    await expect(page.getByTestId("page-editor")).toBeVisible();
    const gen = await page.evaluate(async () => {
      type Ctl = {
        backend: {
          dispatch(r: object): Promise<{ ok?: Record<string, unknown>; err?: { message: string } }>;
          converter: { importFile(r: object, b: Uint8Array): Promise<Uint8Array> };
          applyImport(r: object, frame: Uint8Array): Promise<{ ok?: Record<string, unknown>; err?: { message: string } }>;
          exportUpdates(doc: string, vv: Uint8Array): Promise<Uint8Array>;
          importUpdates(doc: string, b: Uint8Array): Promise<{ err?: { message: string } }>;
          takePersistEffects(): Promise<unknown[]>;
        };
        persister: { enqueue(e: unknown[]): void; flush(): Promise<void> };
        store: { getMeta(k: string): Promise<unknown>; setMeta(k: string, v: unknown): Promise<void> };
        getState(): { mirror: { doc: { constructor: new () => LDoc } } };
        idle(): Promise<void>;
      };
      type LText = { insert(i: number, s: string): void; length: number };
      type LList = { get(i: number): unknown; length: number };
      type LMap = { get(k: string): unknown };
      type LDoc = { setPeerId(p: string): void; setRecordTimestamp(b: boolean): void; setChangeMergeInterval(s: number): void; import(b: Uint8Array): void; getMap(k: string): LMap; commit(o?: object): void; export(o: object): Uint8Array };
      const ctl = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      const be = ctl.backend;
      const call = async (r: object) => {
        const res = await be.dispatch({ ...r, now: Date.now() });
        if (res.err) throw new Error(res.err.message);
        return res.ok!;
      };
      const t0 = performance.now();
      const DocCtor = ctl.getState().mirror.doc.constructor;
      const nb = ((await call({ type: "createNotebook", name: "Perf" })) as { notebook: { id: string } }).notebook.id;
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const g = canvas.getContext("2d")!;
      const words = ["alpha", "beta", "gamma", "delta", "notes", "meeting", "budget", "travel", "project", "garden"];
      const pages: { docId: string; node: string; marker: string }[] = [];
      let n = 0;
      for (let s = 0; s < 10; s++) {
        const section = ((await call({ type: "createSection", notebook: nb, title: `Section ${s + 1}` })) as { id: string }).id;
        for (let p = 0; p < 50; p++, n++) {
          const body = Array.from({ length: 120 }, (_, i) => words[(i * 7 + n) % words.length]).join(" ");
          let md = `# Page ${n}\n\nmarker${n} ${body}\n\n- [ ] task ${n}\n\nSecond paragraph ${body}\n`;
          if (n < 200) {
            g.fillStyle = `rgb(${n % 256}, ${(n * 3) % 256}, ${(n * 7) % 256})`;
            g.fillRect(0, 0, 16, 16);
            md += `\n![pic ${n}](${canvas.toDataURL("image/png")})\n`;
          }
          // Markdown through the converter module (P11-N6b) and the core's apply_import.
          const frame = await be.converter.importFile({ kind: "markdown", fileName: `p${n}.md` }, new TextEncoder().encode(md));
          const applied = await be.applyImport({ type: "importMarkdown", fileName: `p${n}.md`, notebook: nb, parent: section, now: Date.now() }, frame);
          if (applied.err) throw new Error(applied.err.message);
          const r = applied.ok as { pages: { node: string; docId: string }[] };
          const pg = r.pages[0]!;
          pages.push({ docId: pg.docId, node: pg.node, marker: `marker${n}` });
          // 50 changes of history (2 minutes apart: separate history groups).
          const d = new DocCtor();
          d.setPeerId(String(900000 + n));
          d.setRecordTimestamp(false);
          d.setChangeMergeInterval(-1);
          d.import(await be.exportUpdates(pg.docId, new Uint8Array()));
          const kids = d.getMap("doc").get("children") as LList;
          let text: LText | null = null;
          for (let i = 0; i < kids.length && !text; i++) {
            const m = kids.get(i) as LMap;
            const c = m.get("children") as LList | undefined;
            const t = c && c.length ? (c.get(0) as LText) : null;
            if (t && typeof t.insert === "function" && t.length > 0) text = t;
          }
          const start = Math.floor(Date.now() / 1000) - 50 * 120;
          for (let k = 0; k < 50; k++) {
            text!.insert(text!.length, ` e${k}`);
            d.commit({ timestamp: start + k * 120 });
          }
          const res = await be.importUpdates(pg.docId, d.export({ mode: "update" }));
          if (res.err) throw new Error(res.err.message);
          if (n % 50 === 49) {
            ctl.persister.enqueue(await be.takePersistEffects());
            await ctl.persister.flush();
          }
        }
      }
      ctl.persister.enqueue(await be.takePersistEffects());
      await ctl.persister.flush();
      const known = ((await ctl.store.getMeta("notebooks")) as object[]) ?? [];
      await ctl.store.setMeta("notebooks", [...known, { id: nb, name: "Perf", color: null, open: true, lastOpened: Date.now() }]);
      await ctl.store.setMeta("selection", { notebook: nb, section: null, page: null });
      return { ms: performance.now() - t0, pages };
    });
    expect(gen.pages.length).toBe(500);

    // The real start: everything from IndexedDB.
    const t0 = Date.now();
    await page.reload();
    await expect(page.getByTestId("page-editor")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("notebook-name")).toHaveText("Perf");
    const startMs = Date.now() - t0;

    // Each page carries its history: 50 edits of the generator's peer (the core stores them in its own change
    // blocks, so they show as one version here) on top of the import.
    const history = await page.evaluate(async (docId) => {
      const be = (window as unknown as { __rusuiteNotes: { backend: { dispatch(r: object): Promise<{ ok: { entries: { peer: string; ops: number }[] } }> } } }).__rusuiteNotes.backend;
      return (await be.dispatch({ type: "history", docId })).ok.entries.find((e) => e.peer === "900300")?.ops ?? 0;
    }, gen.pages[300]!.docId);
    expect(history).toBeGreaterThanOrEqual(150);

    const sample = [0, 7, 199, 250, 499, 120, 333, 42, 480, 199].map((i) => gen.pages[i]!);
    const opens: number[] = await page.evaluate(async (sample) => {
      type Ctl = { selectPage(id: string): Promise<void> };
      const ctl = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      const out: number[] = [];
      for (const p of sample) {
        const t = performance.now();
        await ctl.selectPage(p.node);
        await new Promise<void>((resolve) => {
          const check = () => {
            const ed = document.querySelector(".ProseMirror");
            if (ed?.textContent?.includes(p.marker)) resolve();
            else requestAnimationFrame(check);
          };
          check();
        });
        out.push(performance.now() - t);
      }
      return out;
    }, sample);
    // Pictures of the opened pages show.
    await page.evaluate((node) => (window as unknown as { __rusuiteNotes: { selectPage(id: string): Promise<void> } }).__rusuiteNotes.selectPage(node), gen.pages[5]!.node);
    await expect.poll(() => page.getByTestId("image").locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(16);

    const searches: number[] = await page.evaluate(async () => {
      type Ctl = { search(q: string, nb?: string | null): Promise<{ docId: string }[]> };
      const ctl = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      const out: number[] = [];
      for (const q of ["marker250", "budget", "garden travel", "task 77", "e49", "nothing-like-this", "second paragraph", "pic 12", "alpha", "marker7"]) {
        const t = performance.now();
        await ctl.search(q);
        out.push(performance.now() - t);
      }
      return out;
    });
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const fmt = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(", ");
    console.log(
      `notes perf: history ops of the 50 edits on a page ${history}; generate ${(gen.ms / 1000).toFixed(1)} s; reload until the first page ${startMs} ms; open page ms [${fmt(opens)}] median ${median(opens).toFixed(0)} max ${Math.max(...opens).toFixed(0)}; search ms [${fmt(searches)}] median ${median(searches).toFixed(1)} max ${Math.max(...searches).toFixed(1)}`,
    );
    // UI: the search box finds the page (results while typing).
    await page.getByTestId("search-input").fill("marker321");
    await expect(page.getByTestId("search-hit")).toHaveCount(1);
    expect(median(opens)).toBeLessThan(300);
    expect(median(searches)).toBeLessThan(100);

    // P11-X1: the first share of the whole notebook (every page through the relay, large ones in parts) completes.
    if (relayDir) {
      await page.getByTestId("share-button").click();
      const dialog = page.getByTestId("share-dialog");
      await dialog.getByTestId("share-name").fill("Perf");
      await dialog.getByTestId("share-name-ok").click();
      const s0 = Date.now();
      await dialog.getByTestId("share-on").click();
      await expect(page.getByTestId("sync-state")).toHaveAttribute("data-state", "synced", { timeout: 600_000 });
      const shareMs = Date.now() - s0;
      let bytes = 0;
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else bytes += fs.statSync(f).size;
        }
      };
      walk(relayDir);
      console.log(`notes perf: first share of 500 pages ${(shareMs / 1000).toFixed(1)} s, relay holds ${(bytes / 1048576).toFixed(1)} MB`);
    }
  });
});
