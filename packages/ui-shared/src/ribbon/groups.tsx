// The active tab's groups. On a narrow window the groups that do not fit
// collapse from the right into one button each (Office: the group's name with
// a ▾) whose popup shows the group as it is in the ribbon (P8-38, W-20).
//
// The natural widths are measured while every group is expanded (on a new
// tab or new group labels); a resize recomputes from them. A wrong estimate
// of the collapsed buttons' widths is corrected after rendering: while the
// groups still overflow, one more collapses.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { RibbonIcon } from "./icons";

export interface GroupBarGroup {
  label: string;
  items: ReactNode;
  /** Collapses before groups with a lower priority on narrow windows (default 0). */
  collapsePriority?: number;
}

/** Width (px) a collapsed group's button takes: its label at 11 px plus padding (estimate). */
export const collapsedWidth = (label: string) => Math.max(52, Math.ceil(label.length * 6.2) + 22);

/**
 * The order groups collapse in: a higher `collapsePriority` first (an AI or a gallery group before the commands),
 * among equal priorities the rightmost first.
 */
export function collapseOrder(priorities: readonly (number | undefined)[]): number[] {
  return priorities.map((p, i) => ({ p: p ?? 0, i })).sort((a, b) => b.p - a.p || b.i - a.i).map((x) => x.i);
}

/**
 * How many groups stay expanded in `available` px: the fewest groups collapse (in `collapseOrder`) such that the
 * natural widths of the others plus a collapsed button for each collapsed one fit.
 */
export function groupsThatFit(widths: readonly number[], labels: readonly string[], available: number, priorities: readonly (number | undefined)[] = []): number {
  const n = widths.length;
  const order = collapseOrder(Array.from({ length: n }, (_, i) => priorities[i]));
  let total = widths.reduce((s, w) => s + w, 0);
  for (let k = 0; k <= n; k++) {
    if (total <= available) return n - k;
    if (k === n) break;
    const i = order[k]!;
    total += collapsedWidth(labels[i] ?? "") - widths[i]!;
  }
  return 0;
}

/** The groups collapsed when `fit` of `n` stay expanded. */
export function collapsedSet(n: number, fit: number, priorities: readonly (number | undefined)[]): Set<number> {
  return new Set(collapseOrder(Array.from({ length: n }, (_, i) => priorities[i])).slice(0, Math.max(0, n - fit)));
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-0.5">{children}</div>
      <div aria-hidden="true" className="h-3 whitespace-nowrap text-center text-[10px] leading-3 text-ui-muted">
        {label}
      </div>
    </>
  );
}

function CollapsedGroup({ group }: { group: GroupBarGroup }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  // Kept inside the window: a popup that would leave it on the right moves left.
  useLayoutEffect(() => {
    if (!open) return setShift(0);
    const r = popup.current?.getBoundingClientRect();
    if (!r) return;
    const over = r.right - shift - (window.innerWidth - 4);
    setShift(over > 0 ? -Math.min(over, Math.max(0, r.left - shift - 4)) : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={root} role="group" aria-label={group.label} data-collapsed-group="" className="relative flex shrink-0 flex-col border-r border-ui-border px-1 last:border-r-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        title={group.label}
        className={`flex h-full min-w-11 flex-col items-center justify-center gap-0.5 rounded px-1 text-[11px] text-ui-fg hover:bg-ui-hover aria-expanded:bg-ui-hover ${FOCUS_RING}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="whitespace-nowrap">{group.label}</span>
        <RibbonIcon name="chevronDown" />
      </button>
      {open && (
        <div
          ref={popup}
          style={{ left: shift }}
          className="absolute top-full z-30 flex h-[66px] flex-col rounded-b border border-ui-border bg-ui-panel px-1.5 py-px shadow-lg"
          data-testid="ribbon-group-popup"
          onClick={(e) => {
            // A command closes the popup; buttons that open a menu keep it.
            const b = (e.target as Element).closest("button");
            if (b && !b.hasAttribute("aria-haspopup") && !b.closest("[aria-haspopup]")) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented) {
              e.stopPropagation();
              setOpen(false);
              root.current?.querySelector("button")?.focus();
            }
          }}
        >
          <Group label={group.label}>{group.items}</Group>
        </div>
      )}
    </div>
  );
}

/** The groups of one tab in a bar of the panel's width (re-mount it per tab: `key={tab.id}`). */
export function GroupBar({ groups, label, tabId }: { groups: GroupBarGroup[]; label: string; tabId: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const n = groups.length;
  const sig = groups.map((g) => g.label).join("\u0001");
  const widths = useRef<number[] | null>(null);
  const measuredSig = useRef("");
  const [fit, setFit] = useState(n);
  const [width, setWidth] = useState(0);
  // The most groups known to fit at `width` (lowered when the estimate was too optimistic).
  const cap = useRef<{ width: number; fit: number } | null>(null);

  const groupEls = useCallback(() => Array.from(bar.current?.children ?? []) as HTMLElement[], []);

  // New labels (language, contents): measure again with everything expanded.
  useLayoutEffect(() => {
    if (measuredSig.current === sig) return;
    measuredSig.current = sig;
    widths.current = null;
    cap.current = null;
    setFit(n);
  }, [sig, n]);

  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const available = el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft || "0") - parseFloat(getComputedStyle(el).paddingRight || "0");
    // No layout (tests, hidden): leave everything expanded.
    if (el.clientWidth <= 0) return;
    const els = groupEls();
    if (fit >= n && els.length === n) widths.current = els.map((g) => g.getBoundingClientRect().width);
    if (!widths.current || widths.current.length !== n) return;
    if (cap.current && cap.current.width !== el.clientWidth) cap.current = null;
    let want = groupsThatFit(widths.current, groups.map((g) => g.label), available, groups.map((g) => g.collapsePriority));
    if (cap.current) want = Math.min(want, cap.current.fit);
    const used = els.reduce((s, g) => s + g.getBoundingClientRect().width, 0);
    if (want === fit && used > available + 1 && fit > 0) {
      want = fit - 1;
      cap.current = { width: el.clientWidth, fit: want };
    }
    if (want !== fit) setFit(want);
  });

  const collapsed = collapsedSet(n, fit, groups.map((g) => g.collapsePriority));
  return (
    <div ref={bar} role="toolbar" aria-label={label} data-tab={tabId} data-collapsed-groups={n - Math.min(fit, n) || undefined} className="flex h-[64px] min-w-0 items-stretch px-1 py-px" data-width={width || undefined}>
      {groups.map((g, i) =>
        !collapsed.has(i) ? (
          // Labels may repeat within a tab (two "Size" groups): keyed by position too.
          <div key={`${tabId}:${i}:${g.label}`} role="group" aria-label={g.label} className="flex shrink-0 flex-col border-r border-ui-border px-1 last:border-r-0">
            <Group label={g.label}>{g.items}</Group>
          </div>
        ) : (
          <CollapsedGroup key={`${tabId}:${i}:${g.label}:c`} group={g} />
        ),
      )}
    </div>
  );
}
