// Pictures in sheets (P8-35): Insert › Pictures (from a file), the images
// drawn over the cells like charts, selection, move / resize with the
// chart handles (charts/anchor.ts) and Delete. The list of each sheet
// comes from `sheetPictures`; a patch's `pictureSheets` refetches it.

import type { ChartAnchor } from "../generated/ChartAnchor";
import type { Picture } from "../generated/Picture";
import type { AxisGeometry } from "../grid/geometry";
import { normalize } from "../grid/Selection";
import { anchorRect, handlePoints, rectToAnchor, EMU_PER_PX, type PxRect } from "../charts/anchor";
import type { CalcStore } from "../state/store";
import { t } from "../i18n";

/** Largest picture size on insert (px); larger images are scaled down. */
export const MAX_INSERT_PX = 640;

/** The image types Insert › Pictures accepts. */
export const PICTURE_ACCEPT = "image/png,image/jpeg,image/gif,image/bmp,image/svg+xml,image/webp";

export interface PictureFrame {
  pic: Picture;
  rect: PxRect;
}

/** A one-cell anchor at `(row, col)` of `w × h` px (pictures move but do not size with cells, as Excel inserts them). */
export function insertAnchor(row: number, col: number, w: number, h: number): ChartAnchor {
  return {
    type: "oneCell",
    from: { col, row, colOffset: 0, rowOffset: 0 },
    width: Math.round(w * EMU_PER_PX),
    height: Math.round(h * EMU_PER_PX),
  };
}

