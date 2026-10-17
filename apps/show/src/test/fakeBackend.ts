// In-memory backend for tests: records every request and answers like a
// (much simplified) Show core – enough commands to drive the store.

import type { ChartKindModel, OpenedFile } from "@rusuite/ui-shared";
import type { Envelope } from "../../../../packages/ui-shared/src/generated/Envelope";
import type { ShowBackend } from "../backend";
import type { NodeId } from "../generated/NodeId";
import type { PathCmd } from "../generated/PathCmd";
import type { PathQuery } from "../generated/PathQuery";
import type { ShapePaths } from "../generated/ShapePaths";
import type { Presentation } from "../generated/Presentation";
import type { Request } from "../generated/Request";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { ShowPatch } from "../generated/ShowPatch";
import type { Slide } from "../generated/Slide";
import type { TextField } from "../generated/TextField";
import { findShape } from "../model";
import { applyAnimationPatch } from "../anim/effects";
import { FAKE_THEMES, fixture } from "./fixture";
import { adjustDefaults } from "../shapes/presets";

/**
 * Outlines like the core's for tests: a box (filled presets) or a line
 * (connectors, `line`), rectangle sites, the box as text rectangle, and
 * for presets with adjust values one handle along the top edge driven by
 * the first value (linear in the shorter side, 0–50000).
 */
export function fakePaths(q: PathQuery): ShapePaths {
  const { w, h } = q;
  const line = q.kind.kind === "connector" || q.kind.value === "line";
  const commands: PathCmd[] = line
    ? [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: w, y: h }]
    : [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: w, y: 0 }, { kind: "lineTo", x: w, y: h }, { kind: "lineTo", x: 0, y: h }, { kind: "close" }];
  const preset = q.kind.kind === "preset" ? q.kind.value : null;
  const first = preset ? Object.entries(adjustDefaults(preset))[0] : undefined;
  const ss = Math.min(w, h);
  const handles = first
    ? [{ x: (ss * (q.adjust?.[first[0]] ?? first[1])) / 100000, y: 0, xAxis: { adj: first[0], base: 0, k: ss / 100000, min: 0, max: 50000 } }]
    : undefined;
  return {
    textRect: { l: 0, t: 0, r: w, b: h },
    ...(handles ? { handles } : {}),
    paths: [{ fill: !line, stroke: true, commands }],
    sites: q.kind.kind === "connector" ? [] : [
      { x: w / 2, y: 0, angleDeg: 270 },
      { x: 0, y: h / 2, angleDeg: 180 },
      { x: w / 2, y: h, angleDeg: 90 },
      { x: w, y: h / 2, angleDeg: 0 },
    ],
  };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A chart shape like the core's `InsertChart`: PowerPoint's 3 × 4 sample (pies: one series). */
export function fakeChartShape(id: number, kind: ChartKindModel, transform: Shape["transform"]): Shape {
  const pie = kind.type === "pie" || kind.type === "doughnut";
  const series = [
    { name: "Series 1", values: [4.3, 2.5, 3.5, 4.5] },
    { name: "Series 2", values: [2.4, 4.4, 1.8, 2.8] },
    { name: "Series 3", values: [2, 2, 3, 5] },
  ].slice(0, pie ? 1 : 3);
  const col = (i: number) => String.fromCharCode(66 + i);
  return {
    id, name: `Chart ${id}`, transform,
    kind: {
      kind: "chart",
      value: {
        chart: {
          kind, title: pie ? {} : { text: { type: "literal", text: "Chart Title" } }, legend: { position: "bottom" },
          series: series.map((_s, i) => ({ name: { type: "ref", formula: `Sheet1!$${col(i)}$1` }, values: { type: "ref", formula: `Sheet1!$${col(i)}$2:$${col(i)}$5` } })),
          categories: { type: "ref", formula: "Sheet1!$A$2:$A$5" }, axes: { cat: {}, val: { majorGridlines: true } }, ...(pie ? { varyColors: true } : { gapWidth: 219, overlap: -27 }),
        },
        data: { categories: ["Category 1", "Category 2", "Category 3", "Category 4"], series },
      },
    },
    fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
  };
}

export class FakeBackend implements ShowBackend {
  readonly kind = "wasm" as const;
  readonly log: Request[] = [];
  pres: Presentation;
  revision = 0;
  private nextId = 100;
  private history: Presentation[] = [];
  /** Commands that answer with this error code. */
  failWith: string | null = null;
  /** Unsaved changes (cleared by `markSaved`). */
  private dirty = false;
  /** What `openFile` returns next (`null` = cancelled). */
  nextOpen: OpenedFile | null = null;
  /** What `saveFile` returns (`false` = cancelled). */
  saveResult = true;
  saved: { name: string; bytesBase64: string }[] = [];

