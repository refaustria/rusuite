// View › Slide Master (P8-22): the Slide Master tab and the panel with
// the master and its layouts. The stage shows the selected master or
// layout as a pseudo slide (`design/master.ts`): placeholders are moved
// and resized with the normal selection tools, their level-1 text
// formatting comes from the Home tab, the background from Format
// Background. Inserting placeholders and renaming layouts are not
// offered: the core has no command for them (P8-19).

import { useState } from "react";
import { ContextMenu, RibbonButton, RibbonStack, type ContextMenuItem, type RibbonTab, type TFunction } from "@rusuite/ui-shared";
import type { DesignTarget } from "../generated/DesignTarget";
import { stableDeck } from "../design/deck";
import { layoutName } from "../design/layouts";
import { designSlide, sameTarget, targetKey } from "../design/master";
import { masterMenu } from "../canvas/menus";
import { useShow, type ShowState, type ShowStore } from "../state/store";
import { useT } from "../i18n";
import { DeckThumb } from "./Thumbs";
import { designControls } from "./DesignTab";
import { DI } from "./designIcons";

const EMPTY_MEDIA = new Map<number, string>();

export function slideMasterTab(store: ShowStore, state: ShowState, t: TFunction): RibbonTab {
  const mv = state.masterView;
  const layout = mv?.kind === "layout" ? mv.value : null;
  const inUse = layout !== null && store.layoutInUse(layout);
  const d = designControls(store, state, t);
  const hidden = layout !== null && state.pres?.layouts.find((l) => l.kind === layout)?.showMasterShapes === false;
  return {
    id: "slideMaster",
    label: t("show.master.tab"),
    groups: [
      {
        label: t("show.master.edit"),
        items: (
          <>
            <RibbonButton label={t("show.master.insertLayout")} icon={DI.insertLayout} size="large" showLabel onClick={() => void store.addLayout()} />
            <RibbonStack>
              <RibbonButton label={t("show.master.deleteLayout")} icon="trash" showLabel disabled={layout === null || inUse} tooltip={inUse ? t("show.master.inUse") : undefined} onClick={() => void store.deleteLayout()} />
              <RibbonButton label={t("show.master.duplicateLayout")} icon="duplicate" showLabel disabled={layout === null} onClick={() => void store.duplicateLayout()} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.master.editTheme"),
        items: (
          <>
            {d.themesGallery("dropdown")}
            <RibbonStack>
              {d.colors}
              {d.fonts}
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.background"),
        items: (
          <>
            {d.formatBackground}
            <RibbonStack>
              {d.backgroundStyles}
              <RibbonButton
                label={t("show.bg.hideGraphics")}
                icon={DI.placeholder}
                showLabel
                pressed={hidden}
                disabled={layout === null}
                onClick={() => {
                  const l = state.pres?.layouts.find((x) => x.kind === layout);
                  void store.setBackgroundOf(store.backgroundTarget(), l?.background ?? null, !hidden);
                }}
              />
            </RibbonStack>
          </>
        ),
      },
      { label: t("show.size.label"), items: d.slideSize },
      {
        label: t("show.master.closeGroup"),
        items: <RibbonButton label={t("show.master.close")} icon={DI.close} size="large" showLabel onClick={() => store.closeMasterView()} />,
      },
    ],
  };
}

/** The master view's left panel: the master's thumbnail and its layouts below it. */
export function MasterPanel({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const mv = useShow(store, (s) => s.masterView);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  if (!pres || !mv) return null;
  const deck = stableDeck(pres);
  const targets: { target: DesignTarget; label: string; uses: number }[] = [
    { target: { kind: "master" }, label: t("show.master.master"), uses: pres.slides.length },
    ...pres.layouts.map((l) => ({ target: { kind: "layout", value: l.kind } as DesignTarget, label: layoutName(l), uses: pres.slides.filter((s) => s.layout === l.kind).length })),
  ];
  const index = targets.findIndex((x) => sameTarget(x.target, mv));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && index < targets.length - 1) store.selectDesignTarget(targets[index + 1]!.target);
    else if (e.key === "ArrowUp" && index > 0) store.selectDesignTarget(targets[index - 1]!.target);
    else return;
    e.preventDefault();
  };
  return (
    <nav
      aria-label={t("show.master.panel")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="master-panel"
      className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ui-border bg-ui-panel p-2 outline-none"
    >
      {targets.map(({ target, label, uses }) => {
        const isMaster = target.kind === "master";
        const active = sameTarget(target, mv);
        return (
          <button
            key={targetKey(target)}
            type="button"
            aria-label={label}
            aria-current={active ? "true" : undefined}
            title={isMaster ? label : t("show.master.usedBy", { name: label, count: uses })}
            data-testid="master-thumb"
            data-target={targetKey(target)}
            className={`flex min-h-8 rounded p-1 text-left ${isMaster ? "" : "pl-5"} ${active ? "bg-ui-active" : "hover:bg-ui-hover"}`}
            onClick={() => store.selectDesignTarget(target)}
            onContextMenu={(e) => {
              e.preventDefault();
              store.selectDesignTarget(target);
              setMenu({ at: { x: e.clientX, y: e.clientY }, items: masterMenu(store) });
            }}
          >
            <span className="overflow-hidden rounded border border-ui-border bg-white">
              <DeckThumb deck={deck} slide={designSlide(pres, target)} media={EMPTY_MEDIA} width={isMaster ? 152 : 132} design={isMaster ? "master" : "layout"} />
            </span>
          </button>
        );
      })}
      <ContextMenu at={menu?.at ?? null} label={t("show.master.panel")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </nav>
  );
}
