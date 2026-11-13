// The Draw ribbon tab: text/lasso/eraser tools, pen and highlighter (3 widths × palette), the selection's commands
// (delete, recolour, z-order) and the page's Free canvas toggle. Ink needs a canvas page (PM decision), so the
// drawing tools are off on flowing pages.

import { RibbonButton, RibbonMenuButton, RibbonStack, type RibbonMenuItem, type RibbonTab } from "@rusuite/ui-shared";
import type { Editor } from "@tiptap/core";
import type { NotesController } from "../controller";
import { useT } from "../i18n";
import { useNotes } from "../ui/hooks";
import { deleteItems, enterCanvas, leaveCanvas, recolor, type CanvasCtx } from "./actions";
import { canvasStepsFor, useCanvasMode } from "./hooks";
import { DrawIcon, Swatch } from "./icons";
import { reorderItems } from "./model";
import { clearSelection, HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS, setTools, useTools, type Tool } from "./tools";

const COLOR_KEYS: Record<string, string> = {
  "#000000": "black",
  "#7719AA": "purple",
  "#2B579A": "blue",
  "#217346": "green",
  "#C2410C": "orange",
  "#E81123": "red",
  "#0078D4": "lightBlue",
  "#808080": "gray",
  "#FFEB3B": "yellow",
  "#76FF03": "lime",
  "#18FFFF": "cyan",
  "#FF4081": "pink",
  "#FFAB40": "orange",
};

