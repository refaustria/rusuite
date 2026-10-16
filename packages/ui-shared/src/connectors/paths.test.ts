import { describe, expect, it } from "vitest";
import { ancestors, baseName, checkBaseUrl, copyName, decodePercent, encodePath, encodeSegment, hasExtension, joinPath, normalizePath, originOf, parentPath, splitExt } from "./paths";
import { ConnectorError } from "./provider";

describe("connector paths", () => {
  it("normalize like the Rust side and refuse ..", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("Docs//a.xlsx/")).toBe("/Docs/a.xlsx");
    expect(normalizePath("/./Docs")).toBe("/Docs");
    expect(() => normalizePath("/Docs/../x")).toThrow(ConnectorError);
    expect(() => normalizePath("/a\\b")).toThrow(ConnectorError);
  });

  it("join, parent, base name and ancestors", () => {
    expect(joinPath("/", "a b.docx")).toBe("/a b.docx");
    expect(joinPath("/Docs", "ä.xlsx")).toBe("/Docs/ä.xlsx");
    expect(() => joinPath("/Docs", "a/b")).toThrow();
    expect(parentPath("/Docs/a.xlsx")).toBe("/Docs");
    expect(parentPath("/a.xlsx")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(baseName("/Docs/a.xlsx")).toBe("a.xlsx");
    expect(ancestors("/a/b")).toEqual(["/", "/a", "/a/b"]);
    expect(ancestors("/")).toEqual(["/"]);
  });

  it("percent-encode UTF-8 per segment, RFC 3986 style", () => {
    expect(encodeSegment("Bericht 2026 ü#?.docx")).toBe("Bericht%202026%20%C3%BC%23%3F.docx");
    expect(encodeSegment("it's (1)*!")).toBe("it%27s%20%281%29%2A%21");
    expect(encodePath("/Docs/a b")).toBe("/Docs/a%20b");
    for (const s of ["Grüße & Co.xlsx", "日本語.pptx", "a+b=c;d.docx"]) expect(decodePercent(encodeSegment(s))).toBe(s);
    expect(decodePercent("100%")).toBe("100%");
    expect(decodePercent("%zz%C3%BC")).toBe("%zzü");
  });

  it("extensions, copies and server URLs", () => {
    expect(splitExt("Budget.XLSX")).toEqual(["Budget", ".xlsx"]);
    expect(splitExt(".hidden")).toEqual([".hidden", ""]);
    expect(hasExtension("a.docx", [".docx"])).toBe(true);
    expect(hasExtension("a.xlsx", [".docx"])).toBe(false);
    expect(hasExtension("a.xlsx", [])).toBe(true);
    expect(copyName("Budget.xlsx")).toBe("Budget (copy).xlsx");
    expect(copyName("Budget.xlsx", 3)).toBe("Budget (copy 3).xlsx");
    expect(checkBaseUrl(" https://cloud.example.com/dav/ ", false)).toBe("https://cloud.example.com/dav");
    expect(() => checkBaseUrl("http://nas.local", false)).toThrow(/http/);
    expect(checkBaseUrl("http://nas.local:5005", true)).toBe("http://nas.local:5005");
    expect(() => checkBaseUrl("ftp://x", true)).toThrow();
    expect(() => checkBaseUrl("https://u:p@host", false)).toThrow();
    expect(originOf("https://h:8443/a/b")).toBe("https://h:8443");
  });
});
