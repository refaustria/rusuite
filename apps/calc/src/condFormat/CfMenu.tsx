// Home › Styles › Conditional Formatting ▾: Excel's menu with its flyouts
// (Highlight Cells Rules, Top/Bottom Rules, the Data Bars / Color Scales /
// Icon Sets galleries, Clear Rules) and New Rule… / Manage Rules…. A
// flyout opens on click, Enter or → (and on hover); ← or Esc closes it.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import { DataBarPreview, IconSetPreview, ScalePreview } from "./previews";
import {
  COLOR_SCALES, colorScaleRule, DATA_BARS, dataBarRule, HIGHLIGHT_RULES, ICON_SET_GROUPS, iconSetRule, TOP_BOTTOM_RULES, type QuickRuleKind,
} from "./presets";

type Sub = "highlight" | "topBottom" | "dataBars" | "colorScales" | "iconSets" | "clear";

const ITEM = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-ui-fg hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:outline-none aria-expanded:bg-ui-active";
const TILE = "flex items-center justify-center rounded border border-transparent p-1 hover:border-ui-border hover:bg-ui-hover focus-visible:border-ui-focus focus-visible:outline-none";

/** Focus movement between the enabled menu items of a container (arrows, Home/End). */
function moveFocus(e: KeyboardEvent, root: HTMLElement | null, horizontal = false): boolean {
  const all = Array.from(root?.querySelectorAll<HTMLElement>(":scope [data-cf-item]") ?? []).filter((b) => b.closest("[data-cf-level]") === root);
  const i = all.indexOf(document.activeElement as HTMLElement);
  const next: Record<string, number> = horizontal ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
  const d = next[e.key];
  let n: number | undefined;
  if (d !== undefined) n = (i + d + all.length) % all.length;
  else if (e.key === "Home") n = 0;
  else if (e.key === "End") n = all.length - 1;
  if (n === undefined || all.length === 0) return false;
  e.preventDefault();
  e.stopPropagation();
  all[n]!.focus();
  return true;
}

function Flyout({ label, children, onClose }: { label: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("[data-cf-item]")?.focus(), []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-cf-level=""
      className="absolute left-full top-0 z-50 ml-0.5 min-w-52 rounded border border-ui-border bg-ui-panel p-1 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        moveFocus(e, ref.current);
      }}
    >
      {children}
    </div>
  );
}

