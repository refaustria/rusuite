// Placeholders round 2 (P9-S5): Insert Placeholder › Text, the prompt
// per placeholder type, the "Insert Picture" icon of empty picture and
// content placeholders; combo charts on slides keep Excel's z-order.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { designFixture } from "../test/fixture";
import { PlaceholderIcons, takesPicture } from "./PlaceholderIcons";
import { promptOf } from "./SlideView";
import { deckOf } from "../design/deck";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import { chartScene } from "../charts/render";
import type { ChartShape } from "../generated/ChartShape";

afterEach(cleanup);

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

/** An empty placeholder shape of `kind`. */
function ph(id: number, kind: "picture" | "body" | "title", text = ""): Shape {
  return {
    id, name: "", transform: { x: 1_000_000, y: 1_000_000, w: 3_000_000, h: 2_000_000, rotationDeg: 0 },
    kind: { kind: "auto", value: { geometry: "rect", text: { props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" }, paragraphs: [{ props: {}, runs: text ? [{ text }] : [] }] } } },
    fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" }, placeholder: kind,
  };
}

function deckWithPlaceholders(): Presentation {
  const p = designFixture();
  p.slides[0]!.shapes.push(ph(500, "picture"), ph(501, "body"), ph(502, "body", "typed"), ph(503, "title"));
  return p;
}

describe("Insert Picture in placeholders", () => {
  it("empty picture placeholders show the icon; content (its text stays clickable), typed or other ones do not", () => {
    expect(takesPicture(ph(1, "picture"))).toBe(true);
    expect(takesPicture(ph(1, "picture", "x"))).toBe(false);
    expect(takesPicture(ph(1, "body"))).toBe(false);
    expect(takesPicture(ph(1, "title"))).toBe(false);
  });

  it("the icon picks an image that fills the placeholder (one command)", async () => {
    const backend = new FakeBackend(deckWithPlaceholders());
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    const slide = store.getState().pres!.slides[0]!;
    render(<PlaceholderIcons store={store} slide={slide} scale={0.5} />);
    expect(screen.queryByTestId("ph-picture-502")).toBeNull();
    expect(screen.queryByTestId("ph-picture-503")).toBeNull();
    const icon = screen.getByTestId("ph-picture-500");
    expect(icon.getAttribute("aria-label")).toBe("Insert Picture");
    expect(screen.queryByTestId("ph-picture-501")).toBeNull();
    fireEvent.click(icon);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("ph-picture-input"), { target: { files: [file] } });
    await flush();
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "insertPicture", slide: slide.id, placeholder: 500, contentType: "image/png" });
    const shapes = store.getState().pres!.slides[0]!.shapes;
    const pic = shapes.find((s) => s.kind.kind === "picture")!;
    expect(pic.placeholder).toBe("picture");
    expect(pic.transform).toEqual(ph(500, "picture").transform);
    expect(shapes.some((s) => s.id === 500)).toBe(false);
  });

  it("prompts per placeholder type", () => {
    const p = deckWithPlaceholders();
    const ctx = { deck: deckOf(p), slide: p.slides[0]! };
    const t = (k: string) => k;
    expect(promptOf(ctx, ph(1, "picture"), t)).toBe("show.prompt.picture");
    expect(promptOf(ctx, ph(1, "body"), t)).toBe("show.prompt.text");
    expect(promptOf(ctx, ph(1, "title"), t)).toBe("show.prompt.title");
  });
});

describe("Slide Master › Insert Placeholder › Text", () => {
  it("adds a text-only body placeholder", async () => {
    const backend = new FakeBackend(designFixture());
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    store.openMasterView();
    store.selectDesignTarget({ kind: "layout", value: "blank" });
    await store.insertPlaceholder("body", true);
    expect(backend.commands.at(-1)).toMatchObject({ type: "addPlaceholder", kind: "body", textOnly: true });
    const defs = store.getState().pres!.layouts.find((l) => l.kind === "blank")!.placeholders;
    expect(defs.at(-1)!.textOnly).toBe(true);
    // Content stays a content placeholder; a picture is never text only
    await store.insertPlaceholder("body");
    expect(backend.commands.at(-1)).not.toHaveProperty("textOnly");
    await store.insertPlaceholder("picture", true);
    expect(backend.commands.at(-1)).not.toHaveProperty("textOnly");
  });
});

describe("combo charts on slides (S-10)", () => {
  it("draw areas behind columns behind lines, whatever the series order", () => {
    const series = (i: number) => ({ values: { type: "ref" as const, formula: `V${i}` } });
    const shape: ChartShape = {
      chart: {
        kind: { type: "combo" },
        series: [
          { ...series(0), kind: { type: "bar", direction: "column", grouping: "clustered" } },
          { ...series(1), kind: { type: "line", grouping: "standard", markers: false } },
          { ...series(2), kind: { type: "area", grouping: "standard" } },
        ],
        axes: { cat: {}, val: {} },
      } as ChartShape["chart"],
      data: { categories: ["A", "B", "C"], series: [{ name: "Cols", values: [5, 6, 7] }, { name: "Line", values: [3, 4, 5] }, { name: "Area", values: [8, 2, 6] }] } as unknown as ChartShape["data"],
    };
    const scene = chartScene(shape, 400, 300, {});
    const first = (n: number) => scene.items.findIndex((it) => it.el?.type === "series" && it.el.series === n);
    expect(first(2)).toBeGreaterThanOrEqual(0);
    expect(first(2)).toBeLessThan(first(0));
    expect(first(0)).toBeLessThan(first(1));
  });
});

