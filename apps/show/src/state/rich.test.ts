import { describe, expect, it } from "vitest";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Presentation } from "../generated/Presentation";
import { fixture, textShape } from "../test/fixture";
import { linkAt, linkCommands, mediaIdsOf, mediaType, reusePayload, wordAt } from "./rich";

const link: Hyperlink = { target: { kind: "url", value: "https://example.com" } };

describe("hyperlinks of the edited text", () => {
  it("a collapsed caret links the word around it", () => {
    expect(wordAt("see example.com now", 6)).toEqual({ from: 4, to: 15 });
    expect(wordAt("a  b", 2)).toEqual({ from: 2, to: 2 });
    expect(linkCommands(3, "see example.com now", 6, 6, link)).toEqual([{ type: "setHyperlink", shape: 3, paragraph: 0, from: 4, to: 15, link }]);
    expect(linkCommands(3, "  ", 1, 1, link)).toEqual([]);
  });

  it("a selection over paragraphs links each part (UTF-16 offsets → code points)", () => {
    const text = "Héllo 😀 wörld\nsecond line";
    const start = 6;
    const end = text.indexOf("second") + 6;
    expect(linkCommands(3, text, end, start, null)).toEqual([
      { type: "setHyperlink", shape: 3, paragraph: 0, from: 6, to: 13, link: null },
      { type: "setHyperlink", shape: 3, paragraph: 1, from: 0, to: 6, link: null },
    ]);
  });

  it("finds the link at the caret for the dialog", () => {
    const s = textShape(5, ["x"]);
    if (s.kind.kind === "auto") s.kind.value.text!.paragraphs[0]!.runs = [{ text: "Go " }, { text: "here", hyperlink: link }];
    expect(linkAt(s, "Go here", 5)).toEqual(link);
    expect(linkAt(s, "Go here", 1)).toBeNull();
  });
});

describe("media of shapes and Reuse Slides", () => {
  it("collects pictures, clips with posters and chart workbooks, also in groups", () => {
    const p = fixture();
    const pic = { ...p.slides[2]!.shapes[0]!, id: 60, kind: { kind: "picture" as const, value: { media: 4 } } };
    const clip = { ...pic, id: 61, kind: { kind: "media" as const, value: { kind: "video" as const, media: 5, poster: 6, start: "onClick" as const } } };
    const group = { ...pic, id: 62, kind: { kind: "group" as const, value: { children: [pic, clip] } } };
    expect(mediaIdsOf([group, pic])).toEqual([4, 5, 6]);
  });

  it("sends the picked slides, the layouts they use and only their media", () => {
    const p: Presentation = fixture();
    p.media = [{ id: 1, contentType: "image/png", data: "AA==" }, { id: 2, contentType: "image/png", data: "AQ==" }];
    p.slides[2]!.shapes.push({ ...p.slides[2]!.shapes[0]!, id: 70, kind: { kind: "picture", value: { media: 2 } } });
    const r = reusePayload(p, [7]);
    expect(r.slides.map((s) => s.id)).toEqual([7]);
    expect(r.layouts.map((l) => l.kind)).toEqual(["blank"]);
    expect(r.media.map((m) => m.id)).toEqual([2]);
  });

  it("accepts audio and video by type or extension", () => {
    expect(mediaType({ name: "a.bin", type: "video/webm" })).toBe("video/webm");
    expect(mediaType({ name: "clip.MP4", type: "" })).toBe("video/mp4");
    expect(mediaType({ name: "song.mp3", type: "" })).toBe("audio/mpeg");
    expect(mediaType({ name: "doc.pdf", type: "application/pdf" })).toBeNull();
  });
});
