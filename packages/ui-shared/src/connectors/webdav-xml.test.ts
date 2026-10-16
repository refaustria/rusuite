import { describe, expect, it } from "vitest";
import { entriesOf, hrefToPath, parseMultistatus } from "./webdav-xml";

const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Docs/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>"f0"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Docs/Gr%C3%BC%C3%9Fe%20%26%20Co.xlsx</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1234</d:getcontentlength>
      <d:getlastmodified>Sun, 06 Nov 1994 08:49:37 GMT</d:getlastmodified><d:getetag>&quot;e1&quot;</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><d:displayname/><d:getcontentlength>99</d:getcontentlength></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>https://cloud.example.com/remote.php/dav/files/alice/Docs/Sub/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection></d:collection></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <D:response xmlns:D="DAV:"><D:href>/elsewhere/x.docx</D:href></D:response>
</d:multistatus>`;

describe("WebDAV multistatus", () => {
  it("reads hrefs and properties of 2xx propstats with any prefix", () => {
    const all = parseMultistatus(MULTISTATUS);
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ collection: true, etag: '"f0"' });
    expect(all[1]).toMatchObject({ collection: false, size: 1234, etag: '"e1"', displayName: null });
    expect(all[3]!.href).toBe("/elsewhere/x.docx");
  });

  it("maps to entries below the prefix, decoding UTF-8 names and skipping the folder itself", () => {
    const entries = entriesOf(parseMultistatus(MULTISTATUS), "/remote.php/dav/files/alice", "/Docs");
    expect(entries.map((e) => [e.name, e.path, e.kind])).toEqual([
      ["Grüße & Co.xlsx", "/Docs/Grüße & Co.xlsx", "file"],
      ["Sub", "/Docs/Sub", "folder"],
    ]);
    expect(entries[0]!.modified).toBe(784111777000);
    expect(entries[1]!.size).toBeNull();
  });

  it("maps hrefs to relative paths", () => {
    expect(hrefToPath("/dav/a%20b/c.docx", "/dav")).toBe("/a b/c.docx");
    expect(hrefToPath("/dav/", "/dav/")).toBe("/");
    expect(hrefToPath("/davx/c", "/dav")).toBeNull();
    expect(hrefToPath("http://h:1/r%C3%B6ot/x", "/r%C3%B6ot")).toBe("/x");
    expect(hrefToPath("/x", "")).toBe("/x");
  });

  it("refuses a reply that is not XML", () => {
    expect(() => parseMultistatus("<a></b>")).toThrow(/PROPFIND/);
    expect(parseMultistatus('<multistatus xmlns="DAV:"/>')).toEqual([]);
  });
});
