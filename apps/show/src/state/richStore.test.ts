import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { fixture } from "../test/fixture";
import { ShowStore } from "./store";

async function store(backend = new FakeBackend()) {
  const s = new ShowStore(new ShowApi(backend));
  await s.init();
  return { s, backend };
}

describe("store: charts, links, media, reuse", () => {
  it("inserts a chart of a preset, selects it and shows Chart Design; formatting edits are skipped when nothing changes", async () => {
    const { s, backend } = await store();
    await s.insertChart("barStacked");
    expect(backend.commands[0]).toMatchObject({ type: "insertChart", kind: { type: "bar", direction: "bar", grouping: "stacked" } });
    expect(s.getState().ribbonTab).toBe("chartDesign");
    const sel = s.selectedChart()!;
    expect(sel.chart.data.series).toHaveLength(3);
    await s.updateChart((c) => c);
    expect(backend.commands).toHaveLength(1);
    await s.updateChart((c) => ({ ...c, style: 5 }));
    expect(backend.commands[1]).toMatchObject({ type: "updateChart", chart: { style: 5 } });
    await s.insertChart("nope");
    expect(backend.commands).toHaveLength(2);
    s.selectChartSeries(-3);
    expect(s.getState().chartSeries).toBe(0);
  });

  it("links and actions need a target: nothing is sent without a selection", async () => {
    const { s, backend } = await store();
    await s.setLink({ target: { kind: "endShow" } });
    expect(backend.commands).toHaveLength(0);
    s.selectSlide(7);
    s.select([8]);
    expect(s.currentLink()).toBeNull();
    await s.setLink({ target: { kind: "endShow" } });
    expect(backend.commands[0]).toEqual({ type: "setClickAction", shapes: [8], action: { target: { kind: "endShow" } } });
    expect(s.currentLink()).toEqual({ target: { kind: "endShow" } });
  });

  it("Reuse Slides: a failed read is a message; without a peeked deck nothing is inserted", async () => {
    const { s, backend } = await store();
    await s.peekReuse({ name: "x.pptx", bytesBase64: "AA==" });
    expect(s.getState().toasts).toHaveLength(1);
    await s.reuseSlides([1], false);
    expect(backend.commands).toHaveLength(0);
    backend.peek = fixture();
    await s.peekReuse({ name: "y.pptx", bytesBase64: "AA==" });
    expect(s.getState().reuse?.name).toBe("y.pptx");
    expect(s.getState().reusePane).toBe(true);
    await s.reuseSlides([1, 7], false);
    expect(backend.commands[0]).toMatchObject({ type: "insertSlides", after: 1, keepSourceFormatting: false });
    expect(s.getState().pres!.slides).toHaveLength(5);
  });

  it("media: playback settings go to the selected clips only", async () => {
    const { s, backend } = await store();
    await s.setMediaProps({ loop: true });
    expect(backend.commands).toHaveLength(0);
    await s.insertMedia("audio/mpeg", "SUQz");
    expect(s.getState().ribbonTab).toBe("playback");
    await s.setMediaProps({ loop: true });
    expect(backend.commands[1]).toMatchObject({ type: "setMediaProps", patch: { loop: true } });
    await s.setMediaPoster(null);
    expect(backend.commands[2]).toMatchObject({ type: "setMediaPoster" });
    expect(backend.commands[2]).not.toHaveProperty("bytesBase64");
  });
});
