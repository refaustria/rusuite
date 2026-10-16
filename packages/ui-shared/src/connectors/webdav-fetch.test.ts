import { describe, expect, it } from "vitest";
import { MemoryProvider } from "./fake";
import { ConnectorError } from "./provider";
import { davFetch, type DavLog } from "./testing";
import { FetchWebDavProvider, noteCspViolation, type FetchLike } from "./webdav-fetch";

const target = (over: Partial<{ baseUrl: string; rootPath: string; allowHttp: boolean }> = {}) => ({
  baseUrl: "https://cloud.example.com/dav",
  rootPath: "/Team Files",
  auth: { kind: "basic" as const, username: "alice", password: "pw" },
  allowHttp: false,
  ...over,
});

describe("FetchWebDavProvider", () => {
  it("sends PROPFIND depth 1 with Basic auth, encoded root and no cookies", async () => {
    const fs = new MemoryProvider();
    fs.put("/Team Files/a.xlsx", "x");
    const log: DavLog[] = [];
    let init: RequestInit | null = null;
    const inner = davFetch(fs, "/dav", log);
    const p = new FetchWebDavProvider(target(), (url, i) => {
      init = i;
      return inner(url, i);
    });
    expect((await p.list("/")).map((e) => e.path)).toEqual(["/a.xlsx"]);
    expect(log[0]).toMatchObject({ method: "PROPFIND", url: "https://cloud.example.com/dav/Team%20Files/" });
    expect(log[0]!.headers.depth).toBe("1");
    expect(log[0]!.headers.authorization).toBe(`Basic ${btoa("alice:pw")}`);
    expect(init).toMatchObject({ credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", cache: "no-store" });
  });

  it("sends If-Match on writes and Destination/Overwrite on moves", async () => {
    const fs = new MemoryProvider();
    const tag = fs.put("/Team Files/a.xlsx", "x");
    const log: DavLog[] = [];
    const p = new FetchWebDavProvider(target(), davFetch(fs, "/dav", log));
    await p.write("/a.xlsx", new Uint8Array([1]), { ifMatch: tag });
    await p.rename("/a.xlsx", "/b ä.xlsx");
    expect(log.find((l) => l.method === "PUT")!.headers["if-match"]).toBe(tag);
    const mv = log.find((l) => l.method === "MOVE")!;
    expect(mv.headers.destination).toBe("https://cloud.example.com/dav/Team%20Files/b%20%C3%A4.xlsx");
    expect(mv.headers.overwrite).toBe("F");
  });

  it("refuses plain http unless allowed", () => {
    expect(() => new FetchWebDavProvider(target({ baseUrl: "http://nas.local/dav" }))).toThrow(ConnectorError);
    expect(new FetchWebDavProvider(target({ baseUrl: "http://nas.local/dav", allowHttp: true })).url("/a b")).toBe("http://nas.local/dav/Team%20Files/a%20b");
  });

  it("maps statuses: 401 auth, 403 forbidden, 412 conflict, redirects refused", async () => {
    const reply = (status: number, type: ResponseType = "default"): FetchLike => async () => {
      const r = new Response(null, { status: status === 0 ? 200 : status });
      if (type === "opaqueredirect") Object.defineProperty(r, "type", { value: "opaqueredirect" });
      return r;
    };
    const kind = async (f: FetchLike) => new FetchWebDavProvider(target(), f).read("/a").catch((e: ConnectorError) => e.kind);
    expect(await kind(reply(401))).toBe("auth");
    expect(await kind(reply(403))).toBe("forbidden");
    expect(await kind(reply(500))).toBe("http");
    expect(await new FetchWebDavProvider(target(), reply(412)).write("/a", new Uint8Array(), { ifMatch: '"1"' }).catch((e: ConnectorError) => e.kind)).toBe("conflict");
    expect(await kind(reply(0, "opaqueredirect"))).toBe("insecure");
  });

  it("tells a CSP block from a CORS failure", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    const cors = (await new FetchWebDavProvider(target(), failing).list("/").catch((e: ConnectorError) => e)) as ConnectorError;
    expect(cors.kind).toBe("cors");
    expect(cors.message).toContain("https://cloud.example.com");
    const blocked: FetchLike = async () => {
      noteCspViolation("https://cloud.example.com");
      throw new TypeError("Failed to fetch");
    };
    expect(await new FetchWebDavProvider(target(), blocked).list("/").catch((e: ConnectorError) => e.kind)).toBe("csp");
  });
});
