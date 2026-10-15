import { useEffect, useRef, type ReactNode } from "react";
import { FOCUS_RING, Popover } from "./Popover";

export interface DropdownItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface DropdownProps<T extends string> {
  label: string;
  disabled?: boolean;
  trigger: ReactNode;
  items: DropdownItem<T>[];
  onSelect: (value: T) => void;
}

function Menu<T extends string>({
  items,
  label,
  onPick,
}: {
  items: DropdownItem<T>[];
  label: string;
  onPick: (v: T) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  useEffect(() => buttons()[0]?.focus(), []);
  return (
    <ul
      ref={ref}
      role="presentation"
      aria-label={label}
      className="flex min-w-36 flex-col"
      onKeyDown={(e) => {
        const b = buttons();
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") b[(i + 1) % b.length]?.focus();
        else if (e.key === "ArrowUp") b[(i - 1 + b.length) % b.length]?.focus();
        else return;
        e.preventDefault();
      }}
    >
      {items.map((it) => (
        <li key={it.value} role="none">
          <button
            type="button"
            role="menuitem"
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-ui-fg hover:bg-ui-hover ${FOCUS_RING}`}
            onClick={() => onPick(it.value)}
          >
            {it.icon}
            {it.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Button that opens a keyboard-navigable (arrow keys) menu. */
export function Dropdown<T extends string>({ label, disabled, trigger, items, onSelect }: DropdownProps<T>) {
  return (
    <Popover label={label} disabled={disabled} trigger={trigger} role="menu">
      {(close) => (
        <Menu
          items={items}
          label={label}
          onPick={(v) => {
            onSelect(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}
