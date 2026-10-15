import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-focus";
export const BTN =
  `inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded px-1 text-ui-fg hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-ui-active ${FOCUS_RING}`;

export interface PopoverProps {
  label: string;
  disabled?: boolean;
  /** Trigger content. */
  trigger: ReactNode;
  /** Panel content; `close` closes the popover and restores focus. */
  children: (close: () => void) => ReactNode;
  role?: "dialog" | "menu";
}

/** Button + floating panel; closes on Esc and outside click. */
export function Popover({ label, disabled, trigger, children, role = "dialog" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={root}
      className="relative inline-block"
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
        className={BTN}
        aria-label={label}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role={role}
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 rounded border border-ui-border bg-ui-panel p-2 shadow-lg"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