  private fresh: Presentation;
  /** The command changed the theme, master or layouts / the sections (sent with the patch). */
  private design = false;
  private sections = false;
  /** The command changed the view or slide-show settings. */
  private props = false;

  constructor(pres: Presentation = fixture()) {
    this.pres = clone(pres);
    this.fresh = clone(pres);
  }

  /** The commands sent (`apply` requests only). */
  get commands(): ShowCommand[] {
    return this.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
  }

  async ping() {
    return "Rusuite Show fake";
  }

  /** What `peekPresentation` answers (Reuse Slides). */
  peek: Presentation | null = null;

  /** Set by `restoreRecovery` (dirty until saved; the fake has no save). */
  restored = false;
  name: string | null = null;

  private envelope(patch: Partial<ShowPatch>): Envelope<ShowPatch> {
    return {
      revision: this.revision,
      patch: { slidesOrder: null, slides: [], deletedSlides: [], idMap: [], slideSize: null, info: null, ...patch },
      canUndo: this.history.length > 0,
      canRedo: false,
      dirty: this.dirty,
    };
  }

  private slideOf(id: NodeId): Slide {
    const s = this.pres.slides.find((sl) => findShape(sl.shapes, id) || sl.id === id);
    if (!s) throw new Error(`unknown id ${id}`);
    return s;
  }

  private real(temp: number, idMap: [number, number][]): number {
    if (temp >= 0) return temp;
    const id = this.nextId++;
    idMap.push([temp, id]);
    return id;
  }

  private withIds(shape: Shape, idMap: [number, number][]): Shape {
    const out: Shape = { ...shape, id: this.real(shape.id, idMap), name: shape.name || `Shape ${shape.id}` };
    if (shape.kind.kind === "group") out.kind = { kind: "group", value: { children: shape.kind.value.children.map((c) => this.withIds(c, idMap)) } };
    return out;
  }

