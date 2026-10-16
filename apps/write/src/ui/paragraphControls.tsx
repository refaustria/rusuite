// Home › Paragraph: Borders ▾ (paragraph borders, Word's menu) and
// Shading ▾ (paragraph fill). Rust-first `SetParagraphProps`.

import type { Editor } from "@tiptap/react";
import { ColorPicker, Icon, RibbonMenuButton } from "@rusuite/ui-shared";
import { paragraphBordersCommand, paragraphShadingCommand, selectedParagraphs, type ParaBorderPreset } from "../features/paragraphFormat";
import type { WriteFeatures } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";
import { t } from "../i18n";

const PRESETS: { id: ParaBorderPreset; key: string; icon: Parameters<typeof Icon>[0]["name"]; state?: "top" | "bottom" | "left" | "right" | "between" }[] = [
  { id: "bottom", key: "fmt.border.bottom", icon: "borderBottom", state: "bottom" },
  { id: "top", key: "fmt.border.top", icon: "borderTop", state: "top" },
  { id: "left", key: "fmt.border.left", icon: "borderLeft", state: "left" },
  { id: "right", key: "fmt.border.right", icon: "borderRight", state: "right" },
  { id: "none", key: "fmt.border.none", icon: "borderNone" },
  { id: "all", key: "fmt.border.all", icon: "borderAll" },
  { id: "outside", key: "fmt.border.outline", icon: "borderOutline" },
  { id: "inside", key: "write.border.inside", icon: "borders", state: "between" },
];

export function paragraphBordersMenu(editor: Editor, ctl: SyncController, features: WriteFeatures, state: Record<"top" | "bottom" | "left" | "right" | "between", boolean>) {
  const apply = (preset: ParaBorderPreset) => () => {
    const cmd = paragraphBordersCommand(selectedParagraphs(editor.state), preset);
    if (cmd) void ctl.run(cmd).then(() => editor.commands.focus());
  };
  return (
    <RibbonMenuButton
      label={t("write.paragraphBorders")}
      icon={<Icon name="borders" />}
      menu={[
        ...PRESETS.map((p) => ({ id: p.id, label: t(p.key), icon: <Icon name={p.icon} />, checked: p.state ? state[p.state] : undefined, onSelect: apply(p.id) })),
        { separator: true as const },
        { id: "dialog", label: t("write.bordersShadingDots"), onSelect: () => features.ui.openDialog("bordersShading") },
      ]}
    />
  );
}

export function paragraphShadingPicker(editor: Editor, ctl: SyncController) {
  return (
    <ColorPicker
      label={t("write.paragraphShading")}
      kind="fill"
      onSelect={(c) => {
        const cmd = paragraphShadingCommand(selectedParagraphs(editor.state), c && c.kind !== "auto" ? c : null);
        if (cmd) void ctl.run(cmd).then(() => editor.commands.focus());
      }}
    />
  );
}
