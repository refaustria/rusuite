// Bottom sheets of the compact layout (P10-M2): dialogs, context menus, ribbon popups, popovers and dropdowns slide
// up from the bottom edge, full width, above the on-screen keyboard (`--rs-kb-inset`), with a drag handle (tap or
// drag down to close) and the safe-area inset at the bottom.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n/react";
import { CompactBarContext } from "./useCompact";

/** Focusable elements of a sheet (the drag handle is not one: it is only for pointers). */
export const SHEET_FOCUSABLE =
  'a[href],button:not([disabled]):not([data-sheet-handle]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Dragging the handle down this far (px) closes the sheet. */
export const SHEET_DRAG_CLOSE = 80;

export interface SheetFrameProps {
  onClose: () => void;
  children: ReactNode;
  /** A tap on the dimmed backdrop closes the sheet (default true; dialogs keep it open, like on the desktop). */
  closeOnBackdrop?: boolean;
  testId?: string;
}

/** The backdrop, the sliding panel and its drag handle; the content (with its role) goes inside. */
export function SheetFrame({ onClose, children, closeOnBackdrop = true, testId = "bottom-sheet" }: SheetFrameProps) {
  const t = useT();
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  return (
    <div data-bottom-sheet="" className="fixed inset-x-0 top-0 z-50 flex flex-col justify-end" style={{ bottom: "var(--rs-kb-inset, 0px)" }}>
      <div aria-hidden="true" data-testid={`${testId}-backdrop`} className="absolute inset-0 bg-black/40" onClick={closeOnBackdrop ? () => onCloseRef.current() : undefined} />
      <div
        data-testid={testId}
        className="relative flex max-h-[88%] min-h-0 w-full flex-col rounded-t-xl border-t border-ui-border bg-ui-panel pb-[env(safe-area-inset-bottom)] text-ui-fg shadow-2xl"
        style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <button
          type="button"
          tabIndex={-1}
          data-sheet-handle=""
          data-testid="sheet-handle"
          aria-label={t("compact.closeSheet")}
          className="flex h-7 w-full shrink-0 touch-none items-center justify-center"
          // No focus on the handle: closing must hand the focus back to the opener.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            start.current = e.clientY;
            moved.current = false;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current === null) return;
            const dy = Math.max(0, e.clientY - start.current);
            if (dy > 4) moved.current = true;
            setDrag(dy);
          }}
          onPointerUp={(e) => {
            const dy = start.current === null ? 0 : e.clientY - start.current;
            start.current = null;
            setDrag(0);
            if (moved.current && dy >= SHEET_DRAG_CLOSE) onCloseRef.current();
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
          onClick={() => {
            // A tap closes; a drag that did not go far enough snaps back.
            if (!moved.current) onCloseRef.current();
            moved.current = false;
          }}
        >
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-ui-muted opacity-60" />
        </button>
        {/* A sheet opened from the command bar shows its content full size, not as bar buttons. */}
        <CompactBarContext.Provider value={false}>{children}</CompactBarContext.Provider>
      </div>
    </div>
  );
}

export interface BottomSheetProps {
  /** Accessible name of the sheet. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Role of the content (default `dialog`, modal); `null` for content that brings its own (a menu). */
  role?: "dialog" | "menu" | null;
  id?: string;
  testId?: string;
}

/**
 * A sheet with focus handling: the first focusable element gets the focus when it opens, Escape closes it, and the
 * focus goes back to the element that had it (unless the closing command moved it elsewhere).
 */
export function BottomSheet({ label, onClose, children, role = "dialog", id, testId }: BottomSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const sheet = el?.closest<HTMLElement>("[data-bottom-sheet]") ?? el;
    (el?.querySelector<HTMLElement>(SHEET_FOCUSABLE) ?? el)?.focus();
    return () => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || (sheet?.contains(active) ?? false);
      if (stranded && previous?.isConnected) previous.focus?.();
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <SheetFrame onClose={onClose} testId={testId}>
      <div
        ref={ref}
        id={id}
        role={role ?? undefined}
        aria-modal={role === "dialog" ? true : undefined}
        aria-label={role ? label : undefined}
        tabIndex={-1}
        data-sheet-body=""
        className="min-h-0 flex-1 overflow-auto px-3 pb-3 focus:outline-none"
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </SheetFrame>
  );
}
