import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";
import { ContextMenu } from "../ContextMenu";
import { Ribbon, visibleTabs, type RibbonTab } from "../ribbon/Ribbon";
import { RibbonButton, RibbonMenuButton, RibbonSplitButton, RibbonStack } from "../ribbon/controls";
import { RibbonGallery } from "../ribbon/gallery";
import { COMPACT_MAX_WIDTH, COMPACT_QUERY, FORCE_COMPACT_EVENT, isCompact, useCompact } from "./useCompact";
import { compactSegments } from "./CommandBar";
import { BottomSheet } from "./BottomSheet";
import { installViewportVars, keyboardInset, readViewport, VISUAL_VIEWPORT_EVENT } from "./visualViewport";
import { installLongPress, LONG_PRESS_MS } from "./longPress";

type W = { __RUSUITE_FORCE_COMPACT__?: boolean; __RUSUITE_VISUAL_VIEWPORT__?: { height?: number; offsetTop?: number } };
const w = window as unknown as W;
const force = (v: boolean | undefined) => {
  if (v === undefined) delete w.__RUSUITE_FORCE_COMPACT__;
  else w.__RUSUITE_FORCE_COMPACT__ = v;
  window.dispatchEvent(new Event(FORCE_COMPACT_EVENT));
};

afterEach(() => {
  cleanup();
  force(undefined);
  delete w.__RUSUITE_VISUAL_VIEWPORT__;
  vi.unstubAllGlobals();
});

describe("useCompact", () => {
  it("is desktop without matchMedia, follows the media query and the test hook", () => {
    expect(COMPACT_MAX_WIDTH).toBe(899);
    expect(COMPACT_QUERY).toBe("(max-width: 899px)");
    expect(isCompact()).toBe(false);
    const listeners = new Set<() => void>();
    let matches = true;
    vi.stubGlobal("matchMedia", (q: string) => ({
      media: q,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }));
    const { result } = renderHook(() => useCompact());
    expect(result.current).toBe(true);
    act(() => {
      matches = false;
      listeners.forEach((f) => f());
    });
    expect(result.current).toBe(false);
    act(() => force(true));
    expect(result.current).toBe(true);
    act(() => force(false));
    matches = true;
    expect(isCompact()).toBe(false);
  });
});

