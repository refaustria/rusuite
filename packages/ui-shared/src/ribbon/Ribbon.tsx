// Office-style ribbon: a tab strip (app name, document title, File + tabs,
// a right slot, the collapse toggle) over the active tab's groups.
//
// Keyboard: Alt (pressed and released alone) focuses the tab strip and
// returns from it; ←/→/Home/End move between tabs, Enter/Space activate
// (File opens the backstage), ↓ enters the active tab's controls, Esc goes
// back to the document. Ctrl+F1 collapses/expands the ribbon; when
// collapsed, activating a tab shows its groups temporarily over the
// document until a command runs, Esc, or a click elsewhere.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { Backstage, type BackstageActions } from "./Backstage";
import { RibbonIcon } from "./icons";

export interface RibbonGroup {
  label: string;
  /** Group contents; `null`/`false`/empty means the group is omitted. */
  items: ReactNode;
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
  /** Accessible name of the tab's toolbar (default: the tab label). */
  toolbarLabel?: string;
}

export interface RibbonProps {
  tabs: RibbonTab[];
  /** Controlled active tab id. */
  activeTab?: string;
  /** Uncontrolled initial tab (default: the first). */
  defaultTab?: string;
  onTabChange?: (id: string) => void;
  /** Controlled collapsed state (tab strip only). */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  appName: string;
  documentTitle?: string;
  /** Right end of the tab strip (e.g. Present). */
  rightSlot?: ReactNode;
  /** File tab: the backstage commands. Without it there is no File tab. */
  backstage?: BackstageActions;
  /** App accent color (File tab, backstage pane). */
  accent?: string;
  /** Bind Alt and Ctrl+F1 on the window (default true). */
  globalKeys?: boolean;
}

const hasItems = (g: RibbonGroup) => g.items !== null && g.items !== undefined && g.items !== false && !(Array.isArray(g.items) && g.items.filter(Boolean).length === 0);

