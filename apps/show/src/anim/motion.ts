// Motion paths in the UI (P9-S4), the mirror of
// `crates/model-show/src/motion.rs`: the path language of `p:animMotion`
// (`M`/`L`/`C`/`Z`/`E`, coordinates as fractions of the slide relative to
// the shape's resting position), the point at a moment of the motion, the
// editable vertices (Edit Points), Reverse Path Direction and the Custom
// Path drawn with the mouse.

export type PathCmd =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: "Z" };

/** Parses a motion path (absolute and relative commands, exponents, implicit repeats; `E` ends it). `null` = invalid. */
export function parsePath(s: string): PathCmd[] | null {
  const TOKEN = /[MmLlCcZz]|[Ee](?![0-9+-])|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const toks = s.match(TOKEN);
  if (!toks) return null;
  // anything else than separators between the tokens is an error
  if (s.replace(TOKEN, "").replace(/[\s,]+/g, "") !== "") return null;
  const out: PathCmd[] = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let k = 0;
  let last: string | null = null;
  const num = () => {
    const t = toks[k];
    if (t === undefined || /^[A-Za-z]$/.test(t)) return null;
    k++;
    return Number(t);
  };
  while (k < toks.length) {
    let cmd: string;
    if (/^[A-Za-z]$/.test(toks[k]!)) cmd = toks[k++]!;
    else if (last && !/[Zz]/.test(last)) cmd = last === "M" ? "L" : last === "m" ? "l" : last;
    else return null;
    if (cmd === "E" || cmd === "e") break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cur.x : 0;
    const oy = rel ? cur.y : 0;
    const up = cmd.toUpperCase();
    if (out.length === 0 && up !== "M") return null;
    if (up === "M" || up === "L") {
      const x = num();
      const y = num();
      if (x === null || y === null) return null;
      cur = { x: ox + x, y: oy + y };
      if (up === "M") start = cur;
      out.push({ c: up, x: cur.x, y: cur.y });
    } else if (up === "C") {
      const v = [num(), num(), num(), num(), num(), num()];
      if (v.some((n) => n === null)) return null;
      const [x1, y1, x2, y2, x, y] = v as number[];
      out.push({ c: "C", x1: ox + x1!, y1: oy + y1!, x2: ox + x2!, y2: oy + y2!, x: ox + x!, y: oy + y! });
      cur = { x: ox + x!, y: oy + y! };
    } else if (up === "Z") {
      out.push({ c: "Z" });
      cur = start;
    } else return null;
    last = cmd;
  }
  return out.length ? out : null;
}

/** A number as PowerPoint writes it in paths (≤ 5 decimals). */
const fmt = (v: number) => {
  const r = Math.round(v * 100000) / 100000;
  return Object.is(r, -0) || r === 0 ? "0" : String(r);
};

/** Writes commands as a path string ending in ` E` (`motion::format_path`). */
export function formatPath(cmds: readonly PathCmd[]): string {
  const parts = cmds.map((c) => {
    switch (c.c) {
      case "M":
      case "L":
        return `${c.c} ${fmt(c.x)} ${fmt(c.y)}`;
      case "C":
        return `C ${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`;
      case "Z":
        return "Z";
    }
  });
  return `${parts.join(" ")} E`;
}

/** Flattens a path into points (Béziers sampled), each with its subpath start. */
function flatten(cmds: readonly PathCmd[], steps = 16): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let cur = { x: 0, y: 0 };
  let start = cur;
  for (const c of cmds) {
    if (c.c === "M") {
      cur = { x: c.x, y: c.y };
      start = cur;
      pts.push(cur);
    } else if (c.c === "L") {
      cur = { x: c.x, y: c.y };
      pts.push(cur);
    } else if (c.c === "C") {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        pts.push({
          x: u * u * u * cur.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          y: u * u * u * cur.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        });
      }
      cur = { x: c.x, y: c.y };
    } else {
      cur = start;
      pts.push(cur);
    }
  }
  return pts;
}

