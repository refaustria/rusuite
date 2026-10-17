// Adjust handles (PowerPoint's yellow diamonds) of the presets. The
// handles come from the core's `shapePaths` (ECMA-376 `a:ahXY` /
// `a:ahPolar` of each preset, P8-32; `core_model::geometry` since P9-X1):
// positions in the shape's own box (EMU, unflipped, unrotated), and per
// axis the adjust value it drives with samples of the coordinate over the
// value's range. The math around them (position for the current values,
// drag inversion, polar handles, keyboard nudging) is shared with Write's
// drawings in ui-shared (`geometry/handles.ts`).

import { effectiveAdjust as withDefaults, handleDefs, type HandleDef } from "@rusuite/ui-shared";
import type { Preset } from "../generated/Preset";
import type { Shape } from "../generated/Shape";
import { adjustDefaults } from "./presets";
import { pathCache, pathQueryOf } from "./paths";

export { axisCoord, axisValue, dragHandle, elbowHandle, handlePos, type HandleDef } from "@rusuite/ui-shared";

/** The adjust handles of an auto shape (empty for other shapes and until its outline is cached). */
export function handlesOf(shape: Shape): HandleDef[] {
  if (shape.kind.kind !== "auto") return [];
  const q = pathQueryOf(shape);
  const p = q ? pathCache.get(q) : null;
  return handleDefs(p?.handles, shape.transform.w, shape.transform.h);
}

/** The adjust values in effect: the defaults overridden by the shape's own. */
export function effectiveAdjust(p: Preset, own: Record<string, number> | undefined): Record<string, number> {
  return withDefaults(adjustDefaults(p), own);
}
