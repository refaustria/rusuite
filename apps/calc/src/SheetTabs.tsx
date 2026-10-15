// Sheet tabs: click switches, double-click (or the context menu's
// Rename) renames inline, "+" adds, drag reorders; the context menu also
// inserts, deletes, duplicates, moves and recolours sheets. A coloured
// tab shows its colour as an underline.

import { useRef, useState } from "react";
import { ContextMenu, cssColor, OFFICE_THEME, type ContextMenuItem } from "@rusuite/ui-shared";
import { useCalc, type CalcStore } from "./state/store";

/** The sheet commands shared by the tab context menu and the ribbon (acting on `sheet`). */
export function sheetMenu(store: CalcStore, sheet: number, rename: () => void): ContextMenuItem[] {
  const sheets = store.getState().info?.sheets ?? [];
  const at = sheets.findIndex((s) => s.id === sheet);
  const item = (id: string, label: string, run: () => unknown, extra: { shortcut?: string; disabled?: boolean } = {}): ContextMenuItem => ({
    id,
    label,
    ...extra,
    onSelect: () => void run(),
  });
  return [
    item("insert", "Insert sheet", () => store.insertSheet(sheet), { shortcut: "Shift+F11" }),
    item("delete", "Delete sheet", () => store.deleteSheet(sheet), { disabled: sheets.length <= 1 }),
    item("rename", "Rename", rename),
    item("duplicate", "Duplicate", () => store.duplicateSheet(sheet)),
    { separator: true },
    item("move-left", "Move left", () => store.moveSheetBy(sheet, -1), { disabled: at <= 0 }),
    item("move-right", "Move right", () => store.moveSheetBy(sheet, 1), { disabled: at < 0 || at >= sheets.length - 1 }),
    { separator: true },
    item("tab-color", "Tab colour…", () => store.openDialog({ kind: "tabColor", sheet })),
  ];
}

export function SheetTabs({ store }: { store: CalcStore }) {
  const sheets = useCalc(store, (s) => s.info?.sheets) ?? [];
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
    <div role="tablist" aria-label="Sheets" className="flex items-stretch gap-0.5 border-t border-ui-border bg-ui-panel px-2 text-sm text-ui-fg">
      {sheets.map((s, index) => {
        const color = s.tabColor ? cssColor(s.tabColor, OFFICE_THEME) : undefined;
        return renaming?.id === s.id ? (
          <input
            key={s.id}
            aria-label="Sheet name"
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
              const from = sheets.findIndex((x) => x.id === id);
              // Positions count after the dragged tab is taken out.
              void store.moveSheet(id, target > from ? target - 1 : target);
            }}
            onDragEnd={() => {
              dragged.current = null;
              setDropAt(null);
            }}
          >
            {s.name}
            {color && <span data-testid="tab-color" aria-hidden className="absolute inset-x-1 bottom-0 h-[3px] rounded-sm" style={{ background: color }} />}
          </button>
        );
      })}
      <button type="button" aria-label="Add sheet" className="px-2 py-1 hover:bg-ui-hover" onClick={() => void store.addSheet()}>
        +
      </button>
      <ContextMenu
        at={menu?.at ?? null}
        label="Sheet"
        items={menu ? sheetMenu(store, menu.id, () => setRenaming({ id: menu.id, name: menu.name })) : []}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
