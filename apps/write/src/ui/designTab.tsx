// Word's Design tab: Document Formatting (the Style Sets gallery, Reset to
// the Default Style Set, Save as a New Style Set…), Paragraph Spacing and
// Set as Default. The sets come from the core (`styleSets`), the user's own
// from this device (features/styleSets.ts).

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PromptDialog, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonGalleryItem, type RibbonTab } from "@rusuite/ui-shared";
import type { StyleSet } from "../generated/StyleSet";
import type { StyleSheet } from "../generated/StyleSheet";
import { colorCss } from "../sync/schema";
import { previewStyle, resolveParagraph } from "../features/styleCss";
import {
  applyStyleSetCommand, currentParagraphSpacing, currentSetId, loadCustomSets, loadDefaultSet, PARAGRAPH_SPACING, paragraphSpacingCommand,
  saveCustomSet, saveDefaultSet, withStyleSet, type ParagraphSpacingId,
} from "../features/styleSets";
import type { SyncController } from "../sync/SyncPlugin";
import { t as tr, useT } from "../i18n";

/** The built-in sets as the core reports them (static: fetched once per controller). */
const builtinCache = new WeakMap<SyncController, Promise<StyleSet[]>>();

export function builtinSets(ctl: SyncController): Promise<StyleSet[]> {
  let p = builtinCache.get(ctl);
  if (!p) {
    p = ctl.api.styleSets().then((r) => r.sets, () => []);
    builtinCache.set(ctl, p);
  }
  return p;
}

/** The gallery label of a set: Word's names for the built-in ones, the user's name for their own. */
export function styleSetLabel(set: StyleSet, builtin: boolean): string {
  return builtin ? tr(`write.styleSet.${set.id}`) : set.id;
}

/** A gallery tile: Title, Heading 1 and a body line as the set formats them. */
function SetPreview({ sheet, set }: { sheet: StyleSheet; set: StyleSet }) {
  const s = useMemo(() => withStyleSet(sheet, set), [sheet, set]);
  const line = (id: string, text: string, maxPt: number) => {
    const st = s.styles.find((x) => x.id === id);
    if (!st) return null;
    const p = resolveParagraph(s, id);
    const css: CSSProperties = {
      ...previewStyle(s, st, maxPt),
      display: "block",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textAlign: p.alignment === "center" ? "center" : undefined,
      backgroundColor: p.shading && p.shading.kind !== "auto" ? colorCss(p.shading) : undefined,
      borderBottom: p.borders?.bottom ? `1px solid ${colorCss(p.borders.bottom.color) ?? "#000"}` : undefined,
      padding: "0 1px",
    };
    return <span style={css}>{text}</span>;
  };
  return (
    <span className="flex h-full w-full flex-col justify-center gap-px overflow-hidden bg-white px-1 text-left text-black" aria-hidden="true">
      {line("Title", tr("write.styleSet.sampleTitle"), 11)}
      {line("Heading1", tr("write.styleSet.sampleHeading"), 8)}
      {line("Normal", tr("write.styleSet.sampleBody"), 5)}
    </span>
  );
}

const INLINE_SETS = 5;

