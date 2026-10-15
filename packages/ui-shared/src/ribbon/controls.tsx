// Ribbon controls: buttons (large/small, toggle), split buttons, menu
// buttons, dividers and layout helpers for group contents.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { formatCombo } from "../shortcuts/keys";
import { RibbonIcon, type RibbonIconName } from "./icons";

export type RibbonButtonSize = "large" | "small";

/** Tooltip text: `label (Ctrl+C)`. */
export function ribbonTooltip(label: string, shortcut?: string, tooltip?: string): string {
  const text = tooltip ?? label;
  return shortcut ? `${text} (${formatCombo(shortcut)})` : text;
}

const icon = (i: RibbonIconName | ReactNode, size: number) =>
  typeof i === "string" ? <RibbonIcon name={i as RibbonIconName} size={size} /> : i;

const BASE = `rounded text-ui-fg hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-ui-active aria-expanded:bg-ui-hover ${FOCUS_RING}`;
const LARGE = `${BASE} flex h-12 min-w-11 max-w-20 flex-col items-center justify-start gap-0.5 px-1 pt-1 text-center text-[11px] leading-3`;
const SMALL = `${BASE} inline-flex h-6 min-w-6 items-center justify-center gap-1 px-1 text-xs`;

/** Select styling inside ribbon groups. */
export const RIBBON_SELECT = `h-6 rounded border border-ui-border bg-ui-bg px-1 text-xs text-ui-fg disabled:opacity-40 ${FOCUS_RING}`;

export interface RibbonButtonProps {
  /** Accessible name; shown under large buttons and (with `showLabel`) next to small ones. */
  label: string;
  icon?: RibbonIconName | ReactNode;
  size?: RibbonButtonSize;
  /** Small buttons: show the label next to the icon. */
  showLabel?: boolean;
  /** Toggle buttons: current state (`aria-pressed`). */
  pressed?: boolean;
  disabled?: boolean;
  /** Combo spec (`Mod+C`) shown in the tooltip. */
  shortcut?: string;
  /** Tooltip text (default: the label). */
  tooltip?: string;
  onClick: () => void;
}

/** A ribbon command: large (icon over label) or small (icon, optional label). */
export function RibbonButton({ label, icon: i, size = "small", showLabel, pressed, disabled, shortcut, tooltip, onClick }: RibbonButtonProps) {
  const large = size === "large";
  return (
    <button
      type="button"
      className={large ? LARGE : SMALL}
      aria-label={label}
      aria-pressed={pressed}
      title={ribbonTooltip(label, shortcut, tooltip)}
      disabled={disabled}
      onClick={onClick}
    >
      {i !== undefined && icon(i, large ? 24 : 16)}
      {(large || showLabel || i === undefined) && <span className={large ? "line-clamp-2" : "whitespace-nowrap"}>{label}</span>}
    </button>
  );
}

/** Thin vertical rule between controls of one group. */
export function RibbonDivider() {
  return <div role="separator" aria-orientation="vertical" className="mx-0.5 h-10 w-px self-center bg-ui-border" />;
}

/** One row of small controls (groups stack up to two rows). */
export function RibbonRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

/** Stacks rows of small controls vertically. */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col justify-center gap-0.5">{children}</div>;
}

// --- popups ----------------------------------------------------------------

/** Open state of a popup anchored in `root`: closes on outside mousedown. */
export function usePopup() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return { open, setOpen, root };
}