export function CfMenu({ store, close }: { store: CalcStore; close: () => void }) {
  const t = useT();
  const [sub, setSub] = useState<Sub | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const subButtons = useRef<Partial<Record<Sub, HTMLButtonElement | null>>>({});
  useEffect(() => root.current?.querySelector<HTMLElement>("[data-cf-item]")?.focus(), []);

  const done = (fn: () => unknown) => () => {
    close();
    void fn();
    if (!store.getState().dialog) store.focusGrid();
  };
  const quick = (q: QuickRuleKind) => done(() => store.openDialog({ kind: "cfQuick", quick: q }));
  const more = done(() => store.openDialog({ kind: "cfRule", rule: null }));
  const add = (rule: Parameters<CalcStore["addCfRule"]>[0]) => done(() => store.addCfRule(rule));
  const closeSub = () => {
    const s = sub;
    setSub(null);
    if (s) subButtons.current[s]?.focus();
  };

  const subItem = (id: Sub, label: string, body: () => ReactNode) => (
    <div className="relative" onMouseEnter={() => setSub(id)}>
      <button
        ref={(b) => {
          subButtons.current[id] = b;
        }}
        type="button"
        role="menuitem"
        data-cf-item=""
        aria-haspopup="menu"
        aria-expanded={sub === id}
        className={ITEM}
        onClick={() => setSub(id)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setSub(id);
          }
        }}
      >
        <span className="flex-1">{label}</span>
        <span aria-hidden="true">›</span>
      </button>
      {sub === id && (
        <Flyout label={label} onClose={closeSub}>
          {body()}
        </Flyout>
      )}
    </div>
  );
  /** A menu item; `top`: one of the main menu (hovering it closes an open flyout). */
  const item = (label: string, onClick: () => void, top = false) => (
    <button type="button" role="menuitem" data-cf-item="" className={ITEM} onClick={onClick} onMouseEnter={top ? () => setSub(null) : undefined}>
      {label}
    </button>
  );
  const moreRules = () => (
    <>
      <div role="separator" className="my-1 border-t border-ui-border" />
      {item(t("calc.cf.moreRules"), more)}
    </>
  );
  const ranges = () => store.selectionRects();

  return (
    <div
      ref={root}
      role="menu"
      aria-label={t("calc.cf.menu")}
      data-cf-level=""
      data-testid="cf-menu"
      className="flex min-w-60 flex-col py-0.5"
      onKeyDown={(e) => moveFocus(e, root.current)}
    >
      {subItem("highlight", t("calc.cf.highlight"), () => (
        <>
          {HIGHLIGHT_RULES.map((q) => (
            <div key={q}>{item(t(`calc.cf.quick.${q}`), quick(q))}</div>
          ))}
          {moreRules()}
        </>
      ))}
      {subItem("topBottom", t("calc.cf.topBottom"), () => (
        <>
          {TOP_BOTTOM_RULES.map((q) => (
            <div key={q}>{item(t(`calc.cf.quick.${q}`), quick(q))}</div>
          ))}
          {moreRules()}
        </>
      ))}
      {subItem("dataBars", t("calc.cf.dataBars"), () => (
        <>
          {([false, true] as const).map((solid) => (
            <div key={String(solid)} role="group" aria-label={t(solid ? "calc.cf.solidFill" : "calc.cf.gradientFill")}>
              <div className="px-2 pt-1 text-[11px] font-medium text-ui-muted">{t(solid ? "calc.cf.solidFill" : "calc.cf.gradientFill")}</div>
              <div className="grid grid-cols-3 gap-1 p-1">
                {DATA_BARS.map((b) => {
                  const label = t(solid ? `calc.cf.barSolid.${b.id}` : `calc.cf.bar.${b.id}`);
                  return (
                    <button key={b.id} type="button" role="menuitem" data-cf-item="" aria-label={label} title={label} className={TILE} onClick={add(dataBarRule(b.color, ranges(), solid))}>
                      <DataBarPreview color={b.color} solid={solid} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {moreRules()}
        </>
      ))}
      {subItem("colorScales", t("calc.cf.colorScales"), () => (
        <>
          <div className="grid grid-cols-4 gap-1 p-1">
            {COLOR_SCALES.map((s) => (
              <button key={s.id} type="button" role="menuitem" data-cf-item="" aria-label={t(`calc.cf.scale.${s.id}`)} title={t(`calc.cf.scale.${s.id}`)} className={TILE} onClick={add(colorScaleRule(s.colors, ranges()))}>
                <ScalePreview colors={s.colors} />
              </button>
            ))}
          </div>
          {moreRules()}
        </>
      ))}
      {subItem("iconSets", t("calc.cf.iconSets"), () => (
        <>
          {ICON_SET_GROUPS.map((g) => (
            <div key={g.id} role="group" aria-label={t(`calc.cf.iconGroup.${g.id}`)}>
              <div className="px-2 pt-1 text-[11px] font-medium text-ui-muted">{t(`calc.cf.iconGroup.${g.id}`)}</div>
              <div className="grid grid-cols-2 gap-1 p-1">
                {g.sets.map((set) => (
                  <button key={set} type="button" role="menuitem" data-cf-item="" aria-label={t(`calc.cf.icons.${set}`)} title={t(`calc.cf.icons.${set}`)} className={`${TILE} justify-start`} onClick={add(iconSetRule(set, ranges()))}>
                    <IconSetPreview set={set} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {moreRules()}
        </>
      ))}
      <div role="separator" className="my-1 border-t border-ui-border" />
      {item(t("calc.cf.newRule"), more, true)}
      {subItem("clear", t("calc.cf.clearRules"), () => (
        <>
          {item(t("calc.cf.clearSelection"), done(() => store.clearCf("selection")))}
          {item(t("calc.cf.clearSheet"), done(() => store.clearCf("sheet")))}
          {store.ruleScopeRange("table") && item(t("calc.cf.clearTable"), done(() => store.clearCf("table")))}
          {store.ruleScopeRange("pivot") && item(t("calc.cf.clearPivot"), done(() => store.clearCf("pivot")))}
        </>
      ))}
      {item(t("calc.cf.manage"), done(() => store.openDialog({ kind: "cfManage" })), true)}
    </div>
  );
}