function tabs(onBold = vi.fn(), onPaste = vi.fn()): RibbonTab[] {
  return [
    {
      id: "home",
      label: "Home",
      groups: [
        {
          label: "Clipboard",
          items: (
            <>
              <RibbonSplitButton label="Paste" icon="paste" size="large" onClick={onPaste} menu={[{ id: "values", label: "Paste values", onSelect: () => {} }]} />
              <RibbonStack>
                <RibbonButton label="Cut" icon="cut" onClick={() => {}} />
                <RibbonButton label="Copy" icon="copy" disabled onClick={() => {}} />
              </RibbonStack>
            </>
          ),
        },
        { label: "Font", items: <RibbonButton label="Bold" pressed onClick={onBold} /> },
        { label: "Nothing", items: null },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      groups: [
        { label: "Sheets", items: <RibbonMenuButton label="Sheet" icon="sheet" menu={[{ id: "new", label: "New sheet", onSelect: () => {} }]} /> },
        { label: "Styles", items: <RibbonGallery label="Quick styles" items={[{ id: "a", label: "Style A", preview: <span>A</span> }]} onSelect={() => {}} /> },
      ],
    },
    { id: "empty", label: "Empty", groups: [{ label: "None", items: [] }] },
  ];
}

describe("compactSegments", () => {
  it("keeps every visible group of a tab in ribbon order", () => {
    const shown = visibleTabs(tabs());
    expect(shown.map((t) => t.id)).toEqual(["home", "insert"]);
    expect(compactSegments(shown[0]!).map((s) => [s.tabId, s.index, s.label])).toEqual([
      ["home", 0, "Clipboard"],
      ["home", 1, "Font"],
    ]);
  });
});

describe("compact ribbon", () => {
  beforeEach(() => force(true));

  it("replaces the ribbon with the top bar and the command bar (chips per tab, every control)", () => {
    const onBold = vi.fn();
    const onUndo = vi.fn();
    render(
      <Ribbon
        tabs={tabs(onBold)}
        appName="Rusuite Calc"
        documentTitle="Book1.xlsx"
        backstage={{ onSave: () => {} }}
        undo={{ canUndo: true, canRedo: false, onUndo, onRedo: () => {} }}
      />,
    );
    expect(screen.queryByTestId("ribbon")).toBeNull();
    expect(document.documentElement.hasAttribute("data-compact")).toBe(true);
    expect(screen.getByTestId("compact-title").textContent).toBe("Book1.xlsx");
    fireEvent.click(screen.getByTestId("compact-undo"));
    expect(onUndo).toHaveBeenCalled();
    expect((screen.getByTestId("compact-redo") as HTMLButtonElement).disabled).toBe(true);
    const chips = within(screen.getByTestId("command-tabs")).getAllByRole("tab");
    expect(chips.map((c) => c.textContent)).toEqual(["Home", "Insert"]);
    const strip = screen.getByRole("toolbar", { name: "Home" });
    expect(within(strip).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Clipboard", "Font"]);
    for (const name of ["Paste", "Cut", "Copy", "Bold"]) expect(within(strip).getByRole("button", { name })).toBeTruthy();
    // Toggles show their state, disabled controls stay disabled.
    expect(within(strip).getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect((within(strip).getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(strip).getByRole("button", { name: "Bold" }));
    expect(onBold).toHaveBeenCalled();
    fireEvent.click(chips[1]!);
    const insert = screen.getByRole("toolbar", { name: "Insert" });
    expect(within(insert).getByRole("button", { name: "Sheet" })).toBeTruthy();
    // An inline gallery opens from a button as a sheet.
    fireEvent.click(within(insert).getByRole("button", { name: "Quick styles" }));
    expect(within(screen.getByTestId("popup-sheet")).getByRole("button", { name: "Style A" })).toBeTruthy();
  });

  it("a split button's sheet starts with its main action", () => {
    const onPaste = vi.fn();
    render(<Ribbon tabs={tabs(vi.fn(), onPaste)} appName="Rusuite Calc" />);
    const paste = screen.getByRole("button", { name: "Paste" });
    expect(paste.getAttribute("data-split-menu")).toBe("Paste options");
    fireEvent.click(paste);
    const sheet = screen.getByRole("dialog", { name: "Paste options" });
    expect(within(sheet).getByRole("menuitem", { name: "Paste values" })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Paste" }));
    expect(onPaste).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Paste options" })).toBeNull();
    expect(document.activeElement).toBe(paste);
  });

  it("File opens the backstage full screen; the overflow sheet has the options and the language", () => {
    const onOptions = vi.fn();
    render(<Ribbon tabs={tabs()} appName="Rusuite Calc" backstage={{ onSave: () => {}, onOptions }} />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByTestId("backstage")).toBeTruthy();
    fireEvent.click(screen.getByTestId("backstage-back"));
    expect(screen.queryByTestId("backstage")).toBeNull();
    fireEvent.click(screen.getByTestId("compact-more"));
    const sheet = screen.getByTestId("compact-more-sheet");
    expect(within(sheet).getByTestId("language-select")).toBeTruthy();
    fireEvent.click(within(sheet).getByTestId("compact-more-options"));
    expect(onOptions).toHaveBeenCalled();
  });

  it("hides Print and Export PDF when the backend cannot print", () => {
    const state = { recent: [], keepAutosave: true };
    const session = {
      backend: { capabilities: { print: false } },
      ai: null,
      connectors: null,
      storage: null,
      subscribe: () => () => {},
      getState: () => state,
      refresh: async () => {},
      canSaveRemote: () => false,
    } as never;
    render(<Ribbon tabs={tabs()} appName="Rusuite Calc" backstage={{ session, onSave: () => {}, onExportPdf: () => {}, print: <div /> }} />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    const backstage = screen.getByTestId("backstage");
    expect(within(backstage).queryByRole("button", { name: /Print|PDF/ })).toBeNull();
    expect(within(backstage).getByRole("button", { name: /^Save/ })).toBeTruthy();
  });
});

describe("BottomSheet", () => {
  it("focuses its first control (not the handle), Escape and the handle close it, the focus goes back", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <BottomSheet label="Sheet" onClose={() => setOpen(false)}>
              <button>First</button>
              <button>Second</button>
            </BottomSheet>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Sheet" }).getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("First");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByTestId("sheet-handle"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByTestId("bottom-sheet-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the handle is dragged down far enough, not when it snaps back", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet label="Sheet" onClose={onClose}>
        <button>First</button>
      </BottomSheet>,
    );
    const handle = screen.getByTestId("sheet-handle");
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 130, pointerId: 1 });
    fireEvent.click(handle);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 220, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("dialogs and menus as sheets", () => {
  beforeEach(() => force(true));

  it("Dialog: a sheet with the same role and focus handling; the handle returns the focus", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Format</button>
          <Dialog open={open} title="Number format" onClose={() => setOpen(false)}>
            <input aria-label="Decimals" />
            <div className="flex justify-end gap-2">
              <button>OK</button>
            </div>
          </Dialog>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Format" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId("dialog-sheet")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Number format" }).getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Decimals" }));
    // The backdrop does not close a dialog (as on the desktop); the handle does.
    fireEvent.click(screen.getByTestId("dialog-sheet-backdrop"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("sheet-handle"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("ContextMenu: the same items in a sheet", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu at={{ x: 10, y: 10 }} label="Cell" items={[{ id: "cut", label: "Cut", onSelect }, { separator: true }, { id: "copy", label: "Copy", onSelect }]} onClose={onClose} />);
    const sheet = screen.getByTestId("context-sheet");
    expect(within(sheet).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Cut", "Copy"]);
    fireEvent.click(within(sheet).getByRole("menuitem", { name: "Copy" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("visual viewport", () => {
  it("publishes the visible area and the keyboard inset as CSS variables", () => {
    const root = document.createElement("div");
    const stop = installViewportVars(root);
    expect(root.style.getPropertyValue("--rs-kb-inset")).toBe("0px");
    w.__RUSUITE_VISUAL_VIEWPORT__ = { height: window.innerHeight - 300, offsetTop: 0 };
    window.dispatchEvent(new Event(VISUAL_VIEWPORT_EVENT));
    expect(readViewport().height).toBe(window.innerHeight - 300);
    expect(keyboardInset(readViewport())).toBe(300);
    expect(root.style.getPropertyValue("--rs-kb-inset")).toBe("300px");
    expect(root.style.getPropertyValue("--rs-vv-height")).toBe(`${window.innerHeight - 300}px`);
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    stop();
    expect(root.style.getPropertyValue("--rs-kb-inset")).toBe("");
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });
});

describe("long press", () => {
  it("a touch held still fires one contextmenu at the point; a moving touch does not", () => {
    vi.useFakeTimers();
    const stop = installLongPress();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const menus: MouseEvent[] = [];
    el.addEventListener("contextmenu", (e) => menus.push(e));
    const pointer = (type: string, x: number, y: number) =>
      el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), { pointerType: "touch", isPrimary: true, pointerId: 7 }));
    pointer("pointerdown", 20, 30);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(menus.length).toBe(1);
    expect([menus[0]!.clientX, menus[0]!.clientY]).toEqual([20, 30]);
    pointer("pointerup", 20, 30);
    pointer("pointerdown", 20, 30);
    pointer("pointermove", 60, 30);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(menus.length).toBe(1);
    stop();
    el.remove();
    vi.useRealTimers();
  });
});