export type RibbonMenuItem =
  | { id: string; label: string; icon?: RibbonIconName | ReactNode; shortcut?: string; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { separator: true; label?: string };

/** Keyboard-navigable menu (arrows, Home/End); the first enabled item gets the focus. */
export function RibbonMenu({ label, items, onDone }: { label: string; items: RibbonMenuItem[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
  useEffect(() => buttons()[0]?.focus(), []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="flex min-w-44 flex-col py-0.5"
      onKeyDown={(e) => {
        const b = buttons();
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") b[(i + 1) % b.length]?.focus();
        else if (e.key === "ArrowUp") b[(i - 1 + b.length) % b.length]?.focus();
        else if (e.key === "Home") b[0]?.focus();
        else if (e.key === "End") b[b.length - 1]?.focus();
        else return;
        e.preventDefault();
      }}
    >
      {items.map((it, n) =>
        "separator" in it ? (
          it.label ? (
            <div key={`sep${n}`} role="presentation" className="mt-1 border-t border-ui-border px-2 pt-1 text-[11px] font-medium text-ui-muted">
              {it.label}
            </div>
          ) : (
            <div key={`sep${n}`} role="separator" className="my-1 border-t border-ui-border" />
          )
        ) : (
          <button
            key={it.id}
            type="button"
            role={it.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={it.checked}
            disabled={it.disabled}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40 aria-checked:bg-ui-active ${FOCUS_RING}`}
            onClick={() => {
              onDone();
              it.onSelect();
            }}
          >
            <span className="flex w-4 justify-center">{it.icon !== undefined && icon(it.icon, 16)}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-xs text-ui-muted">{formatCombo(it.shortcut)}</span>}
          </button>
        ),
      )}
    </div>
  );
}

const PANEL = "absolute left-0 top-full z-50 mt-0.5 rounded border border-ui-border bg-ui-panel p-1 text-ui-fg shadow-lg";

/** Popup content: a menu, or any panel (`close` closes it and refocuses the trigger). */
export type RibbonPopupContent = RibbonMenuItem[] | ((close: () => void) => ReactNode);

function PopupPanel({ id, label, content, close }: { id: string; label: string; content: RibbonPopupContent; close: () => void }) {
  return (
    <div id={id} className={PANEL}>
      {Array.isArray(content) ? (
        <RibbonMenu label={label} items={content} onDone={close} />
      ) : (
        <div role="dialog" aria-label={label}>
          {content(close)}
        </div>
      )}
    </div>
  );
}

export interface RibbonMenuButtonProps {
  label: string;
  icon?: RibbonIconName | ReactNode;
  size?: RibbonButtonSize;
  showLabel?: boolean;
  disabled?: boolean;
  tooltip?: string;
  /** Menu items, or a panel (e.g. a gallery). */
  menu: RibbonPopupContent;
}

/** A button that only opens a menu or panel (Arrange ▾, Margins ▾ …). */
export function RibbonMenuButton({ label, icon: i, size = "small", showLabel, disabled, tooltip, menu }: RibbonMenuButtonProps) {
  const { open, setOpen, root } = usePopup();
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const large = size === "large";
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled, setOpen]);
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        className={large ? LARGE : SMALL}
        aria-label={label}
        aria-haspopup={Array.isArray(menu) ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={tooltip ?? label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {i !== undefined && icon(i, large ? 24 : 16)}
        {(large || showLabel || i === undefined) && (
          <span className={large ? "flex items-center" : "flex items-center whitespace-nowrap"}>
            {label}
            {!large && <RibbonIcon name="chevronDown" size={12} />}
          </span>
        )}
        {large && <RibbonIcon name="chevronDown" size={10} />}
        {!large && !showLabel && i !== undefined && <RibbonIcon name="chevronDown" size={12} />}
      </button>
      {open && <PopupPanel id={id} label={label} content={menu} close={close} />}
    </div>
  );
}

export interface RibbonSplitButtonProps extends Omit<RibbonButtonProps, "pressed"> {
  /** Menu of the arrow part, or a panel (e.g. a gallery). */
  menu: RibbonPopupContent;
  /** Accessible name of the arrow part (default `"<label> options"`). */
  menuLabel?: string;
}

/** Main action plus an arrow that opens a menu or gallery (Paste ▾, New Slide ▾ …). */
export function RibbonSplitButton({ label, icon: i, size = "small", showLabel, disabled, shortcut, tooltip, onClick, menu, menuLabel }: RibbonSplitButtonProps) {
  const { open, setOpen, root } = usePopup();
  const arrow = useRef<HTMLButtonElement>(null);
  const id = useId();
  const large = size === "large";
  const optionsLabel = menuLabel ?? `${label} options`;
  const close = () => {
    setOpen(false);
    arrow.current?.focus();
  };
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled, setOpen]);
  const arrowButton = (
    <button
      ref={arrow}
      type="button"
      aria-label={optionsLabel}
      aria-haspopup={Array.isArray(menu) ? "menu" : "dialog"}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      title={optionsLabel}
      disabled={disabled}
      className={
        large
          ? `${BASE} flex h-5 w-full items-center justify-center gap-0.5 px-1 text-[11px] leading-3`
          : `${BASE} inline-flex h-6 w-4 items-center justify-center`
      }
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" && !open) {
          e.preventDefault();
          setOpen(true);
        }
      }}
    >
      {large && <span className="whitespace-nowrap">{label}</span>}
      <RibbonIcon name="chevronDown" size={large ? 10 : 12} />
    </button>
  );
  return (
    <div
      ref={root}
      className={`relative flex ${large ? "h-12 flex-col items-stretch" : "items-center"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        className={large ? `${BASE} flex h-7 min-w-11 items-center justify-center px-1` : SMALL}
        aria-label={label}
        title={ribbonTooltip(label, shortcut, tooltip)}
        disabled={disabled}
        onClick={onClick}
      >
        {i !== undefined && icon(i, large ? 24 : 16)}
        {!large && (showLabel || i === undefined) && <span className="whitespace-nowrap">{label}</span>}
      </button>
      {arrowButton}
      {open && <PopupPanel id={id} label={optionsLabel} content={menu} close={close} />}
    </div>
  );
}