  /** Applies the commands the tests need; others change nothing but still bump the revision. */
  private exec(c: ShowCommand, touched: Set<Slide>, idMap: [number, number][], order: { changed: boolean }): void {
    const p = this.pres;
    switch (c.type) {
      case "compound":
        c.commands.forEach((x) => this.exec(x, touched, idMap, order));
        return;
      case "addShape": {
        const s = this.slideOf(c.slide);
        const shape = this.withIds(c.shape, idMap);
        if (c.index === undefined || c.index === null) s.shapes.push(shape);
        else s.shapes.splice(c.index, 0, shape);
        touched.add(s);
        return;
      }
      case "insertPicture": {
        const s = this.slideOf(c.slide);
        const media = p.media.length + 1;
        p.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
        s.shapes.push({
          id: this.real(c.newId, idMap), name: "Picture", transform: { x: 0, y: 0, w: 952500, h: 952500 },
          kind: { kind: "picture", value: { media } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" }, lockAspect: true,
        });
        touched.add(s);
        return;
      }
      case "insertChart": {
        const s = this.slideOf(c.slide);
        s.shapes.push(fakeChartShape(this.real(c.newId, idMap), c.kind, c.transform ?? { x: 1219200, y: 685800, w: 8128000, h: 4572000 }));
        touched.add(s);
        return;
      }
      case "setChartData":
      case "updateChart": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind !== "chart") throw new Error("not a chart");
        if (c.type === "setChartData") {
          const { workbook: _, ...rest } = sh.kind.value;
          sh.kind = { kind: "chart", value: { ...rest, data: clone(c.data), chart: { ...rest.chart, series: c.data.series.map((_x, i) => rest.chart.series[i] ?? { values: { type: "ref", formula: `S${i}` } }) } } };
        } else sh.kind = { kind: "chart", value: { ...sh.kind.value, chart: clone(c.chart) } };
        touched.add(s);
        return;
      }
      case "setHyperlink": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        const para = sh.kind.kind === "auto" ? sh.kind.value.text?.paragraphs[c.paragraph] : undefined;
        if (!para) throw new Error("no paragraph");
        // whole runs overlapping the range (the fake does not split)
        let at = 0;
        for (const r of para.runs) {
          const len = Array.from(r.text).length;
          if (at < c.to && at + len > c.from) {
            if (c.link) r.hyperlink = c.link;
            else delete r.hyperlink;
          }
          at += len;
        }
        touched.add(s);
        return;
      }
      case "setClickAction":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (c.action) sh.clickAction = c.action;
          else delete sh.clickAction;
          touched.add(s);
        }
        return;
      case "insertMedia": {
        const s = this.slideOf(c.slide);
        const media = p.media.length + 1;
        p.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
        const audio = c.contentType.startsWith("audio/");
        s.shapes.push({
          id: this.real(c.newId, idMap), name: audio ? "Audio" : "Video", transform: { x: 0, y: 0, w: audio ? 457200 : 6096000, h: audio ? 457200 : 3429000 },
          kind: { kind: "media", value: { kind: audio ? "audio" : "video", media, start: "onClick" } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
        });
        touched.add(s);
        return;
      }
      case "setMediaProps":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind === "media") sh.kind = { kind: "media", value: { ...sh.kind.value, ...c.patch } };
          touched.add(s);
        }
        return;
      case "setMediaPoster": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind !== "media") throw new Error("not media");
        if (c.bytesBase64 && c.contentType) {
          const media = p.media.length + 1;
          p.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
          sh.kind = { kind: "media", value: { ...sh.kind.value, poster: media } };
        } else {
          const { poster: _, ...rest } = sh.kind.value;
          sh.kind = { kind: "media", value: rest };
        }
        touched.add(s);
        return;
      }
      case "insertSlides": {
        const at = c.after === undefined ? 0 : p.slides.findIndex((x) => x.id === c.after) + 1;
        const fresh = c.slides.map((sl) => {
          const copy = clone(sl);
          copy.id = this.nextId++;
          copy.shapes = copy.shapes.map((sh) => ({ ...sh, id: this.nextId++ }));
          if (!c.keepSourceFormatting && !p.layouts.some((l) => l.kind === copy.layout)) copy.layout = "titleContent";
          return copy;
        });
        p.slides.splice(at, 0, ...fresh);
        fresh.forEach((x) => touched.add(x));
        order.changed = true;
        return;
      }
      case "setTransform":
        for (const [id, t] of c.shapes) {
          const s = this.slideOf(id);
          findShape(s.shapes, id)!.shape.transform = t;
          touched.add(s);
        }
        return;
      case "deleteShapes":
        for (const id of c.ids) {
          const s = this.slideOf(id);
          s.shapes = s.shapes.filter((x) => x.id !== id);
          touched.add(s);
        }
        return;
      case "setTextBody": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "auto") sh.kind.value.text = c.body;
        touched.add(s);
        return;
      }
      case "addSlide": {
        const id = this.nextId++;
        const at = c.after === undefined || c.after === null ? 0 : p.slides.findIndex((s) => s.id === c.after) + 1;
        const slide: Slide = { id, layout: c.layout, shapes: [] };
        p.slides.splice(at, 0, slide);
        touched.add(slide);
        order.changed = true;
        return;
      }
      case "deleteSlides":
        p.slides = p.slides.filter((s) => !c.ids.includes(s.id));
        order.changed = true;
        return;
      case "moveSlide": {
        const i = p.slides.findIndex((s) => s.id === c.id);
        const [s] = p.slides.splice(i, 1);
        p.slides.splice(c.toIndex, 0, s!);
        order.changed = true;
        return;
      }
      case "duplicateSlide": {
        const i = p.slides.findIndex((s) => s.id === c.id);
        const copy = clone(p.slides[i]!);
        copy.id = this.nextId++;
        copy.shapes = copy.shapes.map((sh) => ({ ...sh, id: this.nextId++ }));
        p.slides.splice(i + 1, 0, copy);
        touched.add(copy);
        order.changed = true;
        return;
      }
      case "setSlideLayout": {
        const s = this.slideOf(c.slide);
        s.layout = c.layout;
        touched.add(s);
        return;
      }
      case "setSlidesHidden":
        for (const id of c.slides) {
          const s = this.slideOf(id);
          s.hidden = c.hidden;
          touched.add(s);
        }
        return;
      case "setNotes": {
        const s = this.slideOf(c.slide);
        s.notes = c.notes;
        touched.add(s);
        return;
      }
      // ----- design (P8-22): just enough of the core's behaviour for the UI tests
      case "applyTheme": {
        const b = FAKE_THEMES.find((x) => c.theme.kind === "builtin" && x.id === c.theme.value);
        if (b) {
          p.theme = clone(b.theme);
          if (p.master) p.master.background = clone(b.background);
        } else if (c.theme.kind === "custom") p.theme = clone(c.theme.value);
        this.design = true;
        return;
      }
      case "setThemeColors":
        p.theme = { ...p.theme, colors: clone(c.colors) };
        this.design = true;
        return;
      case "setDesignGuides": {
        if (c.target.kind === "master") {
          if (p.master) p.master.guides = clone(c.guides);
        } else {
          const t = c.target;
          const l = p.layouts.find((x) => x.kind === t.value);
          if (l) l.guides = clone(c.guides);
        }
        this.design = true;
        return;
      }
      case "setThemeEffects":
        p.theme = { ...p.theme, format: { ...(p.theme.format ?? { name: "", fillStyles: [], lineStyles: [], effectStyles: [], bgFillStyles: [] }), name: c.name, effectStyles: clone(c.effectStyles) } };
        this.design = true;
        return;
      case "setThemeFonts":
        p.theme = { ...p.theme, fonts: clone(c.fonts) };
        this.design = true;
        return;
      case "setBackground": {
        const t = c.target;
        if (t.kind === "slides") {
          for (const id of t.value) {
            const s = this.slideOf(id);
            s.background = c.fill ?? null;
            if (c.hideMasterShapes !== undefined) s.showMasterShapes = !c.hideMasterShapes;
            touched.add(s);
          }
        } else if (t.kind === "layout") {
          const l = p.layouts.find((x) => x.kind === t.value)!;
          l.background = c.fill ?? undefined;
          if (c.hideMasterShapes !== undefined) l.showMasterShapes = !c.hideMasterShapes;
          this.design = true;
        } else if (p.master) {
          p.master.background = c.fill ?? { kind: "style", value: { index: 1001, color: { kind: "theme", value: { slot: "light1", tint: 0 } } } };
          this.design = true;
        }
        return;
      }
      case "setMasterPlaceholderProps": {
        const defs = c.target.kind === "master" ? (p.master?.placeholders ?? []) : (p.layouts.find((l) => c.target.kind === "layout" && l.kind === c.target.value)?.placeholders ?? []);
        const d = defs.find((x) => x.kind === c.placeholder && (c.idx === undefined || (x.idx ?? 0) === c.idx));
        if (!d) throw new Error("no placeholder");
        if (c.patch.transform) d.transform = c.patch.transform;
        if (c.patch.run) d.runDefaults = { ...d.runDefaults, ...c.patch.run };
        if (c.patch.paragraph) d.paragraphDefaults = { ...d.paragraphDefaults, ...(c.patch.paragraph as object) } as typeof d.paragraphDefaults;
        this.design = true;
        return;
      }
      case "addLayout":
        p.layouts.push({ kind: `custom:${c.name}`, placeholders: [] });
        this.design = true;
        return;
      case "duplicateLayout": {
        const i = p.layouts.findIndex((l) => l.kind === c.layout);
        const copy = clone(p.layouts[i]!);
        copy.kind = `custom:1_${c.layout}`;
        p.layouts.splice(i + 1, 0, copy);
        this.design = true;
        return;
      }
      case "deleteLayout":
        p.layouts = p.layouts.filter((l) => l.kind !== c.layout);
        this.design = true;
        return;
      case "resetSlide":
        for (const id of c.slides) touched.add(this.slideOf(id));
        return;
      case "setHeaderFooter": {
        const ids = c.applyTo.kind === "all" ? p.slides.map((s) => s.id) : c.applyTo.value;
        for (const id of ids) {
          const s = this.slideOf(id);
          s.shapes = s.shapes.filter((x) => x.placeholder !== "dateTime" && x.placeholder !== "footer" && x.placeholder !== "slideNumber");
          if (!(c.notOnTitle && s.layout === "title")) {
            const at = (kind: "dateTime" | "footer" | "slideNumber", x: number, text: string, field?: TextField) => {
              s.shapes.push({
                id: this.nextId++, name: kind, transform: { x, y: 6356350, w: 2743200, h: 365125 },
                kind: { kind: "auto", value: { geometry: "rect", text: { props: { anchor: "middle", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" }, paragraphs: [{ runs: [field ? { text, field } : { text }] }] } } },
                fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" }, placeholder: kind,
              });
            };
            if (c.date.kind === "auto") at("dateTime", 838200, "", { kind: "dateTime", value: { format: c.date.value.format } });
            else if (c.date.kind === "fixed") at("dateTime", 838200, c.date.value.text);
            if (c.footer !== null && c.footer !== undefined) at("footer", 4038600, c.footer);
            if (c.slideNumber) at("slideNumber", 8610600, "‹#›", { kind: "slideNumber" });
          }
          touched.add(s);
        }
        if (c.applyTo.kind === "all" && p.master) {
          p.master.headerFooter = { date: c.date, footer: c.footer ?? undefined, slideNumber: c.slideNumber, notOnTitle: c.notOnTitle };
          this.design = true;
        }
        return;
      }
      case "addSection": {
        const secs = p.sections ?? [];
        if (!c.firstSlide) secs.push({ name: c.name, slideIds: [] });
        else if (!secs.length) {
          const i = p.slides.findIndex((s) => s.id === c.firstSlide);
          const ids = p.slides.map((s) => s.id);
          if (i > 0) secs.push({ name: "Default Section", slideIds: ids.slice(0, i) });
          secs.push({ name: c.name, slideIds: ids.slice(i) });
        } else {
          const si = secs.findIndex((x) => x.slideIds.includes(c.firstSlide!));
          const at = secs[si]!.slideIds.indexOf(c.firstSlide);
          const moved = secs[si]!.slideIds.splice(at);
          secs.splice(si + 1, 0, { name: c.name, slideIds: moved });
        }
        p.sections = secs;
        this.sections = true;
        return;
      }
      case "renameSection":
        p.sections![c.index]!.name = c.name;
        this.sections = true;
        return;
      case "removeSection": {
        const [gone] = p.sections!.splice(c.index, 1);
        if (c.keepSlides) {
          const into = p.sections![Math.max(0, c.index - 1)];
          if (into) into.slideIds.push(...gone!.slideIds);
        } else {
          p.slides = p.slides.filter((s) => !gone!.slideIds.includes(s.id));
          order.changed = true;
        }
        this.sections = true;
        return;
      }
      case "moveSection": {
        const [sec] = p.sections!.splice(c.index, 1);
        p.sections!.splice(c.toIndex, 0, sec!);
        const byId = new Map(p.slides.map((s) => [s.id, s]));
        p.slides = p.sections!.flatMap((x) => x.slideIds).map((id) => byId.get(id)!);
        order.changed = true;
        this.sections = true;
        return;
      }
      case "restoreSections":
        p.sections = clone(c.sections);
        this.sections = true;
        return;
      case "setPictureProps":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind === "picture") {
            const props = { ...(sh.kind.value.props ?? {}) } as Record<string, unknown>;
            for (const [k, v] of Object.entries(c.patch)) {
              if (v === null) delete props[k];
              else if (v !== undefined) props[k] = v;
            }
            sh.kind.value.props = props;
          }
          touched.add(s);
        }
        return;
      case "cropPicture": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "picture") sh.kind.value.props = { ...(sh.kind.value.props ?? {}), crop: c.crop };
        if (c.transform) sh.transform = c.transform;
        touched.add(s);
        return;
      }
      case "resetPicture":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind === "picture") sh.kind.value.props = {};
          touched.add(s);
        }
        return;
      case "setSlideBackground": {
        const s = this.slideOf(c.slide);
        s.background = c.fill ? { kind: "fill", value: c.fill } : null;
        touched.add(s);
        return;
      }
      case "setViewProps":
        p.view = clone(c.view);
        this.props = true;
        return;
      case "setShowSettings":
        p.showSettings = clone(c.settings);
        this.props = true;
        return;
      case "setCustomShows":
        p.customShows = clone(c.shows);
        this.props = true;
        return;
      // ----- P8-32
      case "setLockAspect":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (c.locked) sh.lockAspect = true;
          else delete sh.lockAspect;
          touched.add(s);
        }
        return;
      case "setBackgroundPicture": {
        const media = p.media.length + 1;
        p.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
        this.exec({ type: "setBackground", target: c.target, fill: { kind: "picture", value: { media, tile: c.tile, transparency: c.transparency } } }, touched, idMap, order);
        return;
      }
      case "renameLayout": {
        const l = p.layouts.find((x) => x.kind === c.layout)!;
        if (c.layout.startsWith("custom:")) {
          const kind = `custom:${c.name}` as const;
          for (const s of p.slides) if (s.layout === c.layout) {
            s.layout = kind;
            touched.add(s);
          }
          l.kind = kind;
          delete l.name;
        } else l.name = c.name;
        this.design = true;
        return;
      }
      case "addPlaceholder": {
        const list = c.target.kind === "master" ? p.master!.placeholders : p.layouts.find((x) => x.kind === (c.target as { value: string }).value)!.placeholders;
        list.push({ kind: c.kind, idx: Math.max(12, ...list.map((d) => d.idx ?? 0)) + 1, transform: c.transform, bodyDefaults: { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" }, runDefaults: {}, paragraphDefaults: {} });
        this.design = true;
        return;
      }
      case "removePlaceholder": {
        const holder = c.target.kind === "master" ? p.master! : p.layouts.find((x) => x.kind === (c.target as { value: string }).value)!;
        const i = holder.placeholders.findIndex((d) => d.kind === c.placeholder && (c.idx === undefined || d.idx === c.idx));
        holder.placeholders.splice(i, 1);
        this.design = true;
        return;
      }
      case "setMasterTextStyle": {
        const list = p.master!.textStyles[c.which];
        const l = list[c.level] ?? (list[c.level] = clone(list[list.length - 1] ?? {}));
        if (c.run) l.run = { ...(l.run ?? {}), ...c.run };
        if (c.paragraph) l.paragraph = { ...(l.paragraph ?? {}), ...(c.paragraph as object) };
        this.design = true;
        return;
      }
      case "setPlaceholderPrompt": {
        const list = c.target.kind === "master" ? p.master!.placeholders : p.layouts.find((x) => x.kind === (c.target as { value: string }).value)!.placeholders;
        const d = list.find((x) => x.kind === c.placeholder && (c.idx === undefined || x.idx === c.idx))!;
        if (c.prompt === null) delete d.prompt;
        else d.prompt = c.prompt;
        this.design = true;
        return;
      }
      case "setShapesHidden":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (c.hidden) sh.hidden = true;
          else delete sh.hidden;
          touched.add(s);
        }
        return;
      case "setBodyProps":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind !== "auto") throw new Error("no text");
          sh.kind.value.text = sh.kind.value.text ? { ...sh.kind.value.text, props: clone(c.props) } : { props: clone(c.props), paragraphs: [{ runs: [] }] };
          touched.add(s);
        }
        return;
      case "setAltText": {
        const s = this.slideOf(c.shape);
        findShape(s.shapes, c.shape)!.shape.alt = c.alt;
        touched.add(s);
        return;
      }
      case "setShapeStyle":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (c.fill !== undefined) sh.fill = c.fill ?? { kind: "none" };
          if (c.line !== undefined) sh.line = c.line ?? { fill: { kind: "none" }, width: 12700, dash: "solid" };
          touched.add(s);
        }
        return;
      case "setParagraphProps": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "auto" && sh.kind.value.text) {
          for (const i of c.paragraphs) {
            const para = sh.kind.value.text.paragraphs[i];
            if (para) para.props = { ...(para.props ?? {}), ...(c.patch as object) } as typeof para.props;
          }
        }
        touched.add(s);
        return;
      }
      case "setTransition":
        for (const id of c.slides) {
          const s = this.slideOf(id);
          if (c.transition) s.transition = c.transition;
          else delete s.transition;
          touched.add(s);
        }
        return;
      case "applyTransitionToAll": {
        const t = this.slideOf(c.from).transition;
        for (const s of p.slides) {
          if (t) s.transition = clone(t);
          else delete s.transition;
          touched.add(s);
        }
        return;
      }
      case "setAnimationOrder": {
        const s = this.slideOf(c.slide);
        const list = s.animations ?? [];
        if (c.order.length !== list.length || !list.every((a) => c.order.includes(a.id))) throw new Error("not a permutation");
        s.animations = c.order.map((id) => list.find((a) => a.id === id)!);
        touched.add(s);
        return;
      }
      case "setTransitionSound": {
        for (const id of c.slides) {
          const s = this.slideOf(id);
          const t = s.transition ?? { kind: "none" as const, durationMs: 0, advanceOnClick: true };
          if (c.bytesBase64) t.sound = { kind: "play", value: { media: 900 + id, ...(c.loop ? { loop: true } : {}) } };
          else if (c.stopPrevious) t.sound = { kind: "stopPrevious" };
          else delete t.sound;
          s.transition = t;
          touched.add(s);
        }
        return;
      }
      case "addAnimation": {
        const s = this.slideOf(c.slide);
        const list = (s.animations ??= []);
        list.splice(c.index ?? list.length, 0, { ...c.animation, id: this.real(c.newId, idMap) });
        touched.add(s);
        return;
      }
      case "updateAnimation":
      case "removeAnimation":
      case "reorderAnimation": {
        const s = p.slides.find((sl) => sl.animations?.some((a) => a.id === c.id));
        if (!s) throw new Error(`unknown animation ${c.id}`);
        const list = s.animations!;
        const i = list.findIndex((a) => a.id === c.id);
        if (c.type === "updateAnimation") list[i] = applyAnimationPatch(list[i]!, c.patch);
        else {
          const [a] = list.splice(i, 1);
          if (c.type === "reorderAnimation") list.splice(c.index, 0, a!);
        }
        touched.add(s);
        return;
      }
      case "insertTable": {
        const s = this.slideOf(c.slide);
        const t = c.transform ?? { x: 914400, y: 914400, w: 6096000, h: 370840 * c.rows };
        const cell = () => ({ text: { props: { anchor: "top" as const, wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" as const }, paragraphs: [{ runs: [] }] } });
        s.shapes.push({
          id: this.real(c.newId, idMap), name: "Table", transform: t,
          kind: {
            kind: "table",
            value: {
              rows: Array.from({ length: c.rows }, () => ({ height: Math.round(t.h / c.rows) })),
              cols: Array.from({ length: c.cols }, () => ({ width: Math.round(t.w / c.cols) })),
              cells: Array.from({ length: c.rows }, () => Array.from({ length: c.cols }, cell)),
              styleId: "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}",
              look: { firstRow: true, bandRows: true },
            },
          },
          fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
        });
        touched.add(s);
        return;
      }
      case "setTableCellText":
      case "mergeTableCells":
      case "splitTableCell":
      case "setTableStyle":
      case "setTableCellProps":
      case "insertTableRow":
      case "setTableGrid": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind !== "table") throw new Error("not a table");
        const t = sh.kind.value;
        if (c.type === "setTableCellText") t.cells[c.row]![c.col]!.text = c.body;
        else if (c.type === "mergeTableCells") {
          for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) if (r !== c.row || k !== c.col) t.cells[r]![k]!.covered = true;
          Object.assign(t.cells[c.row]![c.col]!, { rowSpan: c.rowSpan, colSpan: c.colSpan });
        } else if (c.type === "splitTableCell") {
          const a = t.cells[c.row]![c.col]!;
          for (let r = c.row; r < c.row + (a.rowSpan ?? 1); r++) for (let k = c.col; k < c.col + (a.colSpan ?? 1); k++) t.cells[r]![k]!.covered = false;
          delete a.rowSpan;
          delete a.colSpan;
        } else if (c.type === "setTableStyle") {
          t.styleId = c.styleId ?? undefined;
          t.look = c.look;
        } else if (c.type === "setTableCellProps") {
          for (let r = c.row; r < c.row + (c.rowSpan ?? 1); r++)
            for (let k = c.col; k < c.col + (c.colSpan ?? 1); k++) {
              const cell = t.cells[r]![k]!;
              if (c.patch.fill !== undefined) cell.fill = c.patch.fill ?? undefined;
              if (c.patch.vert) cell.text = { ...cell.text, props: { ...cell.text.props, vert: c.patch.vert } };
              if (c.patch.anchor) cell.text = { ...cell.text, props: { ...cell.text.props, anchor: c.patch.anchor } };
              if (c.patch.margins) cell.text = { ...cell.text, props: { ...cell.text.props, insets: c.patch.margins } };
              const b = { ...(cell.borders ?? {}) };
              for (const k of ["left", "right", "top", "bottom", "diagDown", "diagUp"] as const) {
                const v = c.patch[k];
                if (v !== undefined) {
                  if (v === null) delete b[k];
                  else b[k] = v;
                }
              }
              cell.borders = b;
            }
        } else if (c.type === "insertTableRow") {
          t.rows.splice(c.index, 0, { ...t.rows[0]! });
          t.cells.splice(c.index, 0, clone(t.cells[0]!).map((x) => ({ text: { ...x.text, paragraphs: [{ runs: [] }] } })));
        } else {
          if (c.colWidths) t.cols = c.colWidths.map((width) => ({ width }));
          if (c.rowHeights) t.rows = c.rowHeights.map((height) => ({ height }));
        }
        touched.add(s);
        return;
      }
      case "setGeometry":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind === "auto") {
            if (c.geometry !== undefined) sh.kind.value.geometry = c.geometry;
            if (c.adjust !== undefined) sh.kind.value.adjust = c.adjust;
          }
          touched.add(s);
        }
        return;
      case "setConnector": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "connector") {
          const v = sh.kind.value as unknown as Record<string, unknown>;
          for (const [k, x] of Object.entries(c.patch)) {
            if (x === null) delete v[k];
            else v[k] = x;
          }
        }
        touched.add(s);
        return;
      }
      default:
        for (const id of "shapes" in c && Array.isArray(c.shapes) ? (c.shapes as unknown[]) : []) {
          if (typeof id === "number") touched.add(this.slideOf(id));
        }
    }
  }

  async dispatch<T>(request: Request) {
    this.log.push(request);
    const ok = (body: unknown) => ({ ok: body as T });
    switch (request.type) {
      case "getPresentation":
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      case "documentState":
        return ok({ type: "documentState", dirty: this.dirty, revision: this.revision, name: this.name });
      case "recoverySnapshot":
        return ok({ type: "recoverySnapshot", json: JSON.stringify(this.pres), revision: this.revision, dirty: this.dirty, name: this.name });
      case "restoreRecovery": {
        try {
          this.pres = JSON.parse(request.json) as Presentation;
        } catch {
          return { err: { code: "invalid_snapshot", message: "not JSON" } };
        }
        this.history = [];
        this.dirty = true;
        this.name = request.name ?? null;
        this.revision++;
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      }
      case "newPresentation":
        this.pres = clone(this.fresh);
        this.history = [];
        this.dirty = false;
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      case "openPptx":
        return ok({ type: "opened", presentation: clone(this.pres), warnings: [], envelope: this.envelope({}) });
      case "savePptx":
        return ok({ type: "saved", bytesBase64: "UEsDBA==", suggestedName: "Presentation.pptx" });
      case "markSaved":
        this.dirty = false;
        if (request.name) this.name = request.name;
        return ok({ type: "documentState", dirty: false, revision: this.revision, name: this.name });
      case "getThemes":
        return ok({ type: "themes", themes: clone(FAKE_THEMES) });
      case "peekPresentation":
        return this.peek ? ok({ type: "peeked", presentation: clone(this.peek), warnings: [] }) : { err: { code: "invalid_file", message: "fake: nothing to peek" } };
      case "shapePaths":
        return ok({ type: "shapePaths", shapes: request.queries.map((q) => fakePaths(q)) });
      case "getMedia": {
        const m = this.pres.media.find((x) => x.id === request.id);
        return m ? ok({ type: "media", contentType: m.contentType, bytesBase64: m.data }) : { err: { code: "unknown_media", message: "?" } };
      }
      case "undo": {
        const prev = this.history.pop();
        if (!prev) return ok({ type: "patch", envelope: this.envelope({}) });
        const deleted = this.pres.slides.filter((s) => !prev.slides.some((x) => x.id === s.id)).map((s) => s.id);
        this.pres = prev;
        this.revision++;
        return ok({ type: "patch", envelope: this.envelope({ slides: clone(prev.slides), deletedSlides: deleted, slidesOrder: prev.slides.map((s) => s.id) }) });
      }
      case "apply": {
        if (this.failWith) return { err: { code: this.failWith, message: `fake ${this.failWith}` } };
        this.history.push(clone(this.pres));
        this.dirty = true;
        const touched = new Set<Slide>();
        const idMap: [number, number][] = [];
        const order = { changed: false };
        this.design = false;
        this.sections = false;
        this.props = false;
        try {
          this.exec(request.command, touched, idMap, order);
        } catch (e) {
          this.pres = this.history.pop()!;
          return { err: { code: "invalid_command", message: String(e) } };
        }
        this.revision++;
        const design = this.design ? { theme: clone(this.pres.theme), master: clone(this.pres.master), layouts: clone(this.pres.layouts) } : {};
        return ok({
          type: "patch",
          envelope: this.envelope({
            slides: clone([...touched].filter((s) => this.pres.slides.includes(s))),
            idMap,
            slidesOrder: order.changed ? this.pres.slides.map((s) => s.id) : null,
            ...design,
            ...(this.sections ? { sections: clone(this.pres.sections ?? []) } : {}),
            ...(this.props ? { ...(this.pres.view ? { view: clone(this.pres.view) } : {}), ...(this.pres.showSettings ? { showSettings: clone(this.pres.showSettings) } : {}), ...(this.pres.customShows ? { customShows: clone(this.pres.customShows) } : {}) } : {}),
          }),
        });
      }
      default:
        return { err: { code: "bad_request", message: `unknown variant \`${(request as { type: string }).type}\`` } };
    }
  }

  async openFile(): Promise<OpenedFile | null> {
    return this.nextOpen;
  }

  async saveFile(name: string, bytesBase64: string) {
    if (this.saveResult) this.saved.push({ name, bytesBase64 });
    return this.saveResult;
  }

  async setTitle() {}
  async print() {}
}
