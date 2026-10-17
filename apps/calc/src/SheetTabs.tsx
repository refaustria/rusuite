// Sheet tabs: click switches, double-click (or the context menu's
// Rename) renames inline, "+" adds, drag reorders; the context menu also
// inserts, deletes, duplicates, moves and recolours sheets. A coloured
// tab shows its colour as an underline.

import { useRef, useState } from "react";
import { ContextMenu, cssColor, OFFICE_THEME, type ContextMenuItem } from "@rusuite/ui-shared";
import { unhideableSheets, useCalc, visibleSheets, type CalcStore } from "./state/store";
import { t, useT } from "./i18n";
import { sheetProtection, toggleSheetProtection } from "./protection/protection";

/** The sheet commands shared by the tab context menu and the ribbon (acting on `sheet`). */
export function sheetMenu(store: CalcStore, sheet: number, rename: () => void): ContextMenuItem[] {
  const sheets = visibleSheets(store.getState().info?.sheets ?? []);
  const hidden = unhideableSheets(store.getState().info?.sheets ?? []);
  // Positions among the tabs (hidden sheets have none).
  const at = sheets.findIndex((s) => s.id === sheet);
  const item = (id: string, label: string, run: () => unknown, extra: { shortcut?: string; disabled?: boolean } = {}): ContextMenuItem => ({
    id,
    label,
    ...extra,
    onSelect: () => void run(),
  });
  return [
    item("insert", t("calc.insertSheet"), () => store.insertSheet(sheet), { shortcut: "Shift+F11" }),
    item("delete", t("calc.deleteSheet"), () => store.deleteSheet(sheet), { disabled: sheets.length <= 1 }),
    item("rename", t("calc.rename.confirm"), rename),
    item("duplicate", t("calc.duplicate"), () => store.duplicateSheet(sheet)),
    item("move-copy", t("calc.moveCopy.dots"), () => store.openDialog({ kind: "moveCopy", sheet })),
    { separator: true },
    item("move-left", t("calc.moveLeft"), () => store.moveSheetBy(sheet, -1), { disabled: at <= 0 }),
    item("move-right", t("calc.moveRight"), () => store.moveSheetBy(sheet, 1), { disabled: at < 0 || at >= sheets.length - 1 }),
    { separator: true },
    item("tab-color", t("calc.tabColorDots"), () => store.openDialog({ kind: "tabColor", sheet })),
    { separator: true },
    item("hide", t("calc.hide"), () => store.hideSheet(sheet), { disabled: sheets.length <= 1 }),
    item("unhide", t("calc.unhideDots"), () => store.openDialog({ kind: "unhideSheet" }), { disabled: hidden.length === 0 }),
    { separator: true },
    item("protect", sheetProtection(store, sheet) ? t("calc.protect.unprotectSheetDots") : t("calc.protect.sheetDots"), () => toggleSheetProtection(store, sheet)),
  ];
}

export function SheetTabs({ store }: { store: CalcStore }) {
  const t = useT();
  const all = useCalc(store, (s) => s.info?.sheets) ?? [];
  // Hidden sheets get no tab; drag positions are mapped back to the full order.
  const sheets = visibleSheets(all);
  const active = useCalc(store, (s) => s.activeSheet);
  const [renaming, setRenamingState] = useState<{ id: number; name: string } | null>(null);
  // Mirrors `renaming` so Enter followed by the unmount blur commits once.
  const current = useRef(renaming);
  const setRenaming = (r: typeof renaming) => {
    current.current = r;
    setRenamingState(r);
  };

  const [menu, setMenu] = useState<{ at: { x: number; y: number }; id: number; name: string } | null>(null);
  /** The tab being dragged, and the tab position a drop would move it to. */
  const dragged = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const finish = (commit: boolean) => {
    const r = current.current;
    if (!r) return;
    setRenaming(null);
    if (commit) void store.renameSheet(r.id, r.name);
    store.focusGrid();
  };

  /** Drop position for a pointer at `clientX` over tab `index`: before or after it. */
  const targetOf = (e: React.DragEvent<HTMLElement>, index: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    return box.width > 0 && e.clientX > box.left + box.width / 2 ? index + 1 : index;
  };

  return (
    <div role="tablist" aria-label={t("calc.sheets")} className="flex items-stretch gap-0.5 border-t border-ui-border bg-ui-panel px-2 text-sm text-ui-fg">
      {sheets.map((s, index) => {
        const color = s.tabColor ? cssColor(s.tabColor, OFFICE_THEME) : undefined;
        // Excel: an inactive coloured tab is filled with its colour; the active one shows it as a bar.
        const filled = color && s.id !== active ? { background: color, color: readableOn(color) } : undefined;
        return renaming?.id === s.id ? (
          <input
            key={s.id}
            aria-label={t("calc.sheetName")}
            autoFocus
            className="w-28 border border-ui-focus bg-ui-bg px-2 outline-none"
            value={renaming.name}
            onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish(true);
              else if (e.key === "Escape") finish(false);
            }}
          />
        ) : (
          <button
            key={s.id}
            type="button"
            role="tab"
            draggable
            aria-selected={s.id === active}
            className={`relative border-x border-b-2 px-3 py-1 ${
              s.id === active ? "border-x-ui-border border-b-[#217346] bg-ui-bg font-medium" : "border-transparent hover:bg-ui-hover"
            } ${dropAt === index ? "shadow-[inset_2px_0_0_#217346]" : ""} ${
              dropAt === index + 1 && index === sheets.length - 1 ? "shadow-[inset_-2px_0_0_#217346]" : ""
            }`}
            style={filled}
            data-tab-fill={filled ? "" : undefined}
            onClick={() => {
              store.setActiveSheet(s.id);
              store.focusGrid();
            }}
            onDoubleClick={() => setRenaming({ id: s.id, name: s.name })}
            onContextMenu={(e) => {
              e.preventDefault();
              store.setActiveSheet(s.id);
              setMenu({ at: { x: e.clientX, y: e.clientY }, id: s.id, name: s.name });
            }}
            onDragStart={(e) => {
              dragged.current = s.id;
              if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", s.name);
                e.dataTransfer.effectAllowed = "move";
              }
            }}
            onDragOver={(e) => {
              if (dragged.current === null) return;
              e.preventDefault();
              setDropAt(targetOf(e, index));
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragged.current;
              const target = targetOf(e, index);
              dragged.current = null;
              setDropAt(null);
              if (id === null) return;
              const from = all.findIndex((x) => x.id === id);
              const to = target < sheets.length ? all.findIndex((x) => x.id === sheets[target]!.id) : all.length;
              // Positions count after the dragged tab is taken out.
              void store.moveSheet(id, to > from ? to - 1 : to);
            }}
            onDragEnd={() => {
              dragged.current = null;
              setDropAt(null);
            }}
          >
            {s.name}
            {color && !filled && <span data-testid="tab-color" aria-hidden className="absolute inset-x-1 bottom-0 h-[3px] rounded-sm" style={{ background: color }} />}
          </button>
        );
      })}
      <button type="button" aria-label={t("calc.addSheet")} className="px-2 py-1 hover:bg-ui-hover" onClick={() => void store.addSheet()}>
        +
      </button>
      <ContextMenu
        at={menu?.at ?? null}
        label={t("calc.sheet")}
        items={menu ? sheetMenu(store, menu.id, () => setRenaming({ id: menu.id, name: menu.name })) : []}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

/** Black or white text on a `#RRGGBB` background (WCAG relative luminance). */
export function readableOn(css: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css);
  if (!m) return "#000000";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h!, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? "#000000" : "#ffffff";
}