/** The point at progress `p` (0…1) along the path, by arc length (slide fractions). */
export function pointAt(cmds: readonly PathCmd[], p: number): { x: number; y: number } {
  const pts = flatten(cmds);
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    seg.push(d);
    total += d;
  }
  if (total === 0) return pts[0]!;
  let want = Math.max(0, Math.min(1, p)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]! || i === seg.length - 1) {
      const t = seg[i]! > 0 ? Math.min(1, want / seg[i]!) : 1;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    want -= seg[i]!;
  }
  return pts[pts.length - 1]!;
}

/** Where the shape rests after the path (its end; the start for a closed path). */
export const pathEnd = (cmds: readonly PathCmd[]): { x: number; y: number } => pointAt(cmds, 1);

/** The vertices (Edit Points): every command's end point, by command index. */
export function vertices(cmds: readonly PathCmd[]): { index: number; x: number; y: number }[] {
  return cmds.flatMap((c, index) => (c.c === "Z" ? [] : [{ index, x: c.x, y: c.y }]));
}

/** Moves vertex `index` by `(dx, dy)` (slide fractions); the Bézier handles next to it move along. */
export function moveVertex(cmds: readonly PathCmd[], index: number, dx: number, dy: number): PathCmd[] {
  return cmds.map((c, i) => {
    if (c.c === "Z") return c;
    if (i === index) {
      if (c.c === "C") return { ...c, x: c.x + dx, y: c.y + dy, x2: c.x2 + dx, y2: c.y2 + dy };
      return { ...c, x: c.x + dx, y: c.y + dy };
    }
    if (i === index + 1 && c.c === "C") return { ...c, x1: c.x1 + dx, y1: c.y1 + dy };
    return c;
  });
}

/** Reverse Path Direction: the same path from its end to its start, still starting at the shape (`M 0 0`). */
export function reversePath(cmds: readonly PathCmd[]): PathCmd[] {
  const open = cmds.filter((c) => c.c !== "Z");
  if (!open.length) return [...cmds];
  const end = open[open.length - 1]! as { x: number; y: number };
  const out: PathCmd[] = [{ c: "M", x: 0, y: 0 }];
  for (let i = open.length - 1; i > 0; i--) {
    const c = open[i]!;
    const prev = open[i - 1]! as { x: number; y: number };
    const to = { x: prev.x - end.x, y: prev.y - end.y };
    if (c.c === "C") out.push({ c: "C", x1: c.x2 - end.x, y1: c.y2 - end.y, x2: c.x1 - end.x, y2: c.y1 - end.y, ...to });
    else out.push({ c: "L", ...to });
  }
  return out;
}

/**
 * A Custom Path from points drawn with the mouse (slide px, the first one
 * where the drag started): relative to the first point, in slide
 * fractions, thinned to points at least `minPx` apart.
 */
export function drawnPath(points: readonly { x: number; y: number }[], slide: { width: number; height: number }, minPx = 4): string | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const kept = [first];
  for (const p of points.slice(1)) {
    const l = kept[kept.length - 1]!;
    if (Math.hypot(p.x - l.x, p.y - l.y) >= minPx) kept.push(p);
  }
  const lastPoint = points[points.length - 1]!;
  if (kept[kept.length - 1] !== lastPoint && Math.hypot(lastPoint.x - first.x, lastPoint.y - first.y) > 0) kept.push(lastPoint);
  if (kept.length < 2) return null;
  const cmds: PathCmd[] = kept.map((p, i) => ({ c: i === 0 ? "M" : "L", x: (p.x - first.x) / slide.width, y: (p.y - first.y) / slide.height }) as PathCmd);
  return formatPath(cmds);
}

/** SVG path data of a motion path drawn from `(ox, oy)` on a slide of `w × h` px (the stage's path line). */
export function svgOfPath(cmds: readonly PathCmd[], ox: number, oy: number, w: number, h: number): string {
  const X = (v: number) => ox + v * w;
  const Y = (v: number) => oy + v * h;
  return cmds
    .map((c) => {
      switch (c.c) {
        case "M":
        case "L":
          return `${c.c}${X(c.x)} ${Y(c.y)}`;
        case "C":
          return `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
        case "Z":
          return "Z";
      }
    })
    .join(" ");
}
