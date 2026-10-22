// The compact layout's bottom command bar (P10-M2): row 1 the ribbon's tabs as scrollable chips, row 2 the active
// tab's controls – the same group contents the ribbon renders (one declaration per command), flattened into one
// horizontally scrolling strip of 44 px touch buttons (`CompactBarContext`), the groups separated by a divider with
// their name as a caption. The strip remembers its scroll position per tab. The bar is fixed to the bottom of the
// visual viewport (`--rs-kb-inset`, above the on-screen keyboard) and publishes its height as `--rs-command-bar-h`.

import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { FOCUS_RING } from "../Popover";
import { useT } from "../i18n/react";
import type { RibbonGroup, RibbonTab } from "../ribbon/Ribbon";
import { CompactBarContext } from "./useCompact";

/** One segment of the strip: a group of the tab, in ribbon order. */
export interface CompactSegment {
  tabId: string;
  /** Position of the group in its tab (labels may repeat). */
  index: number;
  label: string;
  group: RibbonGroup;
}

/** The strip of `tab`: its groups in ribbon order (the tabs come through `visibleTabs`, so empty groups are gone). */
export function compactSegments(tab: RibbonTab): CompactSegment[] {
  return tab.groups.map((group, index) => ({ tabId: tab.id, index, label: group.label, group }));
}

export interface CommandBarProps {
  /** The visible tabs (`visibleTabs`: standard tabs, then the contextual ones). */
  tabs: RibbonTab[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  accent: string;
}

export function CommandBar({ tabs, activeId, onSelect, accent }: CommandBarProps) {
  const t = useT();
  const uid = useId();
  const bar = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const scroll = useRef(new Map<string, number>());
  const active = tabs.find((x) => x.id === activeId) ?? tabs[0];
  const tabId = (id: string) => `${uid}-ctab-${id}`;
  const panelId = `${uid}-cpanel`;

  // The app's layout leaves room for the bar (`--rs-command-bar-h`).
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--rs-command-bar-h", `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--rs-command-bar-h");
    };
  }, []);

  // Back on a tab: where its strip was scrolled to; the active chip in view.
  useLayoutEffect(() => {
    if (strip.current) strip.current.scrollLeft = scroll.current.get(active?.id ?? "") ?? 0;
  }, [active?.id]);
  useEffect(() => {
    const chip = chips.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    chip?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active?.id]);

  const onChipKey = (e: KeyboardEvent) => {
    const b = Array.from(chips.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const i = b.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = e.key === "ArrowRight" ? (i + 1) % b.length : e.key === "ArrowLeft" ? (i - 1 + b.length) % b.length : e.key === "Home" ? 0 : e.key === "End" ? b.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    b[n]!.focus();
    onSelect(tabs[n]!.id);
  };

  return (
    <div
      ref={bar}
      role="region"
      aria-label={t("compact.commandBar")}
      data-testid="command-bar"
      className="rs-touch fixed inset-x-0 z-30 border-t border-ui-border bg-ui-panel pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-ui-fg shadow-[0_-2px_6px_rgba(0,0,0,0.08)]"
      style={{ bottom: "var(--rs-kb-inset, 0px)" }}
    >
      <div
        ref={chips}
        role="tablist"
        aria-label={t("ribbon.tabs")}
        data-testid="command-tabs"
        className="flex gap-1 overflow-x-auto px-2 pt-1 [scrollbar-width:none]"
        onKeyDown={onChipKey}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active?.id;
          const color = tab.contextual?.color ?? accent;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.id}
              data-context={tab.contextual?.group}
              className={`h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm ${selected ? "font-semibold text-white" : "border-ui-border text-ui-fg"} ${FOCUS_RING}`}
              style={selected ? { background: color, borderColor: color } : tab.contextual ? { borderColor: color, color } : undefined}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div id={panelId} role="tabpanel" aria-labelledby={tabId(active.id)} data-testid="command-panel" data-tab={active.id}>
          <div
            ref={strip}
            role="toolbar"
            aria-label={active.toolbarLabel ?? active.label}
            data-compact-strip=""
            data-tab={active.id}
            className="flex items-stretch overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none]"
            onScroll={(e) => scroll.current.set(active.id, e.currentTarget.scrollLeft)}
          >
            <CompactBarContext.Provider value={true}>
              {compactSegments(active).map((s) => (
                <div
                  key={`${s.tabId}:${s.index}:${s.label}`}
                  role="group"
                  aria-label={s.label}
                  data-compact-group=""
                  className="flex shrink-0 flex-col border-r border-ui-border px-1 last:border-r-0"
                >
                  <div aria-hidden="true" className="h-3.5 whitespace-nowrap px-0.5 text-[10px] leading-[14px] text-ui-muted">
                    {s.label}
                  </div>
                  <div data-compact-items="" className="flex flex-1 items-center gap-0.5">
                    {s.group.items}
                  </div>
                </div>
              ))}
            </CompactBarContext.Provider>
          </div>
        </div>
      )}
    </div>
  );
}
