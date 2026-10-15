// Sheet tabs: click switches, double-click (or the context menu's
// Rename) renames inline, "+" adds.

import { useRef, useState } from "react";
import { ContextMenu } from "@rusuite/ui-shared";
import { useCalc, type CalcStore } from "./state/store";

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

  const finish = (commit: boolean) => {
    const r = current.current;
    if (!r) return;
    setRenaming(null);
    if (commit) void store.renameSheet(r.id, r.name);
    store.focusGrid();
  };

  return (
    <div role="tablist" aria-label="Sheets" className="flex items-stretch gap-0.5 border-t border-ui-border bg-ui-panel px-2 text-sm text-ui-fg">
      {sheets.map((s) =>
        renaming?.id === s.id ? (
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
            aria-selected={s.id === active}
            className={`border-x border-b-2 px-3 py-1 ${
              s.id === active ? "border-x-ui-border border-b-[#217346] bg-ui-bg font-medium" : "border-transparent hover:bg-ui-hover"
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
          >
            {s.name}
          </button>
        ),
      )}
      <button type="button" aria-label="Add sheet" className="px-2 py-1 hover:bg-ui-hover" onClick={() => void store.addSheet()}>
        +
      </button>
      <ContextMenu
        at={menu?.at ?? null}
        label="Sheet"
        items={
          menu
            ? [
                { id: "rename", label: "Rename", onSelect: () => setRenaming({ id: menu.id, name: menu.name }) },
                { id: "insert", label: "Insert sheet", onSelect: () => void store.addSheet() },
              ]
            : []
        }
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
