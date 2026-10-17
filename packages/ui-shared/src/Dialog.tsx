import { useLayoutEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Modal dialog: focus trap, Esc closes, focus restored on close. */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Layout effect: the focus moves in and back synchronously with the commit that opens/closes the dialog, so a key
  // pressed right after OK/Cancel/Esc reaches the element that opened it (P9-Q1). If the close handler already moved
  // the focus elsewhere (e.g. into the editor), that wins: only a focus left in the dialog (or lost to <body> when the
  // dialog's DOM went away) goes back to the opener.
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    return () => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || (el?.contains(active) ?? false);
      if (stranded && previous?.isConnected) previous.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="min-w-72 rounded-lg border border-ui-border bg-ui-panel p-4 text-ui-fg shadow-xl focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCloseRef.current();
            return;
          }
          if (e.key !== "Tab") return;
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
          if (items.length === 0) {
            e.preventDefault();
            return;
          }
          const first = items[0]!;
          const last = items[items.length - 1]!;
          const active = document.activeElement;
          if (e.shiftKey && (active === first || active === ref.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
