// Galleries: a grid of choices with previews (paragraph styles, slide
// layouts, shapes), shown inline in a group or in a dropdown, and the
// rows × columns table size picker.

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { RibbonMenuButton, type RibbonButtonSize } from "./controls";
import type { RibbonIconName } from "./icons";
import { useT } from "../i18n/react";

export interface RibbonGalleryItem {
  id: string;
  label: string;
  /** Visual preview; the label is shown under it unless `hideLabels`. */
  preview: ReactNode;
  disabled?: boolean;
}

export interface RibbonGalleryProps {
  /** Accessible name of the gallery (and of the dropdown button). */
  label: string;
  items: RibbonGalleryItem[];
  /** Id of the current choice (`aria-pressed`). */
  selected?: string;
  onSelect: (id: string) => void;
  /** Grid columns (default: one row inline, 3 in a dropdown). */
  columns?: number;
  /** `inline`: the grid sits in the group; `dropdown`: a button opens it. */
  variant?: "inline" | "dropdown";
  /** Dropdown variant: trigger icon and size. */
  icon?: RibbonIconName | ReactNode;
  size?: RibbonButtonSize;
  disabled?: boolean;
  /** Item size class (default fits two-row small items inline). */
  itemClassName?: string;
  hideLabels?: boolean;
  /** Inline variant: focus the selected (else first) item on mount, e.g. inside a split button's panel. */
  autoFocus?: boolean;
}

/** Arrow-key movement inside a grid of buttons (`cols` per row). */
function gridKeys(e: KeyboardEvent, root: HTMLElement | null, cols: number) {
  const all = Array.from(root?.querySelectorAll<HTMLButtonElement>("button[data-gallery-item]:not([disabled])") ?? []);
  const i = all.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const d = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[e.key];
  let n: number | undefined;
  if (d !== undefined) n = i + d;
  else if (e.key === "Home") n = 0;
  else if (e.key === "End") n = all.length - 1;
  if (n === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  if (n >= 0 && n < all.length) all[n]!.focus();
}

function GalleryGrid({
  label, items, selected, onPick, columns, itemClassName, hideLabels, disabled, autoFocus,
}: {
  label: string;
  items: RibbonGalleryItem[];
  selected?: string;
  onPick: (id: string) => void;
  columns: number;
  itemClassName: string;
  hideLabels?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = items.findIndex((it) => it.id === selected);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, auto))` }}
      onKeyDown={(e) => gridKeys(e, ref.current, columns)}
    >
      {items.map((it, n) => (
        <button
          key={it.id}
          type="button"
          data-gallery-item=""
          aria-label={it.label}
          aria-pressed={selected === undefined ? undefined : it.id === selected}
          title={it.label}
          disabled={disabled || it.disabled}
          autoFocus={autoFocus && n === Math.max(0, first)}
          className={`flex flex-col items-center justify-center overflow-hidden rounded border border-transparent text-ui-fg hover:border-ui-border hover:bg-ui-hover disabled:opacity-40 aria-pressed:border-ui-focus aria-pressed:bg-ui-active ${FOCUS_RING} ${itemClassName}`}
          onClick={() => onPick(it.id)}
        >
          {it.preview}
          {!hideLabels && <span className="max-w-full truncate text-[10px] leading-3">{it.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** A grid of choices (inline in the group, or in a dropdown). */
export function RibbonGallery({
  label, items, selected, onSelect, columns, variant = "inline", icon, size = "large", disabled, itemClassName, hideLabels, autoFocus,
}: RibbonGalleryProps) {
  if (variant === "inline") {
    return (
      <GalleryGrid
        label={label}
        items={items}
        selected={selected}
        onPick={onSelect}
        columns={columns ?? items.length}
        itemClassName={itemClassName ?? "h-12 w-14"}
        hideLabels={hideLabels}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    );
  }
  return (
    <RibbonMenuButton
      label={label}
      icon={icon}
      size={size}
      disabled={disabled}
      menu={(close) => (
        <GalleryGrid
          label={label}
          items={items}
          selected={selected}
          onPick={(id) => {
            close();
            onSelect(id);
          }}
          columns={columns ?? 3}
          itemClassName={itemClassName ?? "h-20 w-24 p-1"}
          hideLabels={hideLabels}
          autoFocus
        />
      )}
    />
  );
}

export interface RibbonTableSizePickerProps {
  /** Grid size offered (default 8 × 8). */
  maxRows?: number;
  maxCols?: number;
  onPick: (rows: number, cols: number) => void;
}

/** Rows × columns picker: hovering/focusing a cell highlights the table size. */
export function RibbonTableSizePicker({ maxRows = 8, maxCols = 8, onPick }: RibbonTableSizePickerProps) {
  const t = useT();
  const [at, setAt] = useState({ r: 1, c: 1 });
  const ref = useRef<HTMLDivElement>(null);
  const cells: ReactNode[] = [];
  for (let r = 1; r <= maxRows; r++) {
    for (let c = 1; c <= maxCols; c++) {
      const on = r <= at.r && c <= at.c;
      cells.push(
        <button
          key={`${r}x${c}`}
          type="button"
          data-gallery-item=""
          aria-label={t("table.size", { rows: r, cols: c })}
          autoFocus={r === 1 && c === 1}
          className={`h-4 w-4 rounded-[2px] border ${on ? "border-ui-focus bg-ui-active" : "border-ui-border bg-ui-bg"} ${FOCUS_RING}`}
          onMouseEnter={() => setAt({ r, c })}
          onFocus={() => setAt({ r, c })}
          onClick={() => onPick(r, c)}
        />,
      );
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-ui-muted" aria-live="polite" data-testid="table-size">
        {t("table.size", { rows: at.r, cols: at.c })}
      </div>
      <div
        ref={ref}
        role="group"
        aria-label={t("table.sizeLabel")}
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${maxCols}, 1rem)` }}
        onKeyDown={(e) => gridKeys(e, ref.current, maxCols)}
      >
        {cells}
      </div>
    </div>
  );
}