export function useDrawTab(ctl: NotesController, editor: Editor | null): RibbonTab {
  const t = useT();
  const mirror = useNotes(ctl, (s) => s.mirror);
  const canvas = useCanvasMode(mirror);
  const tools = useTools((s) => s);
  const ready = !!editor && !editor.isDestroyed && !!mirror;
  const ctx = (): CanvasCtx | null => (ready ? { view: editor!.view, doc: mirror!.doc, steps: canvasStepsFor(mirror!) } : null);
  const off = !ready || !canvas;
  const hasSel = canvas && (tools.items.size > 0 || tools.strokes.size > 0);
  const need = off ? t("notes.canvas.needsCanvas") : undefined;
  const pick = (tool: Tool) => () => {
    if (tool !== "lasso" && tool !== "select") clearSelection();
    setTools({ tool });
  };
  const colorName = (c: string) => t(`notes.color.${COLOR_KEYS[c] ?? "black"}`);
  const widthName = (i: number) => t(["notes.ink.fine", "notes.ink.medium", "notes.ink.thick"][i]!);

  const penMenu: RibbonMenuItem[] = [
    ...PEN_COLORS.map((c) => ({ id: c, label: colorName(c), icon: <Swatch color={c} />, checked: tools.penColor === c, onSelect: () => setTools({ penColor: c, tool: "pen" }) })),
    { separator: true as const, label: t("notes.ink.width") },
    ...PEN_WIDTHS.map((w, i) => ({ id: `w${w}`, label: widthName(i), checked: tools.penWidth === w, onSelect: () => setTools({ penWidth: w, tool: "pen" }) })),
  ];
  const hlMenu: RibbonMenuItem[] = [
    ...HIGHLIGHTER_COLORS.map((c) => ({ id: c, label: colorName(c), icon: <Swatch color={c} />, checked: tools.hlColor === c, onSelect: () => setTools({ hlColor: c, tool: "highlighter" }) })),
    { separator: true as const, label: t("notes.ink.width") },
    ...HIGHLIGHTER_WIDTHS.map((w, i) => ({ id: `w${w}`, label: widthName(i), checked: tools.hlWidth === w, onSelect: () => setTools({ hlWidth: w, tool: "highlighter" }) })),
  ];
  const recolorMenu: RibbonMenuItem[] = PEN_COLORS.map((c) => ({
    id: c,
    label: colorName(c),
    icon: <Swatch color={c} />,
    onSelect: () => {
      const c2 = ctx();
      if (c2) recolor(c2, tools.items, tools.strokes, c);
    },
  }));

  return {
    id: "draw",
    label: t("notes.tab.draw"),
    groups: [
      {
        label: t("notes.draw.tools"),
        items: (
          <>
            <RibbonButton size="large" label={t("notes.draw.type")} icon={<DrawIcon name="type" size={22} />} pressed={tools.tool === "select"} disabled={!ready} onClick={pick("select")} />
            <RibbonButton
              size="large"
              label={t("notes.draw.lasso")}
              icon={<DrawIcon name="lasso" size={22} />}
              tooltip={need ?? t("notes.draw.lasso.tip")}
              pressed={!off && tools.tool === "lasso"}
              disabled={off}
              onClick={pick("lasso")}
            />
            <RibbonButton
              size="large"
              label={t("notes.draw.eraser")}
              icon={<DrawIcon name="eraser" size={22} />}
              tooltip={need ?? t("notes.draw.eraser.tip")}
              pressed={!off && tools.tool === "eraser"}
              disabled={off}
              onClick={pick("eraser")}
            />
          </>
        ),
      },
      {
        label: t("notes.draw.pens"),
        items: (
          <>
            <RibbonButton
              size="large"
              label={t("notes.draw.pen")}
              icon={<DrawIcon name="pen" size={22} color={tools.penColor} />}
              tooltip={need}
              pressed={!off && tools.tool === "pen"}
              disabled={off}
              onClick={pick("pen")}
            />
            <RibbonButton
              size="large"
              label={t("notes.draw.highlighter")}
              icon={<DrawIcon name="highlighter" size={22} color={tools.hlColor} />}
              tooltip={need}
              pressed={!off && tools.tool === "highlighter"}
              disabled={off}
              onClick={pick("highlighter")}
            />
            <RibbonStack>
              <RibbonMenuButton label={t("notes.draw.penOptions")} icon={<DrawIcon name="color" color={tools.penColor} />} showLabel disabled={off} menu={penMenu} />
              <RibbonMenuButton label={t("notes.draw.highlighterOptions")} icon={<DrawIcon name="color" color={tools.hlColor} />} showLabel disabled={off} menu={hlMenu} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("notes.draw.selection"),
        collapsePriority: 1,
        items: (
          <>
            <RibbonMenuButton size="large" label={t("notes.draw.recolor")} icon={<DrawIcon name="color" size={22} />} disabled={!hasSel} menu={recolorMenu} />
            <RibbonStack>
              <RibbonButton
                label={t("notes.draw.front")}
                icon={<DrawIcon name="front" />}
                showLabel
                disabled={!hasSel || tools.items.size === 0}
                onClick={() => {
                  const c = ctx();
                  if (c) c.steps.step(() => reorderItems(c.doc, tools.items, "front"));
                }}
              />
              <RibbonButton
                label={t("notes.draw.back")}
                icon={<DrawIcon name="back" />}
                showLabel
                disabled={!hasSel || tools.items.size === 0}
                onClick={() => {
                  const c = ctx();
                  if (c) c.steps.step(() => reorderItems(c.doc, tools.items, "back"));
                }}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("notes.draw.edit"),
        collapsePriority: 1,
        items: (
          <RibbonButton
            size="large"
            label={t("cmd.delete")}
            icon="trash"
            shortcut="Delete"
            disabled={!hasSel}
            onClick={() => {
              const c = ctx();
              if (c) deleteItems(c, tools.items, tools.strokes);
              clearSelection();
            }}
          />
        ),
      },
      {
        label: t("notes.draw.page"),
        items: (
          <>
            <RibbonButton
              size="large"
              label={t("notes.canvas.toggle")}
              icon={<DrawIcon name="canvas" size={22} />}
              tooltip={t("notes.canvas.toggle.tip")}
              pressed={canvas}
              disabled={!ready}
              onClick={() => {
                const c = ctx();
                if (!c) return;
                clearSelection();
                if (canvas) {
                  setTools({ tool: "select" });
                  leaveCanvas(c);
                } else enterCanvas(c);
              }}
            />
          </>
        ),
      },
    ],
  };
}
