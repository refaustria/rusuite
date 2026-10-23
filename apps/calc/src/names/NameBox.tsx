// The Name Box (P8-23): Excel's combobox left of the formula bar. It shows
// the active cell's address (or the name of a selected named range);
// typing a reference or a name and Enter goes there, any other valid name
// is defined for the selection; the ▾ list holds the names and navigates.

import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

/** `compact` (P10-M3): a 44 px chip; a tap edits it (the keyboard opens), the ▾ list stays next to it. */
export function NameBox({ store, address, compact = false }: { store: CalcStore; address: string; compact?: boolean }) {
  const t = useT();
  useCalc(store, (s) => s.info?.names);
  useCalc(store, (s) => s.selection);
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = store.names.selectionName() ?? address;
  const names = store.names.boxNames();
  useEffect(() => {
    if (!open) setActive(0);
  }, [open]);

  const leave = () => {
    setText(null);
    setOpen(false);
    store.focusGrid();
  };
  const go = (value: string) => {
    void store.names.boxEnter(value).then((ok) => {
      if (ok) leave();
      else input.current?.select();
    });
  };

  return (
    <div className={`relative flex shrink-0 ${compact ? "w-[124px]" : "w-36"}`} data-testid="name-box" data-chip={compact ? "" : undefined}>
      <input
        ref={input}
        role="combobox"
        aria-label={t("calc.nameBox")}
        aria-expanded={open}
        aria-controls="calc-name-list"
        aria-autocomplete="list"
        data-testid="cell-address"
        spellCheck={false}
        autoComplete="off"
        className={`min-w-0 flex-1 border border-ui-border font-mono text-ui-fg outline-none focus:border-ui-focus ${
          compact ? "h-11 !min-w-0 rounded-l-full bg-ui-panel pl-3 pr-1 text-center text-sm focus:bg-ui-bg" : "h-6 rounded-l bg-ui-bg px-2 text-sm"
        }`}
        value={text ?? shown}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          setText(null);
          setOpen(false);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && names[active] && text === null) go(names[active]!.name);
            else go(text ?? shown);
          } else if (e.key === "Escape") {
            e.preventDefault();
            leave();
          } else if (e.key === "ArrowDown" && (e.altKey || open || names.length > 0)) {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActive((i) => Math.min(names.length - 1, i + 1));
          } else if (e.key === "ArrowUp" && open) {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          }
        }}
      />
      <button
        type="button"
        aria-label={t("calc.nameBoxList")}
        title={t("calc.nameBoxList")}
        className={`border border-l-0 border-ui-border text-xs text-ui-muted hover:bg-ui-hover ${compact ? "h-11 rounded-r-full bg-ui-panel pr-1" : "h-6 rounded-r bg-ui-bg px-1"}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((o) => !o);
          input.current?.focus();
        }}
      >
        ▾
      </button>
      {open && (
        <ul
          id="calc-name-list"
          role="listbox"
          aria-label={t("calc.names.list")}
          data-testid="name-list"
          className="absolute left-0 top-7 z-40 max-h-64 min-w-full overflow-auto rounded border border-ui-border bg-ui-panel py-1 text-sm shadow-lg"
        >
          {names.length === 0 && <li className="px-2 py-0.5 text-ui-muted">{t("calc.names.none")}</li>}
          {names.map((n, i) => (
            <li
              key={`${n.sheet ?? ""}:${n.name}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-default px-2 py-0.5 font-mono ${i === active ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onMouseDown={(e) => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => {
                if (store.names.goTo(n.name)) leave();
              }}
            >
              {n.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
