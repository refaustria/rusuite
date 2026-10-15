import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

afterEach(cleanup);

function setup(extra: Partial<{ onClose: () => void }> = {}) {
  const picked: string[] = [];
  const items: ContextMenuItem[] = [
    { id: "cut", label: "Cut", shortcut: "Ctrl+X", onSelect: () => picked.push("cut") },
    { id: "copy", label: "Copy", onSelect: () => picked.push("copy") },
    { separator: true },
    { id: "off", label: "Disabled", disabled: true, onSelect: () => picked.push("off") },
    { id: "paste", label: "Paste", onSelect: () => picked.push("paste") },
  ];
  const onClose = extra.onClose ?? vi.fn();
  render(<ContextMenu at={{ x: 10, y: 20 }} label="Cell" items={items} onClose={onClose} />);
  return { picked, onClose };
}

describe("ContextMenu", () => {
  it("renders items, shortcuts and separators at the pointer, focusing the first item", () => {
    setup();
    const menu = screen.getByRole("menu", { name: "Cell" });
    expect(menu.style.left).toBe("10px");
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["CutCtrl+X", "Copy", "Disabled", "Paste"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Cut/ }));
  });

  it("arrow keys skip disabled items and wrap; Home/End jump", () => {
    setup();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Paste");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("CutCtrl+X");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Paste");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Copy");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toBe("CutCtrl+X");
  });

  it("clicking an item closes the menu and runs it", () => {
    const { picked, onClose } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(picked).toEqual(["copy"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc and an outside click close it", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    render(<ContextMenu at={null} label="x" items={[]} onClose={() => {}} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
