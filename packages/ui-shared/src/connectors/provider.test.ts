// The FileProvider contract, run against the in-memory fake and against the browser WebDAV transport (over a
// simulated WebDAV server): the same semantics everywhere.

import { describe, expect, it } from "vitest";
import { MemoryProvider } from "./fake";
import { ConflictError, ConnectorError, type FileProvider } from "./provider";
import { davFetch } from "./testing";
import { FetchWebDavProvider } from "./webdav-fetch";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const PROVIDERS: [string, () => { fs: MemoryProvider; p: FileProvider }][] = [
  ["memory", () => {
    const fs = new MemoryProvider();
    return { fs, p: fs };
  }],
  ["webdav over fetch", () => {
    const fs = new MemoryProvider();
    const p = new FetchWebDavProvider(
      { baseUrl: "https://dav.example.com/dav", rootPath: "/", auth: { kind: "basic", username: "u", password: "p" }, allowHttp: false },
      davFetch(fs),
    );
    return { fs, p };
  }],
];

for (const [label, make] of PROVIDERS) {
  describe(`FileProvider contract: ${label}`, () => {
    it("lists a folder without itself, files with size and etag", async () => {
      const { fs, p } = make();
      fs.put("/Docs/a.xlsx", "hello");
      fs.put("/Docs/Sub/b.docx", "x");
      fs.put("/top.pptx", "y");
      const root = await p.list("/");
      expect(root.map((e) => [e.name, e.kind]).sort()).toEqual([["Docs", "folder"], ["top.pptx", "file"]]);
      const docs = await p.list("/Docs");
      const a = docs.find((e) => e.name === "a.xlsx")!;
      expect(a).toMatchObject({ path: "/Docs/a.xlsx", kind: "file", size: 5 });
      expect(a.etag).toBeTruthy();
      expect(docs.find((e) => e.name === "Sub")?.kind).toBe("folder");
    });

    it("reads bytes with the entity tag; stat agrees", async () => {
      const { fs, p } = make();
      const tag = fs.put("/a.xlsx", "PK-data");
      const r = await p.read("/a.xlsx");
      expect(dec(r.bytes)).toBe("PK-data");
      expect(r.etag).toBe(tag);
      expect((await p.stat("/a.xlsx")).etag).toBe(tag);
    });

    it("writes with If-Match and returns the new tag", async () => {
      const { fs, p } = make();
      const tag = fs.put("/a.xlsx", "v1");
      const next = await p.write("/a.xlsx", enc("v2"), { ifMatch: tag });
      expect(next).toBeTruthy();
      expect(next).not.toBe(tag);
      expect(dec((await p.read("/a.xlsx")).bytes)).toBe("v2");
    });

    it("refuses a stale If-Match with ConflictError and keeps the server's version", async () => {
      const { fs, p } = make();
      const old = fs.put("/a.xlsx", "v1");
      fs.put("/a.xlsx", "theirs");
      await expect(p.write("/a.xlsx", enc("mine"), { ifMatch: old })).rejects.toBeInstanceOf(ConflictError);
      expect(dec((await p.read("/a.xlsx")).bytes)).toBe("theirs");
    });

    it("If-None-Match refuses an existing file, creates a new one", async () => {
      const { fs, p } = make();
      fs.put("/a.xlsx", "v1");
      await expect(p.write("/a.xlsx", enc("x"), { ifNoneMatch: true })).rejects.toBeInstanceOf(ConflictError);
      expect(await p.write("/b.xlsx", enc("x"), { ifNoneMatch: true })).toBeTruthy();
    });

    it("creates folders; an existing name is a conflict", async () => {
      const { p } = make();
      await p.mkdir("/New folder");
      expect((await p.list("/")).map((e) => e.name)).toEqual(["New folder"]);
      await expect(p.mkdir("/New folder")).rejects.toBeInstanceOf(ConflictError);
    });

    it("renames and moves; an existing target needs overwrite", async () => {
      const { fs, p } = make();
      fs.put("/a.xlsx", "a");
      fs.put("/b.xlsx", "b");
      await p.rename("/a.xlsx", "/c ü.xlsx");
      expect((await p.list("/")).map((e) => e.name).sort()).toEqual(["b.xlsx", "c ü.xlsx"]);
      await expect(p.rename("/b.xlsx", "/c ü.xlsx")).rejects.toBeInstanceOf(ConflictError);
      await p.rename("/b.xlsx", "/c ü.xlsx", { overwrite: true });
      expect(dec((await p.read("/c ü.xlsx")).bytes)).toBe("b");
    });

    it("deletes files and folders with their contents, never the root", async () => {
      const { fs, p } = make();
      fs.put("/Docs/Sub/a.docx", "a");
      await p.delete("/Docs");
      expect(await p.list("/")).toEqual([]);
      await expect(p.delete("/")).rejects.toBeInstanceOf(ConnectorError);
    });

    it("reports a missing file as notFound", async () => {
      const { p } = make();
      await expect(p.read("/missing.xlsx")).rejects.toMatchObject({ kind: "notFound" });
    });

    it("keeps UTF-8 and reserved characters in names", async () => {
      const { p } = make();
      const name = "Grüße & 50% #1 日本.docx";
      await p.write(`/${name}`, enc("u"));
      expect((await p.list("/")).map((e) => e.name)).toEqual([name]);
      expect(dec((await p.read(`/${name}`)).bytes)).toBe("u");
    });
  });
}
