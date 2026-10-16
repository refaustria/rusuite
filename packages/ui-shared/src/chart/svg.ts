// SVG painter of a ChartScene: print views, PDF export and gallery previews.

import { CHART_FONT } from "./draw";
import type { ChartScene, SceneItem } from "./scene";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function strokeAttrs(it: { stroke?: string; lineWidth?: number; dash?: number[] }): string {
  if (!it.stroke) return ' stroke="none"';
  return ` stroke="${it.stroke}" stroke-width="${it.lineWidth ?? 1}"${it.dash?.length ? ` stroke-dasharray="${it.dash.join(" ")}"` : ""}`;
}

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;
const BASELINE = { top: "hanging", middle: "central", bottom: "text-after-edge" } as const;

function itemSvg(it: SceneItem, clipId: (b: NonNullable<SceneItem["clip"]>) => string): string {
  const clip = it.clip ? ` clip-path="url(#${clipId(it.clip)})"` : "";
  switch (it.t) {
    case "rect":
      return `<rect x="${it.x}" y="${it.y}" width="${Math.max(0, it.w)}" height="${Math.max(0, it.h)}" fill="${it.fill ?? "none"}"${strokeAttrs(it)}${clip}/>`;
    case "path":
      return `<path d="${it.d}" fill="${it.fill ?? "none"}" fill-rule="evenodd"${strokeAttrs(it)}${it.join ? ` stroke-linejoin="${it.join}"` : ""}${it.cap ? ` stroke-linecap="${it.cap}"` : ""}${clip}/>`;
    case "text": {
      const tr = it.rotate ? ` transform="rotate(${it.rotate} ${it.x} ${it.y})"` : "";
      return `<text x="${it.x}" y="${it.y}" font-size="${it.size}"${it.bold ? ' font-weight="bold"' : ""} fill="${it.color}" text-anchor="${ANCHOR[it.align]}" dominant-baseline="${BASELINE[it.baseline]}"${tr}>${esc(it.text)}</text>`;
    }
  }
}

let svgSeq = 0;

/** The scene as a standalone `<svg>` element (`width`/`height` override the displayed size; the viewBox stays the scene's). Clip ids get `idPrefix` (default: unique per call). */
export function sceneToSvg(scene: ChartScene, size?: { width: number; height: number }, idPrefix = `rsc${++svgSeq}-`): string {
  const clips = new Map<string, string>();
  const clipId = (b: NonNullable<SceneItem["clip"]>) => {
    const key = `${b.x},${b.y},${b.w},${b.h}`;
    let id = clips.get(key);
    if (!id) clips.set(key, (id = `${idPrefix}${clips.size}`));
    return id;
  };
  const body = scene.items.map((it) => itemSvg(it, clipId)).join("");
  const defs = clips.size
    ? `<defs>${[...clips.entries()].map(([k, id]) => {
        const [x, y, w, h] = k.split(",");
        return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;
      }).join("")}</defs>`
    : "";
  const w = size?.width ?? scene.width;
  const h = size?.height ?? scene.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="${CHART_FONT.replace(/'/g, "")}">${defs}${body}</svg>`;
}