/** Scales `w × h` to fit `max` (keeping the aspect ratio). */
export function fitSize(w: number, h: number, max = MAX_INSERT_PX): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export class PictureController {
  private lists = new Map<number, Picture[]>();
  private fetching = new Map<number, Promise<void>>();
  private images = new Map<string, HTMLImageElement>();
  selected: { sheet: number; id: number } | null = null;
  /** The rectangle of a picture being moved / resized. */
  preview: { id: number; rect: PxRect } | null = null;

  constructor(private readonly store: CalcStore) {}

  reset(): void {
    this.lists.clear();
    this.fetching.clear();
    this.selected = null;
    this.preview = null;
  }

  /** A patch's `pictureSheets`. */
  invalidate(sheets: readonly number[]): void {
    for (const s of sheets) {
      this.lists.delete(s);
      this.fetching.delete(s);
    }
    if (this.selected && sheets.includes(this.selected.sheet)) {
      const sel = this.selected;
      void this.ensure(sel.sheet).then((list) => {
        if (!list.some((p) => p.id === sel.id)) this.selected = null;
      });
    }
    this.store.notify();
  }

  dropSheet(sheet: number): void {
    this.lists.delete(sheet);
  }

  /** The pictures of `sheet` (fetched when unknown). */
  ensure(sheet: number): Promise<Picture[]> {
    const known = this.lists.get(sheet);
    if (known) return Promise.resolve(known);
    let p = this.fetching.get(sheet);
    if (!p) {
      p = this.store.api.sheetPictures(sheet).then(
        (list) => {
          this.lists.set(sheet, list);
          this.fetching.delete(sheet);
          this.store.notify();
        },
        () => {
          this.fetching.delete(sheet);
        },
      );
      this.fetching.set(sheet, p);
    }
    return p.then(() => this.lists.get(sheet) ?? []);
  }

  of(sheet: number): Picture[] {
    const list = this.lists.get(sheet);
    if (!list) void this.ensure(sheet);
    return list ?? [];
  }

  /** The decoded image of a picture (loading: `null`, redraws when ready). */
  image(p: Picture): HTMLImageElement | null {
    const key = `${p.media.contentType}:${p.media.data.length}:${p.media.data.slice(0, 64)}:${p.media.data.slice(-64)}`;
    let img = this.images.get(key);
    if (!img && typeof Image !== "undefined") {
      img = new Image();
      img.onload = () => this.store.notify();
      img.src = `data:${p.media.contentType};base64,${p.media.data}`;
      this.images.set(key, img);
    }
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  frames(sheet: number): PictureFrame[] {
    const geo = this.store.geometry(sheet);
    return this.of(sheet).map((pic) => ({
      pic,
      rect: this.preview && this.preview.id === pic.id && this.selected?.sheet === sheet ? this.preview.rect : anchorRect(pic.anchor, geo.col, geo.row),
    }));
  }

  /** The topmost picture at a sheet point. */
  frameAt(sheet: number, x: number, y: number): PictureFrame | null {
    const frames = this.frames(sheet);
    for (let i = frames.length - 1; i >= 0; i--) {
      const r = frames[i]!.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return frames[i]!;
    }
    return null;
  }

  select(sheet: number, id: number): void {
    this.selected = { sheet, id };
    this.store.charts.deselect();
    this.store.notify();
  }

  deselect(): void {
    if (!this.selected) return;
    this.selected = null;
    this.preview = null;
    this.store.notify();
  }

  get(sheet: number, id: number): Picture | undefined {
    return this.of(sheet).find((p) => p.id === id);
  }

  setRect(rect: PxRect): Promise<void> {
    const s = this.selected;
    const pic = s && this.get(s.sheet, s.id);
    if (!s || !pic) return Promise.resolve();
    const geo = this.store.geometry(s.sheet);
    return this.store.apply({ type: "setPictureAnchor", sheet: s.sheet, id: s.id, anchor: rectToAnchor(rect, pic.anchor.type, geo.col, geo.row) });
  }

  remove(): Promise<void> {
    const s = this.selected;
    if (!s) return Promise.resolve();
    this.selected = null;
    return this.store.apply({ type: "removePicture", sheet: s.sheet, id: s.id });
  }

  /** Insert › Pictures: the file's image at the active cell (scaled to fit 640 px). */
  async insert(file: { name: string; type: string; dataBase64: string; width: number; height: number }): Promise<void> {
    if (!PICTURE_ACCEPT.split(",").includes(file.type)) {
      this.store.pushError(new Error(t("calc.picture.unsupported")));
      return;
    }
    const sheet = this.store.getState().activeSheet;
    const at = normalize(this.store.getState().selection);
    const size = fitSize(file.width, file.height);
    const before = new Set((await this.ensure(sheet)).map((p) => p.id));
    await this.store.apply({
      type: "addPicture",
      sheet,
      picture: { id: 0, name: "", descr: file.name, anchor: insertAnchor(at.r0, at.c0, size.w, size.h), media: { contentType: file.type, data: file.dataBase64 } },
    });
    const list = await this.ensure(sheet);
    const added = list.find((p) => !before.has(p.id));
    if (added) this.select(sheet, added.id);
  }
}

/** Paints the pictures (and the selection's handles) of a viewport. */
export function paintPictures(
  ctx: CanvasRenderingContext2D, frames: readonly PictureFrame[], vp: { scrollX: number; scrollY: number }, image: (p: Picture) => HTMLImageElement | null,
  selected: number | null,
): void {
  for (const f of frames) {
    const x = f.rect.x - vp.scrollX, y = f.rect.y - vp.scrollY;
    const img = image(f.pic);
    if (img) ctx.drawImage(img, x, y, f.rect.w, f.rect.h);
    else {
      ctx.fillStyle = "#f3f3f3";
      ctx.fillRect(x, y, f.rect.w, f.rect.h);
    }
    if (f.pic.id !== selected) continue;
    ctx.strokeStyle = "#7f7f7f";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, f.rect.w, f.rect.h);
    for (const h of handlePoints({ ...f.rect, x, y })) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Reads an image file for `insert` (data URL → base64, natural size). */
export function readImageFile(file: File): Promise<{ name: string; type: string; dataBase64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("cannot read file"));
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ name: file.name, type: file.type, dataBase64: url.slice(url.indexOf(",") + 1), width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(t("calc.picture.unsupported")));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

/** The axis geometry type re-exported for the grid. */
export type { AxisGeometry };
