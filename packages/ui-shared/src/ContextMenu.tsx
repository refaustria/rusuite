import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FOCUS_RING } from "./Popover";
import { formatCombo } from "./shortcuts/keys";
import { useLocale } from "./i18n/react";

export type ContextMenuItem =
  | {
      id: string;
      label: string;
      /** Shown right-aligned, e.g. `Ctrl+C`. */
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { separator: true };

export interface ContextMenuProps {
  /** Viewport position (the pointer); `null` = closed. */
  at: { x: number; y: number } | null;
  label: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

const isItem = (i: ContextMenuItem): i is Exclude<ContextMenuItem, { separator: true }> => !("separator" in i);

/**
 * Right-click menu at a point: kept inside the viewport, focuses its
 * first item, arrow keys / Home / End move, Enter or Space activates,
 * Esc, Tab and an outside click close it. Selecting an item closes the
 * menu and then runs the item.
 */
export function ContextMenu({ at, label, items, onClose }: ContextMenuProps) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!at) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const vw = typeof window === "undefined" ? Infinity : window.innerWidth;
    const vh = typeof window === "undefined" ? Infinity : window.innerHeight;
    setPos({ x: Math.max(0, Math.min(at.x, vw - w - 4)), y: Math.max(0, Math.min(at.y, vh - h - 4)) });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      if (previous && document.activeElement && ref.current?.contains(document.activeElement)) previous.focus?.();
    };
  }, [at]);

  if (!at) return null;

  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-48 rounded border border-ui-border bg-ui-panel py-1 text-sm text-ui-fg shadow-lg"
      style={{ left: (pos ?? at).x, top: (pos ?? at).y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const b = buttons();
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") b[(i + 1) % b.length]?.focus();
        else if (e.key === "ArrowUp") b[(i - 1 + b.length) % b.length]?.focus();
        else if (e.key === "Home") b[0]?.focus();
        else if (e.key === "End") b[b.length - 1]?.focus();
        else if (e.key === "Escape" || e.key === "Tab") onClose();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((it, i) =>
        isItem(it) ? (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1 text-left hover:bg-ui-hover focus:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="text-xs text-ui-muted">{formatCombo(it.shortcut)}</span>}
          </button>
        ) : (
          <div key={`sep-${i}`} role="separator" className="my-1 border-t border-ui-border" />
        ),
      )}
    </div>
  );
}
