// The shape library galleries (P8-16): Insert › Shapes (grouped like
// PowerPoint, with Recently Used), the compact one of Home › Drawing and
// Shape Format › Edit Shape › Change Shape. Icons are drawn from the same
// outlines as the slide (`shapePaths`); connectors get line icons.
// A mouse click arms drawing on the slide; Enter / Space (a click without
// pointer, `detail` 0) inserts at the default size right away.

import { useRef, type ReactNode } from "react";
import { RibbonGallery, RibbonIcon, type RibbonGalleryItem } from "@rusuite/ui-shared";
import type { PathQuery } from "../generated/PathQuery";
import { pathCache, svgPath, usePathVersion } from "../shapes/paths";
import { choiceLabelKey, choiceOf, SHAPE_GROUPS, type ShapeGroupId } from "../shapes/presets";
import { useT } from "../i18n";

const ICON_PX = 18;
const ICON_EMU = ICON_PX * 9525;

/** Line icons of the connector items. */
const CONNECTOR_ICONS: Record<string, ReactNode> = {
  line: <path d="M2 16L16 2" />,
  lineArrow: <><path d="M2 16L14 4" /><path d="M9 3.5h5.5V9" /></>,
  lineDoubleArrow: <><path d="M4 14L14 4" /><path d="M9 3.5h5.5V9M9 14.5H3.5V9" /></>,
  elbow: <path d="M2 4h7v10h7" />,
  elbowArrow: <><path d="M2 4h7v10h6" /><path d="M12.5 11.5L15.5 14l-3 2.5" /></>,
  curved: <path d="M2 4c9 0 5 10 14 10" />,
  curvedArrow: <><path d="M2 4c9 0 5 10 13 10" /><path d="M12.5 11.5L15.5 14l-3 2.5" /></>,
};

/** The icon of a gallery id: the preset's outline from the core (a box until it arrives). */
export function ShapeIcon({ id }: { id: string }) {
  usePathVersion();
  const choice = choiceOf(id);
  let body: ReactNode;
  if (!choice) body = null;
  else if (choice.kind === "connector") body = CONNECTOR_ICONS[id];
  else if (choice.kind === "textBox") return <RibbonIcon name="textBox" size={ICON_PX} />;
  else {
    const q: PathQuery = { kind: { kind: "preset", value: choice.preset }, w: ICON_EMU, h: ICON_EMU };
    const paths = pathCache.get(q);
    body = paths ? (
      paths.paths.map((p, i) => <path key={i} d={svgPath(p.commands)} fill={p.fill ? "currentColor" : "none"} fillOpacity={0.12} />)
    ) : (
      <rect x="1" y="1" width={ICON_PX - 2} height={ICON_PX - 2} fill="none" />
    );
  }
  return (
    <svg aria-hidden="true" width={ICON_PX + 2} height={ICON_PX + 2} viewBox={`-1 -1 ${ICON_PX + 2} ${ICON_PX + 2}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" data-shape-icon={id}>
      {body}
    </svg>
  );
}

/** Gallery items of ids. */
export function shapeItems(ids: readonly string[], t: (k: string) => string): RibbonGalleryItem[] {
  return ids.map((id) => ({ id, label: t(choiceLabelKey(id)), preview: <ShapeIcon id={id} /> }));
}

export interface ShapeLibraryProps {
  /** Recently used ids (shown first when not empty). */
  recent?: readonly string[];
  /** Leave out the lines / connectors and the text box (Change Shape). */
  presetsOnly?: boolean;
  /** `keyboard`: chosen without a pointer (Enter / Space). */
  onPick: (id: string, keyboard: boolean) => void;
  autoFocus?: boolean;
}

/** The grouped library (a panel of galleries, one per group). */
export function ShapeLibrary({ recent = [], presetsOnly, onPick, autoFocus }: ShapeLibraryProps) {
  const t = useT();
  const keyboard = useRef(false);
  const groups: { id: ShapeGroupId; items: string[] }[] = [
    ...(recent.length && !presetsOnly ? [{ id: "recent" as const, items: [...recent] }] : []),
    ...SHAPE_GROUPS.filter((g) => !presetsOnly || g.id !== "lines").map((g) => ({ id: g.id, items: presetsOnly ? g.items.filter((i) => i !== "textBox") : g.items })),
  ];
  return (
    <div
      className="flex max-h-[70vh] w-max flex-col gap-1 overflow-y-auto"
      data-testid="shape-library"
      onClickCapture={(e) => {
        keyboard.current = e.detail === 0;
      }}
    >
      {groups.map((g, n) => (
        <section key={g.id} className="flex flex-col gap-0.5">
          <h3 className="px-1 text-[11px] font-medium text-ui-muted">{t(`show.shapeGroup.${g.id}`)}</h3>
          <RibbonGallery
            label={t(`show.shapeGroup.${g.id}`)}
            items={shapeItems(g.items, t)}
            columns={10}
            hideLabels
            itemClassName="h-8 w-8"
            autoFocus={autoFocus && n === 0}
            onSelect={(id) => onPick(id, keyboard.current)}
          />
        </section>
      ))}
    </div>
  );
}

/** Items of the compact gallery in Home › Drawing. */
export const QUICK_SHAPES = ["textBox", "line", "lineArrow", "rect", "roundRect", "ellipse", "triangle", "rightArrow", "elbowArrow", "star5", "wedgeRectCallout", "flowChartProcess"];
