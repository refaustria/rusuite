// SVG painter of a ChartScene: print views, PDF export and gallery previews.

import { CHART_FONT } from "./draw";
import type { ChartScene, SceneGradient, SceneItem } from "./scene";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function strokeAttrs(it: { stroke?: string; lineWidth?: number; dash?: number[] }): string {
  if (!it.stroke) return ' stroke="none"';
  return ` stroke="${it.stroke}" stroke-width="${it.lineWidth ?? 1}"${it.dash?.length ? ` stroke-dasharray="${it.dash.join(" ")}"` : ""}`;
}

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;
const BASELINE = { top: "hanging", middle: "central", bottom: "text-after-edge" } as const;

interface Defs {
  clipId: (b: NonNullable<SceneItem["clip"]>) => string;
  gradientId: (g: SceneGradient) => string;
  shadowId: () => string;
}

function itemSvg(it: SceneItem, defs: Defs): string {
  const clip = it.clip ? ` clip-path="url(#${defs.clipId(it.clip)})"` : "";
  switch (it.t) {
    case "rect": {
      const fill = it.gradient ? `url(#${defs.gradientId(it.gradient)})` : (it.fill ?? (it.shadow ? "#FFFFFF" : "none"));
      const r = it.radius ? ` rx="${it.radius}" ry="${it.radius}"` : "";
      const shadow = it.shadow ? ` filter="url(#${defs.shadowId()})"` : "";
      const geo = `x="${it.x}" y="${it.y}" width="${Math.max(0, it.w)}" height="${Math.max(0, it.h)}"`;
      const image = it.image ? `<image ${geo} href="${esc(it.image)}" preserveAspectRatio="none"${clip}/>` : "";
      if (!image) return `<rect ${geo}${r} fill="${fill}"${strokeAttrs(it)}${shadow}${clip}/>`;
      return `<rect ${geo}${r} fill="${fill}" stroke="none"${shadow}${clip}/>${image}<rect ${geo}${r} fill="none"${strokeAttrs(it)}${clip}/>`;
    }
    case "path": {
      const fill = it.gradient ? `url(#${defs.gradientId(it.gradient)})` : (it.fill ?? "none");
      return `<path d="${it.d}" fill="${fill}" fill-rule="evenodd"${strokeAttrs(it)}${it.join ? ` stroke-linejoin="${it.join}"` : ""}${it.cap ? ` stroke-linecap="${it.cap}"` : ""}${clip}/>`;
    }
    case "text": {
      const tr = it.rotate ? ` transform="rotate(${it.rotate} ${it.x} ${it.y})"` : "";
      const font = it.font ? ` font-family="${esc(it.font)}, ${CHART_FONT.replace(/'/g, "")}"` : "";
      return `<text x="${it.x}" y="${it.y}" font-size="${it.size}"${font}${it.bold ? ' font-weight="bold"' : ""}${it.italic ? ' font-style="italic"' : ""} fill="${it.color}" text-anchor="${ANCHOR[it.align]}" dominant-baseline="${BASELINE[it.baseline]}"${tr}>${esc(it.text)}</text>`;
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
  const gradients: string[] = [];
  const gradientId = (g: SceneGradient) => {
    const id = `${idPrefix}g${gradients.length}`;
    const stops = g.stops.map((st) => `<stop offset="${Math.min(1, Math.max(0, st.pos))}" stop-color="${st.color}"/>`).join("");
    gradients.push(
      g.radial
        ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${g.x0}" cy="${g.y0}" r="${g.r ?? 1}">${stops}</radialGradient>`
        : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}">${stops}</linearGradient>`,
    );
    return id;
  };
  let shadow = "";
  const shadowId = () => {
    if (!shadow) shadow = `${idPrefix}shadow`;
    return shadow;
  };
  const body = scene.items.map((it) => itemSvg(it, { clipId, gradientId, shadowId })).join("");
  const clipDefs = [...clips.entries()].map(([k, id]) => {
    const [x, y, w, h] = k.split(",");
    return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;
  });
  const shadowDef = shadow ? [`<filter id="${shadow}" x="-5%" y="-5%" width="115%" height="115%"><feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.4"/></filter>`] : [];
  const all = [...clipDefs, ...gradients, ...shadowDef];
  const defs = all.length ? `<defs>${all.join("")}</defs>` : "";
  const w = size?.width ?? scene.width;
  const h = size?.height ?? scene.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="${CHART_FONT.replace(/'/g, "")}">${defs}${body}</svg>`;
}