/** Tabs with their empty groups removed; tabs left without groups are dropped. */
export function visibleTabs(tabs: RibbonTab[]): RibbonTab[] {
  return tabs.map((t) => ({ ...t, groups: t.groups.filter(hasItems) })).filter((t) => t.groups.length > 0);
}

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Ribbon({
  tabs, activeTab, defaultTab, onTabChange, collapsed: collapsedProp, defaultCollapsed = false, onCollapsedChange,
  appName, documentTitle, rightSlot, backstage, accent = "var(--ui-focus)", globalKeys = true,
}: RibbonProps) {
  const shown = visibleTabs(tabs);
  const [innerTab, setInnerTab] = useState(defaultTab ?? shown[0]?.id ?? "");
  const [innerCollapsed, setInnerCollapsed] = useState(defaultCollapsed);
  const [peek, setPeek] = useState(false);
  const [backstageOpen, setBackstageOpen] = useState(false);
  const collapsed = collapsedProp ?? innerCollapsed;
  const requested = activeTab ?? innerTab;
  const active = shown.find((t) => t.id === requested) ?? shown[0];
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const uid = useId();
  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = `${uid}-panel`;

  const setCollapsed = useCallback(
    (c: boolean) => {
      setInnerCollapsed(c);
      setPeek(false);
      onCollapsedChange?.(c);
    },
    [onCollapsedChange],
  );
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const select = (id: string) => {
    setInnerTab(id);
    if (id !== active?.id) onTabChange?.(id);
  };
  const activate = (id: string) => {
    if (id === "file") {
      setPeek(false);
      setBackstageOpen(true);
      return;
    }
    select(id);
    if (collapsed) setPeek((p) => (id === active?.id ? !p : true));
  };

  const tabButtons = () => Array.from(strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  const focusTabStrip = () => {
    const b = tabButtons();
    (b.find((x) => x.getAttribute("aria-selected") === "true") ?? b[0])?.focus();
  };
  const leaveStrip = () => {
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && back.isConnected) back.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const rememberFocus = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !root.current?.contains(a)) returnFocus.current = a;
  };

  // Alt alone toggles the focus into/out of the tab strip; Ctrl+F1 collapses.
  useEffect(() => {
    if (!globalKeys) return;
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey;
        return;
      }
      altAlone = false;
      if (e.key === "F1" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setCollapsed(!collapsedRef.current);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (strip.current?.contains(document.activeElement)) leaveStrip();
      else {
        rememberFocus();
        focusTabStrip();
      }
    };
    const reset = () => {
      altAlone = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", reset);
      window.removeEventListener("blur", reset);
    };
  }, [globalKeys, setCollapsed]);

  // A temporarily shown (collapsed) tab closes on a click elsewhere.
  useEffect(() => {
    if (!peek) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setPeek(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [peek]);

  const closeBackstage = () => {
    setBackstageOpen(false);
    // Back to the document unless a command moved the focus (e.g. into a dialog).
    setTimeout(() => {
      const a = document.activeElement;
      if (a === null || a === document.body || strip.current?.contains(a)) {
        const back = returnFocus.current;
        returnFocus.current = null;
        if (back && back.isConnected) back.focus();
      }
    }, 0);
  };

  const ids = [...(backstage ? ["file"] : []), ...shown.map((t) => t.id)];
  const onStripKey = (e: React.KeyboardEvent) => {
    const b = tabButtons();
    const i = b.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n: number | undefined;
    if (e.key === "ArrowRight") n = (i + 1) % b.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + b.length) % b.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = b.length - 1;
    if (n !== undefined) {
      e.preventDefault();
      b[n]!.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(ids[i]!);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (ids[i] === "file") activate("file");
      else {
        if (ids[i] !== active?.id) activate(ids[i]!);
        else if (collapsed) setPeek(true);
        setTimeout(() => document.getElementById(panelId)?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPeek(false);
      leaveStrip();
    }
  };

  const showPanel = active && (!collapsed || peek);
  const tabClass = (selected: boolean) =>
    `relative h-7 shrink-0 px-3 text-sm text-ui-fg hover:bg-ui-hover ${FOCUS_RING} ${
      selected && !(collapsed && !peek) ? "font-semibold after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded after:bg-[var(--ribbon-accent)] after:content-['']" : ""
    }`;

  return (
    <div ref={root} className="relative z-20 border-b border-ui-border bg-ui-panel text-ui-fg" data-testid="ribbon" data-collapsed={collapsed || undefined}>
      <div ref={strip} className="flex h-7 items-center gap-1 pl-2" style={{ ["--ribbon-accent" as string]: accent }}>
        <span className="shrink-0 text-sm font-semibold" style={{ color: accent }} data-testid="ribbon-app-name">
          {appName}
        </span>
        {documentTitle !== undefined && (
          <span className="max-w-48 shrink truncate text-xs text-ui-muted" data-testid="ribbon-doc-title" title={documentTitle}>
            {documentTitle}
          </span>
        )}
        <div
          role="tablist"
          aria-label="Ribbon tabs"
          className="ml-2 flex min-w-0 items-stretch"
          onKeyDown={onStripKey}
          onMouseDown={rememberFocus}
        >
          {backstage && (
            <button
              id={tabId("file")}
              type="button"
              role="tab"
              aria-selected={false}
              aria-haspopup="dialog"
              aria-expanded={backstageOpen}
              tabIndex={-1}
              className={`h-7 shrink-0 rounded-sm px-3 text-sm font-medium text-white hover:brightness-110 ${FOCUS_RING}`}
              style={{ background: accent }}
              onClick={() => activate("file")}
            >
              File
            </button>
          )}
          {shown.map((t) => {
            const selected = t.id === active?.id;
            return (
              <button
                key={t.id}
                id={tabId(t.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected && showPanel ? panelId : undefined}
                tabIndex={selected ? 0 : -1}
                className={tabClass(selected)}
                onClick={() => activate(t.id)}
                onDoubleClick={() => setCollapsed(!collapsed)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1 pr-1">
          {rightSlot}
          <button
            type="button"
            aria-label={collapsed ? "Expand the ribbon" : "Collapse the ribbon"}
            aria-pressed={collapsed}
            title={`${collapsed ? "Expand" : "Collapse"} the ribbon (Ctrl+F1)`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded text-ui-muted hover:bg-ui-hover ${FOCUS_RING}`}
            onClick={() => setCollapsed(!collapsed)}
          >
            <RibbonIcon name={collapsed ? "chevronDown" : "chevronUp"} />
          </button>
        </div>
      </div>
      {showPanel && (
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={tabId(active.id)}
          data-testid="ribbon-panel"
          className={`border-t border-ui-border bg-ui-panel [&_.h-7]:h-6 ${collapsed ? "absolute inset-x-0 top-full shadow-lg" : ""}`}
          onClick={(e) => {
            if (!collapsed) return;
            const b = (e.target as Element).closest("button");
            if (b && !b.hasAttribute("aria-haspopup")) setPeek(false);
          }}
          onChange={() => collapsed && setPeek(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && collapsed && !e.defaultPrevented) {
              setPeek(false);
              focusTabStrip();
            }
          }}
        >
          <div role="toolbar" aria-label={active.toolbarLabel ?? active.label} className="flex h-[64px] items-stretch px-1 py-px">
            {active.groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="flex shrink-0 flex-col border-r border-ui-border px-1.5 last:border-r-0">
                <div className="flex min-h-0 flex-1 items-center gap-0.5">{g.items}</div>
                <div aria-hidden="true" className="h-3 text-center text-[10px] leading-3 text-ui-muted">
                  {g.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {backstage && (
        <Backstage {...backstage} open={backstageOpen} onClose={closeBackstage} appName={appName} documentTitle={documentTitle} accent={accent} />
      )}
    </div>
  );
}
