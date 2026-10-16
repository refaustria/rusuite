import { describe, expect, it } from "vitest";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { TextBody } from "../generated/TextBody";
import { approxMeasure, autoNumLabel, bulletLabels, layoutText, type LayoutOptions, type RunStyle } from "./layout";

const style = (p: RunProperties | undefined): RunStyle => ({
  fontFamily: "Calibri",
  sizePx: ((p?.size ?? 1800) / 100) * (4 / 3),
  bold: !!p?.bold,
  italic: !!p?.italic,
  underline: !!p?.underline && p.underline !== "none",
  strike: !!p?.strike,
  color: p?.color?.kind === "rgb" ? `#${p.color.value}` : "#000000",
});

const opts = (width: number, height: number): LayoutOptions => ({
  width, height, measure: approxMeasure, runStyle: style, paragraphProps: (p) => p ?? {},
});

const noInsets = { left: 0, top: 0, right: 0, bottom: 0 };
const mk = (paragraphs: TextBody["paragraphs"], props: Partial<TextBody["props"]> = {}): TextBody => ({
  props: { anchor: "top", wrap: true, insets: noInsets, autofit: "none", ...props },
  paragraphs,
});

describe("text layout", () => {
  it("emits one fragment per run with its own font, style and colour", () => {
    const b = mk([{ runs: [{ text: "Hi " }, { text: "there", props: { bold: true, italic: true, underline: "single", size: 3600, color: { kind: "rgb", value: "FF0000" } } }] }]);
    const f = layoutText(b, opts(1000, 200)).fragments;
    expect(f.map((x) => x.text)).toEqual(["Hi ", "there"]);
    expect(f[1]).toMatchObject({ fontStyle: "italic bold", textDecoration: "underline", fill: "#FF0000", fontSize: 48 });
    expect(f[1]!.x).toBeCloseTo(f[0]!.width);
  });

  it("wraps at the box width and aligns lines", () => {
    // 24 px font → 12 px per char in approxMeasure; 100 px fits 8 chars.
    const b = mk([{ props: { alignment: "right" }, runs: [{ text: "aaaa bbbb cccc" }] }]);
    const f = layoutText(b, opts(100, 400)).fragments.filter((x) => x.text.trim());
    expect(f.map((x) => x.text)).toEqual(["aaaa", "bbbb", "cccc"]);
    expect(f[0]!.y).toBeLessThan(f[2]!.y);
    expect(f[2]!.x + f[2]!.width).toBeCloseTo(100);
  });

  it("renders bullets and numbering with hanging indent and levels", () => {
    expect(autoNumLabel("romanUcPeriod", 4)).toBe("IV.");
    expect(autoNumLabel("alphaLcPeriod", 28)).toBe("ab.");
    const auto = { kind: "autoNum", value: "arabicPeriod" } as const;
    expect(bulletLabels([{ bullet: auto, level: 0 }, { bullet: auto, level: 1 }, { bullet: auto, level: 0 }, { bullet: null, level: 0 }, { bullet: auto, level: 0 }]))
      .toEqual(["1.", "1.", "2.", null, "1."]);
    const b = mk([
      { props: { bullet: { kind: "char", value: "•" } }, runs: [{ text: "one" }] },
      { props: { bullet: { kind: "char", value: "•" }, level: 1 }, runs: [{ text: "two" }] },
    ]);
    const f = layoutText(b, opts(500, 300)).fragments;
    expect(f.map((x) => x.text)).toEqual(["•", "one", "•", "two"]);
    expect(f[1]!.x).toBeGreaterThan(f[0]!.x);
    expect(f[2]!.x).toBe(48);
  });

  it("anchors text vertically", () => {
    const b = (anchor: "top" | "middle" | "bottom") => mk([{ runs: [{ text: "x" }] }], { anchor });
    const y = (a: "top" | "middle" | "bottom") => layoutText(b(a), opts(100, 300)).fragments[0]!.y;
    expect(y("middle")).toBeGreaterThan(y("top"));
    expect(y("bottom") - y("middle")).toBeCloseTo(y("middle") - y("top"));
  });

  it("shrinks fonts with shrink autofit until the text fits", () => {
    const paras = Array.from({ length: 10 }, () => ({ runs: [{ text: "line" }] }));
    const plain = layoutText(mk(paras), opts(500, 100));
    const shrunk = layoutText(mk(paras, { autofit: "shrink" }), opts(500, 100));
    expect(plain.scale).toBe(1);
    expect(shrunk.scale).toBeLessThan(1);
    expect(shrunk.height).toBeLessThanOrEqual(100);
    expect(shrunk.fragments[0]!.fontSize).toBeLessThan(plain.fragments[0]!.fontSize);
  });
});

describe("hyperlinks", () => {
  it("linked runs are underlined in the link colour and their fragments carry the link", () => {
    const link = { target: { kind: "url" as const, value: "https://example.com" } };
    const b = mk([{ runs: [{ text: "Go " }, { text: "here", hyperlink: link }] }]);
    const f = layoutText(b, { ...opts(1000, 200), linkColor: "#0563C1" }).fragments;
    expect(f[0]!.link).toBeUndefined();
    expect(f[1]).toMatchObject({ text: "here", textDecoration: "underline", fill: "#0563C1", link });
    // without a link colour the run keeps its own
    const g = layoutText(b, opts(1000, 200)).fragments;
    expect(g[1]!.fill).toBe("#000000");
  });

  it("reports per-paragraph metrics matching the fragments (the in-place editor's CSS, P8-45)", () => {
    const dot = { kind: "char", value: "•" } as const;
    const b = mk([
      { props: { bullet: dot }, runs: [{ text: "one" }] },
      { props: { bullet: dot, level: 2 }, runs: [] },
      { props: { alignment: "justify", lineSpacing: { kind: "points", value: 3000 } }, runs: [{ text: "x" }] },
    ]);
    const lay = layoutText(b, opts(500, 300));
    const [m0, m1, m2] = lay.paragraphs!;
    const one = lay.fragments.find((f) => f.text === "one")!;
    const bullet = lay.fragments.find((f) => f.text === "•")!;
    expect(m0!.textX).toBeCloseTo(one.x);
    expect(m0!.indent).toBeCloseTo(bullet.x);
    // an empty bulleted paragraph still knows its bullet (shown while editing) and indent
    expect(m1).toMatchObject({ label: "•", indent: 96, level: 2 });
    expect(m1!.textX).toBeGreaterThan(96);
    expect(m2).toMatchObject({ label: null, alignment: "left", lineHeight: { kind: "fixed", px: 40 } });
    expect(layoutText(mk([{ props: { alignment: "center" }, runs: [{ text: "c" }] }], { wrap: false }), opts(500, 300)).paragraphs![0]!.alignment).toBe("left");
  });
});