function DocumentFormatting({ ctl }: { ctl: SyncController }) {
  const t = useT();
  const sheet = useSyncExternalStore(ctl.subscribe, () => ctl.styles);
  const [builtins, setBuiltins] = useState<StyleSet[]>([]);
  const [custom, setCustom] = useState<StyleSet[]>(() => loadCustomSets());
  const [saveOpen, setSaveOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void builtinSets(ctl).then((s) => live && setBuiltins(s));
    return () => {
      live = false;
    };
  }, [ctl]);
  const all = useMemo(() => [...builtins.map((s) => ({ set: s, builtin: true })), ...custom.map((s) => ({ set: s, builtin: false }))], [builtins, custom]);
  if (!sheet) return null;
  const key = (x: { set: StyleSet; builtin: boolean }) => (x.builtin ? x.set.id : `custom:${x.set.id}`);
  const items: RibbonGalleryItem[] = all.map((x) => ({ id: key(x), label: styleSetLabel(x.set, x.builtin), preview: <SetPreview sheet={sheet} set={x.set} /> }));
  const current = currentSetId(sheet, builtins);
  const currentCustom = current ? null : currentSetId(sheet, custom);
  const selected = current ?? (currentCustom ? `custom:${currentCustom}` : undefined);
  const pick = (id: string) => {
    const x = all.find((y) => key(y) === id);
    if (x) void ctl.run(applyStyleSetCommand(x.set));
  };
  return (
    <>
      <RibbonGallery label={t("write.design.styleSets")} items={items.slice(0, INLINE_SETS)} selected={selected} onSelect={pick} itemClassName="h-14 w-20 p-0.5" />
      <RibbonStack>
        <RibbonMenuButton
          label={t("write.design.moreSets")}
          icon="chevronDown"
          menu={(close) => (
            <div className="flex flex-col gap-1 p-1" data-testid="style-sets-more">
              <RibbonGallery
                label={t("write.design.styleSets")}
                items={items}
                selected={selected}
                columns={5}
                itemClassName="h-16 w-24 p-0.5"
                autoFocus
                onSelect={(id) => {
                  close();
                  pick(id);
                }}
              />
              <div className="flex flex-col border-t border-ui-border pt-1 text-xs">
                <button
                  type="button"
                  className="min-h-8 rounded px-2 text-left hover:bg-ui-hover"
                  onClick={() => {
                    close();
                    const def = loadDefaultSet() ?? builtins.find((s) => s.id === "word");
                    if (def) void ctl.run(applyStyleSetCommand(def));
                  }}
                >
                  {t("write.design.resetSet")}
                </button>
                <button
                  type="button"
                  className="min-h-8 rounded px-2 text-left hover:bg-ui-hover"
                  onClick={() => {
                    close();
                    setSaveOpen(true);
                  }}
                >
                  {t("write.design.saveSet")}
                </button>
              </div>
            </div>
          )}
        />
      </RibbonStack>
      <PromptDialog
        open={saveOpen}
        title={t("write.design.saveSetTitle")}
        label={t("write.design.setName")}
        initial={t("write.design.setNameDefault")}
        confirmLabel={t("cmd.save")}
        onClose={() => setSaveOpen(false)}
        onSubmit={(name) => {
          setSaveOpen(false);
          void ctl.api.styleSets().then((r) => setCustom(saveCustomSet({ ...r.current, id: name.trim() })), (e) => ctl.pushError(e));
        }}
      />
    </>
  );
}

function SpacingAndDefault({ ctl }: { ctl: SyncController }) {
  const t = useT();
  const sheet = useSyncExternalStore(ctl.subscribe, () => ctl.styles);
  const spacing = currentParagraphSpacing(sheet);
  return (
    <>
      <RibbonMenuButton
        label={t("write.design.paragraphSpacing")}
        icon="lineSpacing"
        size="large"
        menu={PARAGRAPH_SPACING.map((p) => ({
          id: p.id,
          label: t(`write.design.spacing.${p.id}`),
          checked: spacing === p.id,
          onSelect: () => {
            const cmd = paragraphSpacingCommand(p.id as ParagraphSpacingId);
            if (cmd) void ctl.run(cmd);
          },
        }))}
      />
      <RibbonButton
        label={t("write.design.setAsDefault")}
        icon="save"
        size="large"
        tooltip={t("write.design.setAsDefaultTip")}
        onClick={() => {
          void ctl.api.styleSets().then((r) => {
            saveDefaultSet({ ...r.current, id: "default" });
            ctl.showInfo(t("write.design.defaultSaved"));
          }, (e) => ctl.pushError(e));
        }}
      />
    </>
  );
}

/** The Design tab. */
export function designTab(ctl: SyncController, t: (k: string) => string): RibbonTab {
  return {
    id: "design",
    label: t("tab.design"),
    groups: [
      { label: t("write.design.documentFormatting"), items: <DocumentFormatting ctl={ctl} /> },
      { label: t("write.design.formatting"), items: <SpacingAndDefault ctl={ctl} /> },
    ],
  };
}
