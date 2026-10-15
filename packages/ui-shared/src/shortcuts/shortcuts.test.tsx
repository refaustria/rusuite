import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { canonicalCombo, eventCombo, formatCombo } from "./keys";
import { ShortcutHelp, helpSections } from "./ShortcutHelp";
import { PromptDialog, withExtension } from "./PromptDialog";
import { useShortcuts, type ShortcutMap } from "./useShortcuts";

afterEach(cleanup);

function press(init: KeyboardEventInit, target: Element | Window = window) {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  (target as EventTarget).dispatchEvent(e);
  return e;
}

describe("combos", () => {
  it("canonicalises specs regardless of order and case", () => {
    expect(canonicalCombo("Shift+Mod+s")).toBe("mod+shift+s");
    expect(canonicalCombo("Ctrl+Alt+1")).toBe("mod+alt+1");
    expect(canonicalCombo("Mod+Plus")).toBe("mod+plus");
  });

  it("maps events to the same form", () => {
    expect(eventCombo({ key: "S", ctrlKey: true, shiftKey: true })).toBe("mod+shift+s");
    expect(eventCombo({ key: "s", metaKey: true })).toBe("mod+s");
    expect(eventCombo({ key: "¡", code: "Digit1", ctrlKey: true, altKey: true })).toBe("mod+alt+1");
    expect(eventCombo({ key: "+", ctrlKey: true, shiftKey: true })).toBe("mod+plus");
    expect(eventCombo({ key: "=", code: "Equal", ctrlKey: true })).toBe("mod+plus");
    expect(eventCombo({ key: "-", ctrlKey: true })).toBe("mod+minus");
    expect(eventCombo({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true })).toBe("mod+shift+]");
    expect(eventCombo({ key: " ", ctrlKey: true })).toBe("mod+space");
    expect(eventCombo({ key: "F5", shiftKey: true })).toBe("shift+f5");
    expect(eventCombo({ key: "/", ctrlKey: true })).toBe("mod+/");
    expect(eventCombo({ key: "ArrowLeft", ctrlKey: true, shiftKey: true })).toBe("mod+shift+arrowleft");
  });

  it("formats for display", () => {
    expect(formatCombo("Mod+Shift+S", false)).toBe("Ctrl+Shift+S");
    expect(formatCombo("Mod+Plus", false)).toBe("Ctrl++");
    expect(formatCombo("Mod+S", true)).toBe("⌘+S");
    expect(formatCombo("Shift+ArrowLeft", false)).toBe("Shift+←");
  });
});

describe("useShortcuts", () => {
  const mount = (map: ShortcutMap, enabled = true) => renderHook(({ m, on }) => useShortcuts(m, { enabled: on }), { initialProps: { m: map, on: enabled } });

  it("runs the bound handler and prevents the browser default", () => {
    const run = vi.fn();
    mount({ "Mod+S": { label: "Save", run } });
    const e = press({ key: "s", ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("distinguishes Shift variants", () => {
    const save = vi.fn();
    const saveAs = vi.fn();
    mount({ "Mod+S": { label: "Save", run: save }, "Mod+Shift+S": { label: "Save as", run: saveAs } });
    press({ key: "S", ctrlKey: true, shiftKey: true });
    expect(saveAs).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it("treats Cmd like Ctrl", () => {
    const run = vi.fn();
    mount({ "Mod+O": { label: "Open", run } });
    press({ key: "o", metaKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("leaves unbound keys and a plain letter alone", () => {
    const run = vi.fn();
    mount({ "Mod+S": { label: "Save", run } });
    expect(press({ key: "s" }).defaultPrevented).toBe(false);
    expect(press({ key: "x", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the default when the handler returns false", () => {
    mount({ "Delete": { label: "Delete", run: () => false } });
    expect(press({ key: "Delete" }).defaultPrevented).toBe(false);
  });

  it("skips text fields unless the entry opts in", () => {
    const plain = vi.fn();
    const field = vi.fn();
    mount({ "Mod+B": { label: "Bold", run: plain }, "Mod+S": { label: "Save", run: field, inField: true } });
    const input = document.createElement("input");
    document.body.append(input);
    press({ key: "b", ctrlKey: true }, input);
    press({ key: "s", ctrlKey: true }, input);
    expect(plain).not.toHaveBeenCalled();
    expect(field).toHaveBeenCalledOnce();
    input.remove();
  });

  it("skips contenteditable and dialog targets", () => {
    const run = vi.fn();
    mount({ "Delete": { label: "Delete", run } });
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.append(div, dlg);
    press({ key: "Delete" }, div);
    press({ key: "Delete" }, dlg);
    expect(run).not.toHaveBeenCalled();
    div.remove();
    dlg.remove();
  });

  it("honours the when guard", () => {
    const run = vi.fn();
    let ok = false;
    mount({ F2: { label: "Edit", run, when: () => ok } });
    press({ key: "F2" });
    ok = true;
    press({ key: "F2" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("ignores events that something else already handled", () => {
    const run = vi.fn();
    mount({ "Mod+B": { label: "Bold", run } });
    const el = document.createElement("div");
    el.addEventListener("keydown", (e) => e.preventDefault());
    document.body.append(el);
    press({ key: "b", ctrlKey: true }, el);
    expect(run).not.toHaveBeenCalled();
    el.remove();
  });

  it("never binds entries without a handler", () => {
    mount({ "Mod+B": { label: "Bold (editor)" } });
    expect(press({ key: "b", ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("uses the latest map and can be disabled", () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = mount({ F5: { label: "Present", run: a } });
    rerender({ m: { F5: { label: "Present", run: b } }, on: true });
    press({ key: "F5" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    rerender({ m: { F5: { label: "Present", run: b } }, on: false });
    press({ key: "F5" });
    expect(b).toHaveBeenCalledOnce();
  });

  it("removes the listener on unmount", () => {
    const run = vi.fn();
    const { unmount } = mount({ F5: { label: "Present", run } });
    unmount();
    press({ key: "F5" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ShortcutHelp", () => {
  const map: ShortcutMap = {
    "Mod+S": { label: "Save", group: "File", run: () => undefined },
    "Mod+O": { label: "Open", group: "File", run: () => undefined },
    "Mod+B": { label: "Bold", group: "Format" },
  };

  it("groups map entries and extra rows", () => {
    const sections = helpSections(map, [{ combo: "Mod+Z", label: "Undo" }]);
    expect(sections.map(([g]) => g)).toEqual(["File", "Format", "General"]);
    expect(sections[0]![1]).toHaveLength(2);
  });

  it("lists the shortcuts in a dialog and closes with Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutHelp open onClose={onClose} shortcuts={map} />);
    const dlg = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dlg.textContent).toContain("Save");
    expect(dlg.textContent).toContain("Ctrl+Shift".slice(0, 4));
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PromptDialog", () => {
  it("submits the trimmed value and ignores empty input", () => {
    const onSubmit = vi.fn();
    render(<PromptDialog open title="Save as" label="File name" initial="a.docx" onSubmit={onSubmit} onClose={() => undefined} />);
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    expect(input.value).toBe("a.docx");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.submit(input.form!);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " b.docx " } });
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenCalledWith("b.docx");
  });

  it("appends a missing extension", () => {
    expect(withExtension("plan", ".pptx")).toBe("plan.pptx");
    expect(withExtension("Plan.PPTX", ".pptx")).toBe("Plan.PPTX");
  });
});
